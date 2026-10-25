<?php

declare(strict_types=1);

namespace App\Domains\Reports\Actions;

use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Support\Str;

class BuildReportPdfAction
{
    /**
     * @param  array<string, mixed>  $reportData  output of GetReportPreviewAction::execute()
     */
    public function execute(array $reportData, string $organizationName): string
    {
        $viewData = $this->buildViewData($reportData, $organizationName);

        return Pdf::loadView('reports.pdf', $viewData)
            ->setPaper('a4', 'portrait')
            ->output();
    }

    /** @return array<string, mixed> */
    private function buildViewData(array $reportData, string $organizationName): array
    {
        $filters  = $reportData['filters'];
        $source   = (string) ($filters['source'] ?? 'all');
        $showGsc  = $source !== 'ga4';
        $showGa4  = $source !== 'gsc';

        $sourceLabel = match ($source) {
            'ga4'   => 'GA4 only',
            'gsc'   => 'GSC only',
            default => 'All sources',
        };

        $websiteLabel = 'All websites';
        if ($filters['website_id'] !== null) {
            foreach ($reportData['websites'] ?? [] as $w) {
                if ((int) $w['id'] === (int) $filters['website_id']) {
                    $websiteLabel = $w['name'].' ('.$w['domain'].')';
                    break;
                }
            }
        }

        $reportType  = $this->resolveReportType($filters['date_from'], $filters['date_to']);
        $summary     = $reportData['summary'] ?? [];
        $trends      = $reportData['trends'] ?? [];
        $seoInsights = $reportData['seo_insights'] ?? [];

        return [
            'organizationName' => $organizationName,
            'reportType'       => $reportType,
            'websiteLabel'     => $websiteLabel,
            'sourceLabel'      => $sourceLabel,
            'generatedAt'      => now()->format('Y-m-d H:i'),
            'filters'          => $filters,
            'hasData'          => (bool) ($reportData['has_report_data'] ?? false),
            'showGsc'          => $showGsc,
            'showGa4'          => $showGa4,
            'summary'          => $summary,
            'gscTrends'        => $this->mergeGscTrends($trends),
            'ga4Trends'        => $trends['ga4_sessions'] ?? [],
            'topQueries'       => $reportData['top_queries'] ?? [],
            'topPages'         => $reportData['top_pages'] ?? [],
            'seoInsights'      => $seoInsights,
            'executiveSummary' => $this->buildExecutiveSummary($reportData, $reportType, $sourceLabel),
            'recommendations'  => $this->buildRecommendations($reportData, $source),
        ];
    }

    private function resolveReportType(string $dateFrom, string $dateTo): string
    {
        $days = Carbon::parse($dateFrom)->diffInDays(Carbon::parse($dateTo));

        return match (true) {
            $days <= 7                  => 'Weekly Report',
            $days >= 28 && $days <= 31 => 'Monthly Report',
            default                    => 'Custom Report',
        };
    }

    /**
     * Merge gsc_clicks + gsc_impressions arrays (keyed by date) into combined rows.
     *
     * @param  array<string, mixed>  $trends
     * @return list<array{date: string, clicks: int, impressions: int}>
     */
    private function mergeGscTrends(array $trends): array
    {
        $byDate = [];

        foreach ($trends['gsc_clicks'] ?? [] as $row) {
            $byDate[$row['date']]['clicks'] = (int) $row['value'];
        }

        foreach ($trends['gsc_impressions'] ?? [] as $row) {
            $byDate[$row['date']]['impressions'] = (int) $row['value'];
        }

        ksort($byDate);

        return array_map(
            fn (string $date, array $vals) => [
                'date'        => $date,
                'clicks'      => $vals['clicks'] ?? 0,
                'impressions' => $vals['impressions'] ?? 0,
            ],
            array_keys($byDate),
            array_values($byDate),
        );
    }

    private function buildExecutiveSummary(array $reportData, string $reportType, string $sourceLabel): string
    {
        $filters = $reportData['filters'];
        $from    = $filters['date_from'];
        $to      = $filters['date_to'];

        if (! $reportData['has_report_data']) {
            return "No data is available for the selected date range ({$from} to {$to}). "
                ."This may be because analytics data has not yet been synced for this period, "
                ."or no website data exists for the selected filters.";
        }

        $summary = $reportData['summary'];
        $source  = $filters['source'];
        $parts   = [];

        $parts[] = "This {$reportType} covers {$sourceLabel} performance data from {$from} to {$to}.";

        if ($source !== 'ga4' && ($summary['gsc_impressions'] ?? 0) > 0) {
            $parts[] = "Your website appeared in Google Search ".number_format((int) $summary['gsc_impressions'])." times "
                ."and received ".number_format((int) $summary['gsc_clicks'])." organic clicks during this period.";
        }

        if ($source !== 'gsc' && ($summary['ga4_sessions'] ?? 0) > 0) {
            $parts[] = "Google Analytics recorded ".number_format((int) $summary['ga4_sessions'])." organic sessions "
                ."with ".number_format((int) $summary['ga4_conversions'])." conversions.";
        }

        $insightCount = count($reportData['seo_insights'] ?? []);
        if ($insightCount > 0) {
            $parts[] = "{$insightCount} SEO insight(s) have been identified and are detailed in the SEO Insights section below.";
        }

        return implode(' ', $parts);
    }

    /** @return list<string> */
    private function buildRecommendations(array $reportData, string $source): array
    {
        if (! $reportData['has_report_data']) {
            return [];
        }

        $recs    = [];
        $summary = $reportData['summary'];

        if ($source !== 'ga4') {
            $impressions = (int) ($summary['gsc_impressions'] ?? 0);
            $clicks      = (int) ($summary['gsc_clicks'] ?? 0);

            if ($impressions > 0 && $clicks === 0) {
                $recs[] = 'Pages are appearing in search results but receiving no clicks. Review title tags and meta descriptions to improve click-through rate.';
            } elseif ($impressions > 0 && $clicks > 0) {
                $ctr = round(($clicks / $impressions) * 100, 1);
                if ($ctr < 3) {
                    $recs[] = "Current GSC click-through rate is {$ctr}% — below the 3% benchmark. Improving meta titles and descriptions for top-impression keywords is recommended.";
                }
            }

            if (! empty($reportData['top_queries'])) {
                $recs[] = 'Consolidate content around your top-performing search queries to strengthen existing rankings and improve topical authority.';
            }
        }

        if ($source !== 'gsc') {
            $sessions     = (int) ($summary['ga4_sessions'] ?? 0);
            $conversions  = (int) ($summary['ga4_conversions'] ?? 0);

            if ($sessions > 0 && $conversions === 0) {
                $recs[] = 'Organic traffic is arriving but not converting. Review landing page calls-to-action, page speed, and conversion paths.';
            }

            if (! empty($reportData['top_pages'])) {
                $recs[] = 'Optimize your top-performing landing pages to sustain and grow their organic session counts.';
            }
        }

        $insights     = $reportData['seo_insights'] ?? [];
        $highSeverity = array_filter($insights, fn ($i) => strtolower((string) ($i['severity'] ?? '')) === 'high');

        if (! empty($highSeverity)) {
            $count  = count($highSeverity);
            $recs[] = "Address the {$count} high-severity SEO insight(s) identified in this report to resolve priority technical issues.";
        }

        return $recs;
    }
}
