# Phase D — Reports Preview Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Reports page with website/date-range/source filters and six preview sections (executive summary, summary metrics, GSC performance, GA4 performance, SEO insights, recommendations), fully scoped by tenant (owner/admin = org-wide, client = assigned websites only).

**Architecture:** New `GetReportPreviewAction` in `app/Domains/Analytics/Actions/` follows the identical pattern of `GetSeoDashboardDataAction`. A thin `ReportsController` injects `ReportPreviewRequest` + action, renders `reports/Index` via Inertia. All queries guard on `organization_id` and `allowedWebsiteIds`. No PDF, no email, no chart library.

**Tech Stack:** PHP 8.4 / Laravel 13, Inertia.js v2, React 19 + TypeScript, Tailwind CSS v4, MySQL 8.4 (local analytics tables only).

---

## File Map

| Action | Path |
|--------|------|
| Create | `app/Http/Requests/Reports/ReportPreviewRequest.php` |
| Create | `app/Domains/Analytics/Actions/GetReportPreviewAction.php` |
| Create | `app/Http/Controllers/ReportsController.php` |
| Modify | `routes/web.php` |
| Modify | `resources/js/layouts/AppLayout.tsx` |
| Create | `resources/js/pages/reports/Index.tsx` |
| Create | `tests/Feature/Reports/ReportsTest.php` |

---

## Task 1: Write failing tests

**Files:**
- Create: `tests/Feature/Reports/ReportsTest.php`

- [ ] **Step 1: Create the test file**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Reports;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportsTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_access_reports_page(): void
    {
        [$organization, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('reports.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('reports/Index'));
    }

    public function test_client_can_access_reports_page(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
        ]);
        [$clientUser] = $this->createClientUser($organization, $client);

        $this->actingAs($clientUser)
            ->get(route('reports.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('reports/Index'));
    }

    public function test_client_only_receives_assigned_website_report_data(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $myWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $myClient->id,
            'created_by' => $admin->id,
        ]);
        $otherWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $otherClient->id,
            'created_by' => $admin->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'metric_date' => '2026-06-10',
            'clicks' => 20,
            'impressions' => 200,
            'sessions' => 50,
            'conversions' => 5,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'metric_date' => '2026-06-10',
            'clicks' => 999,
            'impressions' => 9999,
            'sessions' => 999,
            'conversions' => 99,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('summary.gsc_clicks', 20)
                ->where('summary.gsc_impressions', 200)
                ->where('summary.ga4_sessions', 50)
                ->where('summary.ga4_conversions', 5)
            );
    }

    public function test_report_preview_renders_with_empty_data(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', false)
                ->where('summary.gsc_clicks', 0)
                ->where('summary.ga4_sessions', 0)
                ->where('top_queries', [])
                ->where('top_pages', [])
                ->where('seo_insights', [])
            );
    }

    public function test_report_preview_returns_ga4_gsc_summary_when_data_exists(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
            'average_position' => 4.5,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'query' => 'ultron reports',
            'query_hash' => hash('sha256', 'ultron reports'),
            'clicks' => 30,
            'impressions' => 300,
            'ctr' => 0.10,
            'average_position' => 4.5,
        ]);
        AnalyticsLandingPage::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'page_path' => '/about',
            'page_path_hash' => hash('sha256', '/about'),
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', true)
                ->where('summary.gsc_clicks', 30)
                ->where('summary.gsc_impressions', 300)
                ->where('summary.ga4_sessions', 80)
                ->where('summary.ga4_conversions', 8)
                ->where('top_queries.0.query', 'ultron reports')
                ->where('top_queries.0.clicks', 30)
                ->where('top_pages.0.page_path', '/about')
                ->where('top_pages.0.sessions', 80)
            );
    }
}
```

- [ ] **Step 2: Run tests to confirm they all fail (route not yet registered)**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Reports/ReportsTest.php --no-coverage
```

Expected: 5 failures — `Route [reports.index] not defined.`

---

## Task 2: Add route

**Files:**
- Modify: `routes/web.php`

- [ ] **Step 1: Add import and route**

In `routes/web.php`, add the import at the top with the other controller imports:

```php
use App\Http\Controllers\ReportsController;
```

Inside the org-scoped route group (after the SEO insight routes, before the closing `}`):

```php
        // Reports
        Route::get('/reports', ReportsController::class)->name('reports.index');
```

---

## Task 3: Create ReportPreviewRequest

**Files:**
- Create: `app/Http/Requests/Reports/ReportPreviewRequest.php`

- [ ] **Step 1: Create the request file**

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Reports;

use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReportPreviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return app(OrganizationContextService::class)->memberCan('report.view');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $context = app(OrganizationContextService::class);
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        $websiteIdRules = [
            'nullable',
            'integer',
            Rule::exists('websites', 'id')->where('organization_id', $organization?->id),
        ];

        if ($allowedWebsiteIds !== null) {
            $websiteIdRules[] = Rule::in($allowedWebsiteIds);
        }

        return [
            'website_id' => $websiteIdRules,
            'date_from'  => ['nullable', 'date'],
            'date_to'    => ['nullable', 'date', 'after_or_equal:date_from'],
            'source'     => ['nullable', Rule::in(['all', 'ga4', 'gsc'])],
        ];
    }

    /** @return array{website_id: int|null, date_from: string, date_to: string, source: string} */
    public function filters(): array
    {
        $validated = $this->validated();

        return [
            'website_id' => isset($validated['website_id']) ? (int) $validated['website_id'] : null,
            'date_from'  => (string) ($validated['date_from'] ?? now()->subDays(29)->toDateString()),
            'date_to'    => (string) ($validated['date_to'] ?? now()->toDateString()),
            'source'     => (string) ($validated['source'] ?? 'all'),
        ];
    }
}
```

---

## Task 4: Create GetReportPreviewAction

**Files:**
- Create: `app/Domains/Analytics/Actions/GetReportPreviewAction.php`

- [ ] **Step 1: Create the action file**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Actions;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class GetReportPreviewAction
{
    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return array<string, mixed>
     */
    public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds): array
    {
        $dailyQuery = AnalyticsDailyMetric::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds));

        $totals = (clone $dailyQuery)
            ->selectRaw('COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, COALESCE(SUM(sessions), 0) as sessions, COALESCE(SUM(conversions), 0) as conversions')
            ->first();

        $avgPosition = (clone $dailyQuery)
            ->where('average_position', '>', 0)
            ->avg('average_position');

        $clicks      = (int) ($totals?->clicks ?? 0);
        $impressions = (int) ($totals?->impressions ?? 0);
        $sessions    = (int) ($totals?->sessions ?? 0);
        $conversions = (int) ($totals?->conversions ?? 0);

        $hasGscData = (clone $dailyQuery)
            ->where(fn (Builder $q) => $q->where('clicks', '>', 0)->orWhere('impressions', '>', 0))
            ->exists();

        $hasGa4Data = (clone $dailyQuery)
            ->where('sessions', '>', 0)
            ->exists();

        return [
            'filters'         => $filters,
            'websites'        => $this->websites($organization, $allowedWebsiteIds),
            'summary'         => [
                'gsc_clicks'       => $clicks,
                'gsc_impressions'  => $impressions,
                'gsc_ctr'          => $this->ratio($clicks, $impressions) * 100,
                'gsc_avg_position' => $avgPosition !== null ? round((float) $avgPosition, 2) : null,
                'ga4_sessions'     => $sessions,
                'ga4_conversions'  => $conversions,
                'has_gsc_data'     => $hasGscData,
                'has_ga4_data'     => $hasGa4Data,
            ],
            'top_queries'     => $this->topQueries($organization, $filters, $allowedWebsiteIds),
            'top_pages'       => $this->topPages($organization, $filters, $allowedWebsiteIds),
            'seo_insights'    => $this->insights($organization, $filters, $allowedWebsiteIds),
            'has_report_data' => $hasGscData || $hasGa4Data,
        ];
    }

    /**
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{id: int, name: string, domain: string, client_name: string}>
     */
    private function websites(Organization $organization, ?array $allowedWebsiteIds): Collection
    {
        return $organization->websites()
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
            ->with('client')
            ->latest()
            ->get()
            ->map(fn ($website) => [
                'id'          => $website->id,
                'name'        => $website->name,
                'domain'      => $website->domain,
                'client_name' => $website->client->name,
            ]);
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{query: string, clicks: int, impressions: int, ctr: float, average_position: float|null}>
     */
    private function topQueries(Organization $organization, array $filters, ?array $allowedWebsiteIds): Collection
    {
        return AnalyticsSearchQuery::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->selectRaw('query, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, AVG(NULLIF(average_position, 0)) as average_position')
            ->groupBy('query')
            ->orderByDesc('clicks')
            ->limit(5)
            ->get()
            ->map(fn ($row) => [
                'query'            => (string) $row->query,
                'clicks'           => (int) $row->clicks,
                'impressions'      => (int) $row->impressions,
                'ctr'              => $this->ratio((int) $row->clicks, (int) $row->impressions) * 100,
                'average_position' => $row->average_position !== null ? round((float) $row->average_position, 2) : null,
            ]);
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{page_path: string, sessions: int, conversions: int}>
     */
    private function topPages(Organization $organization, array $filters, ?array $allowedWebsiteIds): Collection
    {
        return AnalyticsLandingPage::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->selectRaw('page_path, COALESCE(SUM(sessions), 0) as sessions, COALESCE(SUM(conversions), 0) as conversions')
            ->groupBy('page_path')
            ->orderByDesc('sessions')
            ->limit(5)
            ->get()
            ->map(fn ($row) => [
                'page_path'   => (string) $row->page_path,
                'sessions'    => (int) $row->sessions,
                'conversions' => (int) $row->conversions,
            ]);
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{id: int, title: string, summary: string, recommendation: string|null, severity: string, status: string, status_label: string, website_name: string|null}>
     */
    private function insights(Organization $organization, array $filters, ?array $allowedWebsiteIds): Collection
    {
        $openStatuses = [
            SeoInsightStatus::Pending->value,
            SeoInsightStatus::Reviewed->value,
            SeoInsightStatus::Approved->value,
        ];

        return SeoInsight::query()
            ->where('organization_id', $organization->id)
            ->whereIn('status', $openStatuses)
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->with('website')
            ->latest()
            ->limit(5)
            ->get()
            ->map(fn (SeoInsight $insight) => [
                'id'           => $insight->id,
                'title'        => $insight->title,
                'summary'      => $insight->summary,
                'recommendation' => $insight->recommendation,
                'severity'     => $insight->severity,
                'status'       => $insight->status->value,
                'status_label' => $insight->status->label(),
                'website_name' => $insight->website?->name,
            ]);
    }

    private function ratio(int $numerator, int $denominator): float
    {
        if ($denominator === 0) {
            return 0.0;
        }

        return round($numerator / $denominator, 4);
    }
}
```

---

## Task 5: Create ReportsController

**Files:**
- Create: `app/Http/Controllers/ReportsController.php`

- [ ] **Step 1: Create the controller**

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Analytics\Actions\GetReportPreviewAction;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Reports\ReportPreviewRequest;
use Inertia\Inertia;
use Inertia\Response;

class ReportsController extends Controller
{
    public function __invoke(
        ReportPreviewRequest $request,
        OrganizationContextService $context,
        GetReportPreviewAction $action,
    ): Response {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        return Inertia::render('reports/Index', [
            ...$action->execute($organization, $request->filters(), $allowedWebsiteIds),
        ]);
    }
}
```

- [ ] **Step 2: Run backend tests — all 5 should now pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Reports/ReportsTest.php --no-coverage
```

Expected output:
```
PASS  Tests\Feature\Reports\ReportsTest
✓ owner can access reports page
✓ client can access reports page
✓ client only receives assigned website report data
✓ report preview renders with empty data
✓ report preview returns ga4 gsc summary when data exists

Tests:  5 passed
```

---

## Task 6: Add Reports nav item to sidebar

**Files:**
- Modify: `resources/js/layouts/AppLayout.tsx`

- [ ] **Step 1: Insert "Reports" between "SEO Insights" and "Members"**

Find this block in `AppLayout.tsx` (around line 51):
```ts
            { label: 'SEO Insights', href: safeRoute('seo.insights.index',    { organization: slug }), clientVisible: true  },
            { label: 'Members',      href: safeRoute('organization.members',  { organization: slug }), clientVisible: false },
```

Replace with:
```ts
            { label: 'SEO Insights', href: safeRoute('seo.insights.index',    { organization: slug }), clientVisible: true  },
            { label: 'Reports',      href: safeRoute('reports.index',         { organization: slug }), clientVisible: true  },
            { label: 'Members',      href: safeRoute('organization.members',  { organization: slug }), clientVisible: false },
```

---

## Task 7: Create reports/Index.tsx

**Files:**
- Create: `resources/js/pages/reports/Index.tsx`

- [ ] **Step 1: Create the page component**

```tsx
import React from 'react';
import { Head, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

type DataSource = 'all' | 'ga4' | 'gsc';

interface ReportFilters {
    website_id: number | null;
    date_from: string;
    date_to: string;
    source: DataSource;
}

interface ReportSummary {
    gsc_clicks: number;
    gsc_impressions: number;
    gsc_ctr: number;
    gsc_avg_position: number | null;
    ga4_sessions: number;
    ga4_conversions: number;
    has_gsc_data: boolean;
    has_ga4_data: boolean;
}

interface Website {
    id: number;
    name: string;
    domain: string;
    client_name: string;
}

interface TopQuery {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    average_position: number | null;
}

interface TopPage {
    page_path: string;
    sessions: number;
    conversions: number;
}

interface SeoInsightRow {
    id: number;
    title: string;
    summary: string;
    recommendation: string | null;
    severity: string;
    status: string;
    status_label: string;
    website_name: string | null;
}

interface ReportsProps {
    filters: ReportFilters;
    websites: Website[];
    summary: ReportSummary;
    top_queries: TopQuery[];
    top_pages: TopPage[];
    seo_insights: SeoInsightRow[];
    has_report_data: boolean;
}

interface SharedProps {
    currentOrganization: { slug: string };
    errors?: Record<string, string>;
}

const numericValue = (value: number | null | undefined): number => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
};

const fmt = (v: number | null | undefined): string => numericValue(v).toLocaleString();
const fmtDec = (v: number | null | undefined): string => numericValue(v).toFixed(2);
const fmtOpt = (v: number | null | undefined): string => (v === null || v === undefined ? 'N/A' : fmtDec(v));

function Kpi({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <p className="text-sm font-medium text-gray-500">{label}</p>
                <p className={`mt-2 text-2xl font-bold ${muted ? 'text-gray-400' : 'text-gray-900'}`}>{value}</p>
            </CardContent>
        </Card>
    );
}

function EmptyCard({ title, description }: { title: string; description: string }) {
    return (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm font-medium text-gray-900">{title}</p>
            <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
    );
}

function severityVariant(s: string): 'red' | 'yellow' | 'blue' {
    if (s === 'high') return 'red';
    if (s === 'medium') return 'yellow';
    return 'blue';
}

function statusVariant(s: string): 'green' | 'gray' | 'indigo' | 'yellow' {
    if (s === 'approved') return 'green';
    if (s === 'dismissed') return 'gray';
    if (s === 'reviewed') return 'indigo';
    return 'yellow';
}

export default function ReportsIndex({
    filters,
    websites,
    summary,
    top_queries,
    top_pages,
    seo_insights,
    has_report_data,
}: ReportsProps) {
    const page = usePage();
    const { currentOrganization, errors = {} } = page.props as unknown as SharedProps;
    const orgSlug = currentOrganization?.slug ?? page.url.split('/').filter(Boolean)[0] ?? '';

    const safeFilters = {
        website_id: filters?.website_id ?? null,
        date_from: filters?.date_from ?? '',
        date_to: filters?.date_to ?? '',
        source: (filters?.source ?? 'all') as DataSource,
    };

    const form = useForm({
        website_id: safeFilters.website_id?.toString() ?? '',
        date_from: safeFilters.date_from,
        date_to: safeFilters.date_to,
        source: safeFilters.source,
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        form.get(route('reports.index', { organization: orgSlug }), {
            preserveScroll: true,
            preserveState: true,
        });
    };

    const websiteList = Array.isArray(websites) ? websites : [];
    const queryRows   = Array.isArray(top_queries) ? top_queries : [];
    const pageRows    = Array.isArray(top_pages) ? top_pages : [];
    const insightRows = Array.isArray(seo_insights) ? seo_insights : [];

    const source  = safeFilters.source;
    const showGsc = source === 'all' || source === 'gsc';
    const showGa4 = source === 'all' || source === 'ga4';

    const recommendations = insightRows.filter((i) => i.recommendation);

    const safeSummary = {
        gsc_clicks:       summary?.gsc_clicks ?? 0,
        gsc_impressions:  summary?.gsc_impressions ?? 0,
        gsc_ctr:          summary?.gsc_ctr ?? 0,
        gsc_avg_position: summary?.gsc_avg_position ?? null,
        ga4_sessions:     summary?.ga4_sessions ?? 0,
        ga4_conversions:  summary?.ga4_conversions ?? 0,
        has_gsc_data:     summary?.has_gsc_data === true,
        has_ga4_data:     summary?.has_ga4_data === true,
    };

    return (
        <AppLayout title="Reports">
            <Head title="Reports" />
            <div className="space-y-6">

                {/* Filter bar */}
                <Card>
                    <CardHeader>
                        <h2 className="text-lg font-semibold text-gray-900">Report preview</h2>
                        <p className="mt-1 text-sm text-gray-500">Generated from synchronized local analytics data.</p>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={submit}
                            className="grid gap-4 lg:grid-cols-[minmax(180px,1fr)_160px_160px_160px_auto] lg:items-end"
                        >
                            <div>
                                <Label htmlFor="report-website">Website</Label>
                                <select
                                    id="report-website"
                                    value={form.data.website_id}
                                    onChange={(e) => form.setData('website_id', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All websites</option>
                                    {websiteList.map((w) => (
                                        <option key={w.id} value={w.id}>
                                            {w.name} ({w.domain})
                                        </option>
                                    ))}
                                </select>
                                {errors.website_id && <p className="mt-1 text-xs text-red-600">{errors.website_id}</p>}
                            </div>
                            <div>
                                <Label htmlFor="report-source">Data source</Label>
                                <select
                                    id="report-source"
                                    value={form.data.source}
                                    onChange={(e) => form.setData('source', e.target.value as DataSource)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="all">All sources</option>
                                    <option value="ga4">Google Analytics 4</option>
                                    <option value="gsc">Google Search Console</option>
                                </select>
                                {errors.source && <p className="mt-1 text-xs text-red-600">{errors.source}</p>}
                            </div>
                            <div>
                                <Label htmlFor="report-date-from">From</Label>
                                <Input
                                    id="report-date-from"
                                    type="date"
                                    value={form.data.date_from}
                                    onChange={(e) => form.setData('date_from', e.target.value)}
                                    error={errors.date_from}
                                />
                            </div>
                            <div>
                                <Label htmlFor="report-date-to">To</Label>
                                <Input
                                    id="report-date-to"
                                    type="date"
                                    value={form.data.date_to}
                                    onChange={(e) => form.setData('date_to', e.target.value)}
                                    error={errors.date_to}
                                />
                            </div>
                            <Button type="submit" loading={form.processing}>Apply</Button>
                        </form>
                        {Object.keys(errors).length > 0 && (
                            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                The selected filters could not be applied.
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Executive summary */}
                <Card>
                    <CardHeader>
                        <h2 className="text-lg font-semibold text-gray-900">Executive summary</h2>
                        <p className="mt-1 text-sm text-gray-500">Aggregated totals for the selected date range.</p>
                    </CardHeader>
                    <CardContent>
                        {!has_report_data ? (
                            <EmptyCard
                                title="No report data for selected range"
                                description="Sync a connected GA4 or Search Console integration, or adjust the website and date range."
                            />
                        ) : (
                            <p className="text-sm text-gray-700">
                                {showGsc && (
                                    <>
                                        <strong>{fmt(safeSummary.gsc_clicks)}</strong> clicks and{' '}
                                        <strong>{fmt(safeSummary.gsc_impressions)}</strong> impressions from Google Search Console.{' '}
                                    </>
                                )}
                                {showGa4 && (
                                    <>
                                        <strong>{fmt(safeSummary.ga4_sessions)}</strong> organic sessions and{' '}
                                        <strong>{fmt(safeSummary.ga4_conversions)}</strong> conversions from Google Analytics 4.
                                    </>
                                )}
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Summary metrics */}
                <div className="space-y-4">
                    {showGsc && (
                        <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">GSC Metrics</p>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <Kpi label="Clicks"        value={fmt(safeSummary.gsc_clicks)}                  muted={!safeSummary.has_gsc_data} />
                                <Kpi label="Impressions"   value={fmt(safeSummary.gsc_impressions)}             muted={!safeSummary.has_gsc_data} />
                                <Kpi label="CTR"           value={`${fmtDec(safeSummary.gsc_ctr)}%`}           muted={!safeSummary.has_gsc_data} />
                                <Kpi label="Avg. position" value={fmtOpt(safeSummary.gsc_avg_position)}        muted={!safeSummary.has_gsc_data} />
                            </div>
                        </div>
                    )}
                    {showGa4 && (
                        <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">GA4 Metrics</p>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <Kpi label="Organic sessions" value={fmt(safeSummary.ga4_sessions)}    muted={!safeSummary.has_ga4_data} />
                                <Kpi label="Conversions"      value={fmt(safeSummary.ga4_conversions)} muted={!safeSummary.has_ga4_data} />
                            </div>
                        </div>
                    )}
                </div>

                {/* GSC performance */}
                {showGsc && (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">GSC performance</h2>
                                    <p className="mt-1 text-sm text-gray-500">Top search queries from local Search Console data.</p>
                                </div>
                                <Badge variant={safeSummary.has_gsc_data ? 'green' : 'gray'}>GSC</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {queryRows.length === 0 ? (
                                <div className="p-8">
                                    <EmptyCard
                                        title="No synced GSC data"
                                        description="Sync a Search Console integration and apply a date range to see query data."
                                    />
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full">
                                        <thead>
                                            <tr>
                                                <th className="px-4 py-3 text-left   text-xs font-semibold uppercase tracking-wide text-gray-500">Query</th>
                                                <th className="px-4 py-3 text-right  text-xs font-semibold uppercase tracking-wide text-gray-500">Clicks</th>
                                                <th className="px-4 py-3 text-right  text-xs font-semibold uppercase tracking-wide text-gray-500">Impressions</th>
                                                <th className="px-4 py-3 text-right  text-xs font-semibold uppercase tracking-wide text-gray-500">CTR</th>
                                                <th className="px-4 py-3 text-right  text-xs font-semibold uppercase tracking-wide text-gray-500">Position</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {queryRows.map((q) => (
                                                <tr key={q.query} className="border-t border-gray-100">
                                                    <td className="max-w-[260px] truncate px-4 py-3 text-sm font-medium text-gray-900">{q.query}</td>
                                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{fmt(q.clicks)}</td>
                                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{fmt(q.impressions)}</td>
                                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{fmtDec(q.ctr)}%</td>
                                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{fmtOpt(q.average_position)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* GA4 performance */}
                {showGa4 && (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">GA4 performance</h2>
                                    <p className="mt-1 text-sm text-gray-500">Top landing pages from local Analytics 4 data.</p>
                                </div>
                                <Badge variant={safeSummary.has_ga4_data ? 'green' : 'gray'}>GA4</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {pageRows.length === 0 ? (
                                <div className="p-8">
                                    <EmptyCard
                                        title="No synced GA4 data"
                                        description="Sync a Google Analytics 4 integration and apply a date range to see landing page data."
                                    />
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full">
                                        <thead>
                                            <tr>
                                                <th className="px-4 py-3 text-left  text-xs font-semibold uppercase tracking-wide text-gray-500">Page</th>
                                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Sessions</th>
                                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Conversions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pageRows.map((p) => (
                                                <tr key={p.page_path} className="border-t border-gray-100">
                                                    <td className="max-w-[260px] truncate px-4 py-3 text-sm font-medium text-gray-900">{p.page_path}</td>
                                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{fmt(p.sessions)}</td>
                                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{fmt(p.conversions)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* SEO insights */}
                <Card>
                    <CardHeader>
                        <h2 className="text-lg font-semibold text-gray-900">SEO insights</h2>
                        <p className="mt-1 text-sm text-gray-500">Open insights relevant to this report.</p>
                    </CardHeader>
                    <CardContent>
                        {insightRows.length === 0 ? (
                            <EmptyCard
                                title="No SEO insights"
                                description="Generate insights from the SEO dashboard after analytics data has been synced."
                            />
                        ) : (
                            <div className="space-y-3">
                                {insightRows.map((insight) => (
                                    <div key={insight.id} className="rounded-lg border border-gray-200 p-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="font-medium text-gray-900">{insight.title}</h3>
                                            <Badge variant={severityVariant(insight.severity)}>{insight.severity}</Badge>
                                            <Badge variant={statusVariant(insight.status)}>{insight.status_label}</Badge>
                                        </div>
                                        <p className="mt-1 text-sm text-gray-600">{insight.summary}</p>
                                        {insight.website_name && (
                                            <p className="mt-1 text-xs text-gray-400">{insight.website_name}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Recommendations */}
                <Card>
                    <CardHeader>
                        <h2 className="text-lg font-semibold text-gray-900">Recommendations</h2>
                        <p className="mt-1 text-sm text-gray-500">Suggested actions based on open SEO insights.</p>
                    </CardHeader>
                    <CardContent>
                        {recommendations.length === 0 ? (
                            <EmptyCard
                                title="No recommendations yet"
                                description="Recommendations appear when SEO insights include actionable suggestions."
                            />
                        ) : (
                            <ol className="list-decimal list-inside space-y-3">
                                {recommendations.map((insight) => (
                                    <li key={insight.id} className="text-sm text-gray-700">
                                        <span className="font-medium text-gray-900">{insight.title}:</span>{' '}
                                        {insight.recommendation}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </CardContent>
                </Card>

            </div>
        </AppLayout>
    );
}
```

---

## Task 8: Run full test suite, typecheck, and build

- [ ] **Step 1: Run full test suite**

```bash
docker compose exec ultron-app php artisan test --no-coverage
```

Expected: all existing tests still pass + 5 new Reports tests.

- [ ] **Step 2: TypeScript check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build completes with no errors.

---

## Task 9: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add \
  app/Http/Requests/Reports/ReportPreviewRequest.php \
  app/Domains/Analytics/Actions/GetReportPreviewAction.php \
  app/Http/Controllers/ReportsController.php \
  routes/web.php \
  resources/js/layouts/AppLayout.tsx \
  resources/js/pages/reports/Index.tsx \
  tests/Feature/Reports/ReportsTest.php

git commit -m "$(cat <<'EOF'
feat: add reports preview foundation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify commit**

```bash
git log -1 --oneline
```

Expected: `<hash> feat: add reports preview foundation`
