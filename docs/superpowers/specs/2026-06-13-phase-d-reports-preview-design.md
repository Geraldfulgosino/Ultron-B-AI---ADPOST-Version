# Phase D — Reports Preview Foundation

**Date:** 2026-06-13
**Sprint:** 16 (Phase D)
**Status:** Approved — implementation in progress

---

## Goal

Add a Reports page foundation that renders a structured preview of synced local analytics data for a selected website and date range. No PDF export, no email, no scheduling, no billing. The preview must respect Sprint 15 client scoping: owner/admin see org-level data; client users see only their assigned website(s).

---

## Out of scope (explicit limits)

- PDF export (Phase E)
- Email delivery of reports
- Scheduled/automated reports
- Billing or subscription gating
- New chart libraries
- Any data fetched live from Google APIs (local sync tables only)

---

## Architecture

Follows the established thin-controller + Action pattern, identical to `SeoDashboardController` / `GetSeoDashboardDataAction`.

```
GET /{organization}/reports
  → ReportPreviewRequest   (validates filters, gates on report.view permission)
  → ReportsController      (invokable, delegates to action)
  → GetReportPreviewAction (queries local analytics tables, returns shaped payload)
  → Inertia::render('reports/Index', [...])
```

---

## Backend files

### Route
`routes/web.php` — inside the org-scoped group:
```php
Route::get('/reports', ReportsController::class)->name('reports.index');
```

### Form Request — `app/Http/Requests/Reports/ReportPreviewRequest.php`
- `authorize()`: `OrganizationContextService::memberCan('report.view')`
- Validates:
  - `website_id`: nullable integer, must exist in `websites` for current org, must be in `allowedWebsiteIds` if client-scoped
  - `date_from`: nullable date
  - `date_to`: nullable date, `after_or_equal:date_from`
  - `source`: nullable, `in:all,ga4,gsc`
- `filters()` helper: normalises validated values, defaults `date_from` to 30 days ago, `date_to` to today, `source` to `all`

### Action — `app/Domains/Analytics/Actions/GetReportPreviewAction.php`

Signature:
```php
public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds): array
```

Returns:
```php
[
    'filters'         => ['website_id', 'date_from', 'date_to', 'source'],
    'websites'        => [['id', 'name', 'domain', 'client_name']],
    'summary'         => [
        'gsc_clicks'       => int,
        'gsc_impressions'  => int,
        'gsc_ctr'          => float,   // percentage (0–100)
        'gsc_avg_position' => float|null,
        'ga4_sessions'     => int,
        'ga4_conversions'  => int,
        'has_gsc_data'     => bool,
        'has_ga4_data'     => bool,
    ],
    'top_queries'     => [['query', 'clicks', 'impressions', 'ctr', 'average_position']],  // top 5
    'top_pages'       => [['page_path', 'sessions', 'conversions', 'clicks', 'impressions', 'ctr']], // top 5
    'seo_insights'    => [['id', 'title', 'summary', 'recommendation', 'severity', 'status', 'status_label', 'website_name']],
    'has_report_data' => bool,
]
```

Data sources:
- `AnalyticsDailyMetric` → summary totals, has_ga4_data, has_gsc_data
- `AnalyticsSearchQuery` → top_queries (GSC)
- `AnalyticsLandingPage` → top_pages (GA4)
- `SeoInsight` (open statuses) → seo_insights + recommendations

All queries apply `organization_id` and `allowedWebsiteIds` guards. `has_report_data` is true if either has_gsc_data or has_ga4_data.

### Controller — `app/Http/Controllers/ReportsController.php`
Invokable. Injects `ReportPreviewRequest`, `OrganizationContextService`, `GetReportPreviewAction`. Spreads action result into `Inertia::render('reports/Index')`.

---

## Frontend files

### Sidebar — `resources/js/layouts/AppLayout.tsx`
Insert between "SEO Insights" and "Members":
```ts
{ label: 'Reports', href: safeRoute('reports.index', { organization: slug }), clientVisible: true }
```

### Page — `resources/js/pages/reports/Index.tsx`

**Filter bar** (same style as `seo/Index.tsx`):
- Website selector (`<select>` from `websites` prop)
- Date From / Date To (`<Input type="date">`)
- Source selector: All / GA4 / GSC
- Apply button

**Report sections** (rendered below filters):

| Section | Source condition | Empty state |
|---|---|---|
| Executive summary | Always | Full-card: "No report data for selected range" |
| Summary metrics (KPI cards) | Always | KPIs show 0 / N/A gracefully |
| GSC performance — top queries | source=all or gsc | Dashed card: "No synced GSC data" |
| GA4 performance — top pages | source=all or ga4 | Dashed card: "No synced GA4 data" |
| SEO insights | Always | Dashed card: "No SEO insights" |
| Recommendations | Derived from seo_insights | List of insight.title + insight.recommendation; if empty: "No recommendations yet" |

Reuses existing components: `Card`, `CardContent`, `CardHeader`, `Badge`, `Button`, `Input`, `Label`.

No new chart library. No SVG charts in this phase (trend charts are SEO dashboard scope).

---

## Tests — `tests/Feature/Reports/ReportsTest.php`

1. `test_owner_can_access_reports_page` — owner gets 200, component `reports/Index`
2. `test_client_can_access_reports_page` — client user gets 200
3. `test_client_only_receives_assigned_website_report_data` — two clients, two websites with distinct metric values; client user's summary reflects only their website's data, not the other's
4. `test_report_preview_renders_with_empty_data` — no metrics seeded; `has_report_data=false`, `summary.gsc_clicks=0`, `summary.ga4_sessions=0`
5. `test_report_preview_returns_ga4_gsc_summary_when_data_exists` — seed `AnalyticsDailyMetric` + `AnalyticsSearchQuery` + `AnalyticsLandingPage`; assert summary totals, top_queries, top_pages

---

## Tenant isolation guarantees

- `ReportPreviewRequest::authorize()` uses `report.view` — same gate as SEO dashboard.
- `website_id` filter validated against org and `allowedWebsiteIds` — cross-org or cross-client website IDs are rejected at the request layer.
- `GetReportPreviewAction` always applies `where('organization_id', $organization->id)` and `when($allowedWebsiteIds !== null, fn($q) => $q->whereIn('website_id', $allowedWebsiteIds))` on every query.

---

## Risks

- `report.view` permission must exist in `OrganizationMember::can()` — same gate as SEO dashboard, confirmed present.
- No migration needed — all data is read from existing analytics tables.
- Recommendations section is client-visible; contains no data beyond what the client's own insights already show.
