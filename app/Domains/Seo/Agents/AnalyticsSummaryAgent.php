<?php

declare(strict_types=1);

namespace App\Domains\Seo\Agents;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsSearchPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Clients\Models\Website;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightType;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class AnalyticsSummaryAgent
{
    /**
     * @return list<array<string, mixed>>
     */
    public function analyze(Organization $organization): array
    {
        [$currentStart, $currentEnd, $previousStart, $previousEnd] = $this->comparisonWindows($organization);
        $lookbackStart = $currentEnd->copy()->subDays(29);

        return [
            ...$this->decliningPageClicks($organization, $currentStart, $currentEnd, $previousStart, $previousEnd),
            ...$this->highImpressionLowCtrQueries($organization, $lookbackStart, $currentEnd),
            ...$this->improvingPageImpressions($organization, $currentStart, $currentEnd, $previousStart, $previousEnd),
            ...$this->rankingOpportunities($organization, $lookbackStart, $currentEnd),
            ...$this->missingOrStaleSync($organization),
        ];
    }

    /**
     * @return array{Carbon, Carbon, Carbon, Carbon}
     */
    private function comparisonWindows(Organization $organization): array
    {
        $latestMetricDate = AnalyticsSearchPage::query()
            ->where('organization_id', $organization->id)
            ->max('metric_date');

        $currentEnd = $latestMetricDate ? Carbon::parse($latestMetricDate) : now();
        $currentStart = $currentEnd->copy()->subDays(6);
        $previousEnd = $currentStart->copy()->subDay();
        $previousStart = $previousEnd->copy()->subDays(6);

        return [$currentStart, $currentEnd, $previousStart, $previousEnd];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function decliningPageClicks(
        Organization $organization,
        Carbon $currentStart,
        Carbon $currentEnd,
        Carbon $previousStart,
        Carbon $previousEnd,
    ): array {
        return $this->pagePeriodRows($organization, $previousStart, $currentEnd)
            ->map(function (Collection $rows) use ($currentStart, $previousStart, $previousEnd, $currentEnd): ?array {
                $first = $rows->first();
                $previousClicks = $this->sumMetric($rows, 'clicks', $previousStart, $previousEnd);
                $currentClicks = $this->sumMetric($rows, 'clicks', $currentStart, $currentEnd);

                if ($previousClicks < 10 || $currentClicks > $previousClicks * 0.7) {
                    return null;
                }

                $drop = $previousClicks - $currentClicks;

                return $this->payload(
                    SeoInsightType::DecliningPageClicks,
                    'high',
                    'page',
                    (string) $first->page_url,
                    (int) $first->website_id,
                    'Page clicks are declining',
                    sprintf('%s lost %d clicks versus the previous period.', $first->page_url, $drop),
                    'Review the page title, meta description, SERP competitors, and any recent content or technical changes.',
                    $currentStart,
                    $currentEnd,
                    [
                        'previous_clicks' => $previousClicks,
                        'current_clicks' => $currentClicks,
                        'drop' => $drop,
                    ],
                );
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function highImpressionLowCtrQueries(Organization $organization, Carbon $dateFrom, Carbon $dateTo): array
    {
        return AnalyticsSearchQuery::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $dateFrom->toDateString())
            ->whereDate('metric_date', '<=', $dateTo->toDateString())
            ->selectRaw('website_id, query, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions')
            ->groupBy('website_id', 'query')
            ->get()
            ->map(function ($row) use ($dateFrom, $dateTo): ?array {
                $clicks = (int) $row->clicks;
                $impressions = (int) $row->impressions;
                $ctr = $this->ratio($clicks, $impressions) * 100;

                if ($impressions < 100 || $ctr >= 2.0) {
                    return null;
                }

                return $this->payload(
                    SeoInsightType::HighImpressionLowCtrQuery,
                    'medium',
                    'query',
                    (string) $row->query,
                    $row->website_id !== null ? (int) $row->website_id : null,
                    'High impressions with low CTR',
                    sprintf('"%s" has %d impressions but only %.2f%% CTR.', $row->query, $impressions, $ctr),
                    'Improve the SERP title and description, and align the landing page copy with search intent.',
                    $dateFrom,
                    $dateTo,
                    [
                        'clicks' => $clicks,
                        'impressions' => $impressions,
                        'ctr' => $ctr,
                    ],
                );
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function improvingPageImpressions(
        Organization $organization,
        Carbon $currentStart,
        Carbon $currentEnd,
        Carbon $previousStart,
        Carbon $previousEnd,
    ): array {
        return $this->pagePeriodRows($organization, $previousStart, $currentEnd)
            ->map(function (Collection $rows) use ($currentStart, $previousStart, $previousEnd, $currentEnd): ?array {
                $first = $rows->first();
                $previousImpressions = $this->sumMetric($rows, 'impressions', $previousStart, $previousEnd);
                $currentImpressions = $this->sumMetric($rows, 'impressions', $currentStart, $currentEnd);
                $gain = $currentImpressions - $previousImpressions;

                if ($currentImpressions < 100 || $gain < 50 || $currentImpressions < $previousImpressions * 1.25) {
                    return null;
                }

                return $this->payload(
                    SeoInsightType::ImprovingPageImpressions,
                    'low',
                    'page',
                    (string) $first->page_url,
                    (int) $first->website_id,
                    'Page impressions are improving',
                    sprintf('%s gained %d impressions versus the previous period.', $first->page_url, $gain),
                    'Protect the page momentum by refreshing content, strengthening internal links, and monitoring CTR.',
                    $currentStart,
                    $currentEnd,
                    [
                        'previous_impressions' => $previousImpressions,
                        'current_impressions' => $currentImpressions,
                        'gain' => $gain,
                    ],
                );
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function rankingOpportunities(Organization $organization, Carbon $dateFrom, Carbon $dateTo): array
    {
        return AnalyticsSearchQuery::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $dateFrom->toDateString())
            ->whereDate('metric_date', '<=', $dateTo->toDateString())
            ->selectRaw('website_id, query, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, AVG(NULLIF(average_position, 0)) as average_position')
            ->groupBy('website_id', 'query')
            ->get()
            ->map(function ($row) use ($dateFrom, $dateTo): ?array {
                $impressions = (int) $row->impressions;
                $position = $row->average_position !== null ? (float) $row->average_position : null;

                if ($position === null || $position < 4 || $position > 20 || $impressions < 50) {
                    return null;
                }

                return $this->payload(
                    SeoInsightType::RankingOpportunity,
                    'medium',
                    'query',
                    (string) $row->query,
                    $row->website_id !== null ? (int) $row->website_id : null,
                    'Keyword ranking opportunity',
                    sprintf('"%s" averages position %.2f with %d impressions.', $row->query, $position, $impressions),
                    'Expand the target page, add supporting internal links, and cover related questions to move toward page-one positions.',
                    $dateFrom,
                    $dateTo,
                    [
                        'clicks' => (int) $row->clicks,
                        'impressions' => $impressions,
                        'average_position' => round($position, 2),
                    ],
                );
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function missingOrStaleSync(Organization $organization): array
    {
        $staleBefore = now()->subDays(8);

        return Website::query()
            ->where('organization_id', $organization->id)
            ->get()
            ->map(function (Website $website) use ($staleBefore): ?array {
                $latestSync = AnalyticsSyncHistory::query()
                    ->where('organization_id', $website->organization_id)
                    ->where('website_id', $website->id)
                    ->where('status', AnalyticsSyncStatus::Completed->value)
                    ->latest('finished_at')
                    ->first();

                if ($latestSync !== null && $latestSync->finished_at !== null && $latestSync->finished_at->greaterThanOrEqualTo($staleBefore)) {
                    return null;
                }

                $status = $latestSync === null ? 'missing' : 'stale';

                return $this->payload(
                    SeoInsightType::MissingOrStaleSync,
                    'high',
                    'website',
                    $website->domain,
                    $website->id,
                    $status === 'missing' ? 'Website has no synced analytics data' : 'Website analytics sync is stale',
                    $status === 'missing'
                        ? sprintf('%s has no completed analytics sync history.', $website->domain)
                        : sprintf('%s last completed sync was %s.', $website->domain, $latestSync->finished_at?->toDateString() ?? 'unknown'),
                    'Run a manual sync for the website before making SEO decisions from its dashboard data.',
                    now()->subDays(30),
                    now(),
                    [
                        'sync_state' => $status,
                        'last_finished_at' => $latestSync?->finished_at?->toDateTimeString(),
                    ],
                );
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return Collection<string, Collection<int, AnalyticsSearchPage>>
     */
    private function pagePeriodRows(Organization $organization, Carbon $dateFrom, Carbon $dateTo): Collection
    {
        return AnalyticsSearchPage::query()
            ->where('organization_id', $organization->id)
            ->whereDate('metric_date', '>=', $dateFrom->toDateString())
            ->whereDate('metric_date', '<=', $dateTo->toDateString())
            ->get()
            ->groupBy(fn (AnalyticsSearchPage $page) => $page->website_id.'|'.$page->page_url);
    }

    private function sumMetric(Collection $rows, string $metric, Carbon $dateFrom, Carbon $dateTo): int
    {
        return (int) $rows
            ->filter(fn ($row) => $row->metric_date->betweenIncluded($dateFrom, $dateTo))
            ->sum($metric);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(
        SeoInsightType $type,
        string $severity,
        string $subjectType,
        string $subjectValue,
        ?int $websiteId,
        string $title,
        string $summary,
        string $recommendation,
        Carbon $dateFrom,
        Carbon $dateTo,
        array $evidence,
    ): array {
        return [
            'website_id' => $websiteId,
            'type' => $type,
            'severity' => $severity,
            'subject_type' => $subjectType,
            'subject_value' => $subjectValue,
            'title' => $title,
            'summary' => $summary,
            'recommendation' => $recommendation,
            'date_from' => $dateFrom->toDateString(),
            'date_to' => $dateTo->toDateString(),
            'evidence' => $evidence,
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
