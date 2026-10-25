<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Actions;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class GetSeoDashboardDataAction
{
    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds  null = no restriction (admin/owner/member), array = client scope
     * @return array<string, mixed>
     */
    public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): array
    {
        $dailyQuery = $this->dailyQuery($organization, $filters, $allowedWebsiteIds);
        $dailyTotals = (clone $dailyQuery)
            ->selectRaw('COALESCE(SUM(sessions), 0) as sessions, COALESCE(SUM(conversions), 0) as conversions, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions')
            ->first();
        $averagePosition = (clone $dailyQuery)
            ->where('average_position', '>', 0)
            ->avg('average_position');
        $clicks = (int) ($dailyTotals?->clicks ?? 0);
        $impressions = (int) ($dailyTotals?->impressions ?? 0);
        $latestSync = $this->syncQuery($organization, $filters, $allowedWebsiteIds)
            ->latest()
            ->first();

        return [
            'filters' => $filters,
            'stats' => [
                'websites' => $organization->websites()
                    ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
                    ->count(),
                'connected_integrations' => $organization->integrations()
                    ->where('status', IntegrationStatus::Connected->value)
                    ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
                    ->count(),
                'keywords_tracked' => $this->searchQuery($organization, $filters, $allowedWebsiteIds)->distinct()->count('query'),
                'clicks' => $clicks,
                'impressions' => $impressions,
                'ctr' => $this->ratio($clicks, $impressions) * 100,
                'average_position' => $averagePosition !== null ? round((float) $averagePosition, 2) : null,
                'organic_sessions' => (int) ($dailyTotals?->sessions ?? 0),
                'conversions' => (int) ($dailyTotals?->conversions ?? 0),
                'has_synced_data' => (clone $dailyQuery)->exists(),
                'last_sync_status' => $latestSync?->status->label(),
                'last_sync_at' => $latestSync?->finished_at?->toDateTimeString()
                    ?? $latestSync?->created_at?->toDateTimeString(),
            ],
            'websites' => $this->websites($organization, $allowedWebsiteIds),
            'trends' => $this->trends($organization, $filters, $allowedWebsiteIds),
            'landingPages' => $this->landingPages($organization, $filters, $allowedWebsiteIds),
            'searchQueries' => $this->searchQueries($organization, $filters, $allowedWebsiteIds),
            'latestSync' => $latestSync ? [
                'provider' => $latestSync->provider->label(),
                'status' => $latestSync->status->label(),
                'records_synced' => $latestSync->records_synced,
                'finished_at' => $latestSync->finished_at?->toDateTimeString(),
                'error_message' => $latestSync->error_message,
            ] : null,
        ];
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Builder<AnalyticsDailyMetric>
     */
    private function dailyQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): Builder
    {
        return AnalyticsDailyMetric::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds));
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Builder<AnalyticsSearchQuery>
     */
    private function searchQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): Builder
    {
        return AnalyticsSearchQuery::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $filters['date_from'])
            ->whereDate('metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds));
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Builder<AnalyticsSyncHistory>
     */
    private function syncQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): Builder
    {
        return AnalyticsSyncHistory::query()
            ->where('organization_id', $organization->id)
            ->where(function (Builder $query) use ($filters): void {
                $query->whereNull('date_from')
                    ->orWhere('date_from', '<=', $filters['date_to']);
            })
            ->where(function (Builder $query) use ($filters): void {
                $query->whereNull('date_to')
                    ->orWhere('date_to', '>=', $filters['date_from']);
            })
            ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds));
    }

    /**
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{id: int, name: string, domain: string, client_name: string, status: string, last_synced_at: string|null}>
     */
    private function websites(Organization $organization, ?array $allowedWebsiteIds = null): Collection
    {
        return $organization->websites()
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
            ->with('client')
            ->latest()
            ->get()
            ->map(fn ($website) => [
                'id' => $website->id,
                'name' => $website->name,
                'domain' => $website->domain,
                'client_name' => $website->client->name,
                'status' => $website->status->value,
                'last_synced_at' => AnalyticsSyncHistory::query()
                    ->where('organization_id', $organization->id)
                    ->where('website_id', $website->id)
                    ->latest()
                    ->first()?->created_at?->toDateTimeString(),
            ]);
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{page_path: string, sessions: int, conversions: int, clicks: int, impressions: int, ctr: float}>
     */
    private function landingPages(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): Collection
    {
        return AnalyticsLandingPage::query()
            ->where('analytics_landing_pages.organization_id', $organization->id)
            ->whereDate('analytics_landing_pages.metric_date', '>=', $filters['date_from'])
            ->whereDate('analytics_landing_pages.metric_date', '<=', $filters['date_to'])
            ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('analytics_landing_pages.website_id', $filters['website_id']))
            ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('analytics_landing_pages.website_id', $allowedWebsiteIds))
            ->leftJoin('analytics_search_pages', function ($join) use ($organization, $filters): void {
                $join->on('analytics_landing_pages.organization_id', '=', 'analytics_search_pages.organization_id')
                    ->on('analytics_landing_pages.website_id', '=', 'analytics_search_pages.website_id')
                    ->on('analytics_landing_pages.metric_date', '=', 'analytics_search_pages.metric_date')
                    ->on('analytics_landing_pages.page_path_hash', '=', 'analytics_search_pages.page_url_hash')
                    ->where('analytics_search_pages.organization_id', $organization->id)
                    ->whereDate('analytics_search_pages.metric_date', '>=', $filters['date_from'])
                    ->whereDate('analytics_search_pages.metric_date', '<=', $filters['date_to']);
            })
            ->selectRaw('analytics_landing_pages.page_path as page_path, COALESCE(SUM(analytics_landing_pages.sessions), 0) as sessions, COALESCE(SUM(analytics_landing_pages.conversions), 0) as conversions, COALESCE(SUM(analytics_search_pages.clicks), 0) as clicks, COALESCE(SUM(analytics_search_pages.impressions), 0) as impressions')
            ->groupBy('analytics_landing_pages.page_path')
            ->orderByDesc('sessions')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'page_path' => (string) $row->page_path,
                'sessions' => (int) $row->sessions,
                'conversions' => (int) $row->conversions,
                'clicks' => (int) $row->clicks,
                'impressions' => (int) $row->impressions,
                'ctr' => $this->ratio((int) $row->clicks, (int) $row->impressions) * 100,
            ]);
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return Collection<int, array{query: string, clicks: int, impressions: int, ctr: float, average_position: float|null}>
     */
    private function searchQueries(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): Collection
    {
        return $this->searchQuery($organization, $filters, $allowedWebsiteIds)
            ->selectRaw('query, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, AVG(NULLIF(average_position, 0)) as average_position')
            ->groupBy('query')
            ->orderByDesc('clicks')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'query' => (string) $row->query,
                'clicks' => (int) $row->clicks,
                'impressions' => (int) $row->impressions,
                'ctr' => $this->ratio((int) $row->clicks, (int) $row->impressions) * 100,
                'average_position' => $row->average_position !== null ? round((float) $row->average_position, 2) : null,
            ]);
    }

    /**
     * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
     * @param  list<int>|null  $allowedWebsiteIds
     * @return array{gsc_clicks: Collection<int, array{date: string, value: int}>, gsc_impressions: Collection<int, array{date: string, value: int}>, ga4_organic_sessions: Collection<int, array{date: string, value: int}>}
     */
    private function trends(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): array
    {
        $rows = $this->dailyQuery($organization, $filters, $allowedWebsiteIds)
            ->selectRaw('metric_date, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, COALESCE(SUM(sessions), 0) as sessions')
            ->groupBy('metric_date')
            ->orderBy('metric_date')
            ->get();

        return [
            'gsc_clicks' => $rows
                ->filter(fn ($row) => (int) $row->clicks > 0)
                ->map(fn ($row) => [
                    'date' => (string) $row->metric_date,
                    'value' => (int) $row->clicks,
                ])
                ->values(),
            'gsc_impressions' => $rows
                ->filter(fn ($row) => (int) $row->impressions > 0)
                ->map(fn ($row) => [
                    'date' => (string) $row->metric_date,
                    'value' => (int) $row->impressions,
                ])
                ->values(),
            'ga4_organic_sessions' => $rows
                ->filter(fn ($row) => (int) $row->sessions > 0)
                ->map(fn ($row) => [
                    'date' => (string) $row->metric_date,
                    'value' => (int) $row->sessions,
                ])
                ->values(),
        ];
    }

    private function ratio(int $numerator, int $denominator): float
    {
        if ($denominator === 0) {
            return 0.0;
        }

        return round($numerator / $denominator, 4);
    }
}
