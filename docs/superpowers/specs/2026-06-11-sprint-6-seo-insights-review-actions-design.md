# Sprint 6 — SEO Insights Review & Action Management

**Date:** 2026-06-11
**Branch:** `sprint-6-seo-insights-review-actions`
**Status:** Approved — ready for implementation

---

## Goal

Build the end-to-end review and action-management workflow for SEO insights. Reviewers (admin/owner) can view insight detail, transition status (reviewed → approved → dismissed → reopened), add optional review notes, and run bulk operations. Every status change is audit-logged. Viewers can read but not act.

---

## Constraints

- No external API calls during any request.
- No WordPress publishing.
- No automatic emails.
- All data from local database only.
- `organization_id` is never trusted from the browser — always derived from `SetActiveOrganization`.

---

## 1. Database

### New migration: `add_review_notes_to_seo_insights_table`

```sql
ALTER TABLE seo_insights ADD COLUMN review_notes TEXT NULL;
```

No other schema changes. `reviewed_by`, `reviewed_at`, `status` are already present from Sprint 5.

### Model changes

`SeoInsight` gains `review_notes` in `$fillable`. No cast needed (plain nullable string).

---

## 2. Domain Layer

### `UpdateSeoInsightStatusAction`

Single shared action for all four single-insight transitions.

**Signature:** `execute(SeoInsight $insight, User $actor, SeoInsightStatus $newStatus, ?string $reviewNotes, Request $request): SeoInsight`

**Behaviour:**
1. Capture `$oldStatus = $insight->status`.
2. Set `status`, `reviewed_by = $actor->id`, `reviewed_at = now()`, `review_notes = $reviewNotes`.
3. Save.
4. Call `AuditLogger::log(...)` with event `insight.{$newStatus->value}`, old/new values, actor, request.
5. Return updated insight.

**Note:** `reopened` sets status back to `pending` and clears `reviewed_by`, `reviewed_at`, `review_notes`.

### `BulkUpdateSeoInsightStatusAction`

Wraps `UpdateSeoInsightStatusAction` in a loop.

**Signature:** `execute(Organization $org, array $ids, User $actor, SeoInsightStatus $newStatus, ?string $reviewNotes, Request $request): int`

**Behaviour:**
1. Load insights by `ids` scoped to `organization_id = $org->id` only (cross-tenant safety).
2. Loop and call `UpdateSeoInsightStatusAction::execute()` for each.
3. Return count of updated records.

Audit event: `insight.bulk_{$newStatus->value}` with `new_values = ['count' => $count, 'ids' => $ids]`.

### `GetSeoInsightListAction`

Builds a filtered, paginated query of insights for the index page.

**Filters:** `type`, `status`, `website_id`, `severity`, `date_from`, `date_to`. All scoped to `organization_id`.

**Pagination:** 20 per page.

**Eager loads:** `website`, `reviewedBy`.

### `GetSeoInsightDetailAction`

Loads a single insight with `website`, `generatedBy`, `reviewedBy` relations. Returns a typed array for Inertia.

### `AuditLogger` service

**Location:** `app/Domains/Audit/Services/AuditLogger.php`

**Method:** `static log(string $event, Model $subject, User $actor, array $oldValues, array $newValues, Request $request): void`

Inserts a row into `audit_logs` synchronously (no queue — async audit writes can produce gaps).

Fields set: `event`, `auditable_type`, `auditable_id`, `organization_id`, `user_id`, `old_values`, `new_values`, `ip_address`, `user_agent`, `url`, `created_at`.

### `AuditLog` model

**Location:** `app/Domains/Audit/Models/AuditLog.php`

Simple Eloquent model. No `updated_at` (table has only `created_at`). Not tenant-owned at the model level but `organization_id` is always set for insight events.

---

## 3. HTTP Layer

### Routes

All under the existing `/{organization}` prefix group with `auth`, `verified`, `SetActiveOrganization` middleware.

| Method | URI | Route name | Controller method |
|--------|-----|------------|-------------------|
| GET | `/seo/insights` | `seo.insights.index` | `SeoInsightController@index` |
| GET | `/seo/insights/{insight}` | `seo.insights.show` | `SeoInsightController@show` |
| POST | `/seo/insights/{insight}/reviewed` | `seo.insights.reviewed` | `SeoInsightController@markReviewed` |
| POST | `/seo/insights/{insight}/approved` | `seo.insights.approved` | `SeoInsightController@markApproved` |
| POST | `/seo/insights/{insight}/dismissed` | `seo.insights.dismissed` | `SeoInsightController@markDismissed` |
| POST | `/seo/insights/{insight}/reopened` | `seo.insights.reopened` | `SeoInsightController@reopen` |
| POST | `/seo/insights/bulk-reviewed` | `seo.insights.bulk-reviewed` | `SeoInsightController@bulkReviewed` |
| POST | `/seo/insights/bulk-dismissed` | `seo.insights.bulk-dismissed` | `SeoInsightController@bulkDismissed` |

Existing routes (`seo.index`, `seo.insights.generate`) are unchanged.

**Route ordering:** `bulk-reviewed` and `bulk-dismissed` are registered before `{insight}` to avoid Laravel matching the literal string as an insight ID.

### Controller: `SeoInsightController`

Thin methods only. Each status-action method:
1. Resolves org from `OrganizationContextService`.
2. Delegates to the appropriate action.
3. Redirects back with a flash message.

### Form Requests

**`SeoInsightIndexRequest`** — `report.view` authorization. Validates nullable filters: `type` (string, in enum values), `status` (string, in enum values), `website_id` (integer, exists in websites scoped to org), `severity` (string, in: low/medium/high), `date_from` (date), `date_to` (date, after_or_equal: date_from).

**`UpdateSeoInsightStatusRequest`** — `approval.decide` authorization via `SeoInsightPolicy::updateStatus`. Validates `review_notes` as `nullable|string|max:1000`.

**`BulkUpdateSeoInsightStatusRequest`** — same authorization (checks org-level `approval.decide`). Validates `ids` as `required|array|min:1|max:50` with each item as `integer|min:1`.

### Policy

`SeoInsightPolicy::updateStatus` (already exists) gates on `approval.decide` — admin and owner only.
`SeoInsightPolicy::view` gates on `report.view` — all roles including viewer.

---

## 4. Frontend

### `seo/InsightsIndex.tsx`

Dedicated insights list page. Props: `insights` (paginated), `filters`, `websites` (for filter dropdown), `canUpdateStatus`.

**Filter bar:** type, status, website, severity, date_from, date_to — GET form, preserves scroll.

**Table:** columns — Title, Type, Status (badge), Severity (badge), Website, Reviewed by, Created at. Each row has a "View" link to the detail page.

**Bulk actions:** Checkboxes on each row. When ≥1 selected and `canUpdateStatus`, show a dropdown: "Mark reviewed", "Dismiss". Submit via Inertia POST to bulk routes.

**Pagination:** standard previous/next links.

### `seo/InsightShow.tsx`

Detail page. Props: `insight` (full record), `canUpdateStatus`.

**Displays:** title, summary, recommendation, evidence (rendered as a readable key/value list), severity badge, status badge, type label, website name, date range, created at, reviewed at, reviewer name, review notes.

**Action buttons** (visible when `canUpdateStatus`): reviewed, approved, dismissed, reopened — each opens an inline form with optional `review_notes` textarea (max 1000 chars) and a confirm button. Only valid transitions are shown (e.g., "reopened" only if status is not pending).

### `seo/Index.tsx` (existing, minimal change)

Insight cards in the dashboard summary panel gain a "View detail →" link to `seo.insights.show`. No other changes. The existing 8-record limit and generate button remain.

---

## 5. Audit Logging

Events logged on every insight status change:

| Event | Triggered by |
|-------|-------------|
| `insight.reviewed` | `markReviewed` |
| `insight.approved` | `markApproved` |
| `insight.dismissed` | `markDismissed` |
| `insight.reopened` | `reopen` |
| `insight.bulk_reviewed` | `bulkReviewed` |
| `insight.bulk_dismissed` | `bulkDismissed` |

`old_values` always includes `{ status: <previous> }`. `new_values` always includes `{ status: <new>, review_notes: <notes or null> }`. Bulk events include `{ count, ids }` in `new_values`.

---

## 6. Tests

### `SeoInsightReviewTest`

- Admin can mark insight as reviewed (status, reviewed_by, reviewed_at, review_notes persisted; audit log written).
- Admin can mark insight as approved.
- Admin can mark insight as dismissed.
- Admin can reopen an insight (status reset to pending, reviewed_* fields cleared).
- `review_notes` is stored correctly when provided.
- `review_notes` is null when omitted.
- Audit log row is written for each transition.

### `SeoInsightBulkActionTest`

- Admin can bulk mark reviewed (all target insights updated; count returned in flash).
- Admin can bulk dismiss.
- Bulk action silently skips IDs from another organization (cross-tenant safety).
- Bulk action rejects empty `ids` array.

### `SeoInsightAuthorizationTest`

- Viewer cannot update status (403).
- Member cannot update status (403).
- Admin can update status.
- Owner can update status.
- Viewer cannot bulk-update status (403).

### `SeoInsightTenantIsolationTest`

- Org A user cannot access org B's insight detail page (403/404).
- Org A user cannot POST to org B's insight status route (403/404).
- Bulk action for org A ignores IDs belonging to org B.

### `SeoInsightFilterTest`

- Filter by type returns only matching insights.
- Filter by status returns only matching insights.
- Filter by website_id returns only that website's insights.
- Filter by severity returns correct subset.
- Filter by date_from / date_to returns insights within range.
- Invalid website_id from another org is rejected (422).
