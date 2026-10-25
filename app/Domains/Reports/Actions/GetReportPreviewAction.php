<?php

declare(strict_types=1);

namespace App\Domains\Reports\Actions;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Actions\GetSeoInsightsForDashboardAction;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class GetReportPreviewAction
{
    public function __construct(
        private readonly GetSeoInsightsForDashboardAction $seoInsights,
    ) {}

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds  null = no restriction, array = client scope
     * @return array<string, mixed>
     */
    public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): array
    {
        $source = $filters['source'];
        $dailyQuery = $this->dailyQuery($organization, $filters, $allowedWebsiteIds);

        $totals = (clone $dailyQuery)
            ->selectRaw(
                'COALESCE(SUM(clicks), 0) as gsc_clicks,'.
                ' COALESCE(SUM(impressions), 0) as gsc_impressions,'.
                ' COALESCE(SUM(sessions), 0) as ga4_sessions,'.
                ' COALESCE(SUM(conversions), 0) as ga4_conversions'
            )
            ->first();

        $topQueries = $source !== 'ga4'
            ? $this->buildTopQueries($organization, $filters, $allowedWebsiteIds)
            : [];

        $topPages = $source !== 'gsc'
            ? $this->buildTopPages($organization, $filters, $allowedWebsiteIds)
            : [];

        return [
            'filters'         => $filters,
            'websites'        => $this->buildWebsitesList($organization, $allowedWebsiteIds),
            'has_report_data' => (clone $dailyQuery)->exists(),
            'summary' => [
                'gsc_clicks'      => $source !== 'ga4' ? (int) ($totals?->gsc_clicks ?? 0) : 0,
                'gsc_impressions' => $source !== 'ga4' ? (int) ($totals?->gsc_impressions ?? 0) : 0,
                'ga4_sessions'    => $source !== 'gsc' ? (int) ($totals?->ga4_sessions ?? 0) : 0,
                'ga4_conversions' => $source !== 'gsc' ? (int) ($totals?->ga4_conversions ?? 0) : 0,
            ],
            'trends'       => $this->buildTrends($dailyQuery, $source),
            'top_queries'  => $topQueries,
            'top_pages'    => $topPages,
            'seo_insights' => $this->seoInsights->execute($organization, $allowedWebsiteIds)->values()->all(),
        ];
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Builder<AnalyticsDailyMetric>
     */
    private function dailyQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): Builder
    {
        return AnalyticsDailyMetric::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds));
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return list<array{query: string, clicks: int}>
     */
    private function buildTopQueries(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): array
    {
        return AnalyticsSearchQuery::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->selectRaw('query, COALESCE(SUM(clicks), 0) as clicks')
            ->groupBy('query')
            ->orderByDesc('clicks')
            ->limit(10)
            ->get()
            ->map(fn ($row) => ['query' => (string) $row->query, 'clicks' => (int) $row->clicks])
            ->values()
            ->all();
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return list<array{page_path: string, sessions: int}>
     */
    private function buildTopPages(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): array
    {
        return AnalyticsLandingPage::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $q) => $q->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->selectRaw('page_path, COALESCE(SUM(sessions), 0) as sessions')
            ->groupBy('page_path')
            ->orderByDesc('sessions')
            ->limit(10)
            ->get()
            ->map(fn ($row) => ['page_path' => (string) $row->page_path, 'sessions' => (int) $row->sessions])
            ->values()
            ->all();
    }

    /**
     * @param  Builder<AnalyticsDailyMetric>  $dailyQuery  already scoped to org, dates, website_id, allowedWebsiteIds
     * @return array{gsc_clicks: list<array{date: string, value: int}>, gsc_impressions: list<array{date: string, value: int}>, ga4_sessions: list<array{date: string, value: int}>}
     */
    private function buildTrends(Builder $dailyQuery, string $source): array
    {
        $rows = (clone $dailyQuery)
            ->selectRaw(
                'DATE(metric_date) as trend_date,'.
                ' COALESCE(SUM(clicks), 0) as clicks,'.
                ' COALESCE(SUM(impressions), 0) as impressions,'.
                ' COALESCE(SUM(sessions), 0) as sessions'
            )
            ->groupBy('trend_date')
            ->orderBy('trend_date')
            ->get();

        $gscClicks = $source !== 'ga4'
            ? $rows->filter(fn ($r) => (int) $r->clicks > 0)
                ->map(fn ($r) => ['date' => (string) $r->trend_date, 'value' => (int) $r->clicks])
                ->values()->all()
            : [];

        $gscImpressions = $source !== 'ga4'
            ? $rows->filter(fn ($r) => (int) $r->impressions > 0)
                ->map(fn ($r) => ['date' => (string) $r->trend_date, 'value' => (int) $r->impressions])
                ->values()->all()
            : [];

        $ga4Sessions = $source !== 'gsc'
            ? $rows->filter(fn ($r) => (int) $r->sessions > 0)
                ->map(fn ($r) => ['date' => (string) $r->trend_date, 'value' => (int) $r->sessions])
                ->values()->all()
            : [];

        return [
            'gsc_clicks'      => $gscClicks,
            'gsc_impressions' => $gscImpressions,
            'ga4_sessions'    => $ga4Sessions,
        ];
    }

    /**
     * @param  list<int>|null  $allowedWebsiteIds
     * @return list<array{id: int, name: string, domain: string, client_name: string}>
     */
    private function buildWebsitesList(Organization $organization, ?array $allowedWebsiteIds = null): array
    {
        return $organization->websites()
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
            ->with('client')
            ->orderBy('name')
            ->get()
            ->map(fn ($w) => [
                'id'          => $w->id,
                'name'        => $w->name,
                'domain'      => $w->domain,
                'client_name' => $w->client->name,
            ])
            ->values()
            ->all();
    }
}
