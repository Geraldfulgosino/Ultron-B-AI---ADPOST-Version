<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Actions;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Clients\Enums\WebsiteStatus;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class GetDashboardSummaryAction
{
    /**
     * @param  list<int>|null  $allowedWebsiteIds
     * @return array{
     *     clients_count: int,
     *     websites_count: int,
     *     connected_integrations_count: int,
     *     last_sync_status: string|null,
     *     last_sync_at: string|null,
     *     gsc_clicks: int,
     *     gsc_impressions: int,
     *     ga4_organic_sessions: int,
     *     open_seo_insights_count: int,
     *     recent_seo_insights: Collection<int, array{id: int, title: string, summary: string, status: string, status_label: string, severity: string, website_name: string|null, created_at: string|null}>,
     *     has_synced_data: bool
     * }
     */
    public function execute(Organization $organization, ?int $scopedClientId, ?array $allowedWebsiteIds): array
    {
        $dailyTotals = AnalyticsDailyMetric::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds))
            ->selectRaw('COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, COALESCE(SUM(sessions), 0) as sessions')
            ->first();

        $latestSync = AnalyticsSyncHistory::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds))
            ->latest()
            ->first();

        $openStatuses = [
            SeoInsightStatus::Pending->value,
            SeoInsightStatus::Reviewed->value,
            SeoInsightStatus::Approved->value,
        ];

        return [
            'clients_count' => $organization->clients()
                ->when($scopedClientId !== null, fn ($query) => $query->where('id', $scopedClientId))
                ->count(),
            'websites_count' => $organization->websites()
                ->where('status', WebsiteStatus::Active->value)
                ->when($allowedWebsiteIds !== null, fn ($query) => $query->whereIn('id', $allowedWebsiteIds))
                ->count(),
            'connected_integrations_count' => $organization->integrations()
                ->where('status', IntegrationStatus::Connected->value)
                ->when($allowedWebsiteIds !== null, fn ($query) => $query->whereIn('website_id', $allowedWebsiteIds))
                ->count(),
            'last_sync_status' => $latestSync?->status->label(),
            'last_sync_at' => $latestSync?->finished_at?->toDateTimeString()
                ?? $latestSync?->created_at?->toDateTimeString(),
            'gsc_clicks' => (int) ($dailyTotals?->clicks ?? 0),
            'gsc_impressions' => (int) ($dailyTotals?->impressions ?? 0),
            'ga4_organic_sessions' => (int) ($dailyTotals?->sessions ?? 0),
            'open_seo_insights_count' => SeoInsight::query()
                ->where('organization_id', $organization->id)
                ->whereIn('status', $openStatuses)
                ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds))
                ->count(),
            'recent_seo_insights' => SeoInsight::query()
                ->where('organization_id', $organization->id)
                ->whereIn('status', $openStatuses)
                ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds))
                ->with('website')
                ->latest()
                ->limit(5)
                ->get()
                ->map(fn (SeoInsight $insight) => [
                    'id' => $insight->id,
                    'title' => $insight->title,
                    'summary' => $insight->summary,
                    'status' => $insight->status->value,
                    'status_label' => $insight->status->label(),
                    'severity' => $insight->severity,
                    'website_name' => $insight->website?->name,
                    'created_at' => $insight->created_at?->toDateTimeString(),
                ]),
            'has_synced_data' => AnalyticsDailyMetric::query()
                ->where('organization_id', $organization->id)
                ->when($allowedWebsiteIds !== null, fn (Builder $query) => $query->whereIn('website_id', $allowedWebsiteIds))
                ->exists(),
        ];
    }
}
