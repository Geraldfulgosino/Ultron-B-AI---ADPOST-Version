<?php

declare(strict_types=1);

namespace App\Domains\Reports\Actions;

class BuildReportCsvAction
{
    /**
     * @param  array<string, mixed>  $reportData  output of GetReportPreviewAction::execute()
     */
    public function execute(array $reportData, string $organizationName): string
    {
        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            return '';
        }

        $write = fn (array $row) => fputcsv($handle, $row);

        $filters  = $reportData['filters'];
        $source   = (string) ($filters['source'] ?? 'all');
        $showGsc  = $source !== 'ga4';
        $showGa4  = $source !== 'gsc';

        $sourceLabel = match ($source) {
            'ga4'   => 'GA4 only',
            'gsc'   => 'GSC only',
            default => 'All',
        };

        $websiteLabel = 'All websites';
        if ($filters['website_id'] !== null) {
            $websites = $reportData['websites'] ?? [];
            foreach ($websites as $w) {
                if ((int) $w['id'] === (int) $filters['website_id']) {
                    $websiteLabel = $w['name'];
                    break;
                }
            }
        }

        // ── Header ───────────────────────────────────────────────────────────

        $write(['ULTRON-B AI Report Export']);
        $write(['Organization', $organizationName]);
        $write(['Date Range', $filters['date_from'].' to '.$filters['date_to']]);
        $write(['Source', $sourceLabel]);
        $write(['Website', $websiteLabel]);
        $write(['Generated', now()->toDateTimeString()]);
        $write([]);

        // ── No data ───────────────────────────────────────────────────────────

        if (! $reportData['has_report_data']) {
            $write(['No report data for selected range.']);

            rewind($handle);
            $content = (string) stream_get_contents($handle);
            fclose($handle);

            return $content;
        }

        // ── Summary metrics ───────────────────────────────────────────────────

        $summary = $reportData['summary'];

        $write(['SUMMARY METRICS']);
        if ($showGsc) {
            $write(['GSC Clicks',      $summary['gsc_clicks']]);
            $write(['GSC Impressions', $summary['gsc_impressions']]);
        }
        if ($showGa4) {
            $write(['GA4 Sessions',    $summary['ga4_sessions']]);
            $write(['GA4 Conversions', $summary['ga4_conversions']]);
        }
        $write([]);

        // ── Daily trends ─────────────────────────────────────────────────────

        $trends = $reportData['trends'];

        if ($showGsc && ! empty($trends['gsc_clicks'])) {
            $write(['DAILY TRENDS - GSC Clicks']);
            $write(['Date', 'Clicks']);
            foreach ($trends['gsc_clicks'] as $row) {
                $write([$row['date'], $row['value']]);
            }
            $write([]);
        }

        if ($showGsc && ! empty($trends['gsc_impressions'])) {
            $write(['DAILY TRENDS - GSC Impressions']);
            $write(['Date', 'Impressions']);
            foreach ($trends['gsc_impressions'] as $row) {
                $write([$row['date'], $row['value']]);
            }
            $write([]);
        }

        if ($showGa4 && ! empty($trends['ga4_sessions'])) {
            $write(['DAILY TRENDS - GA4 Sessions']);
            $write(['Date', 'Sessions']);
            foreach ($trends['ga4_sessions'] as $row) {
                $write([$row['date'], $row['value']]);
            }
            $write([]);
        }

        // ── Top queries ───────────────────────────────────────────────────────

        if ($showGsc) {
            $write(['TOP QUERIES']);
            $write(['Query', 'Clicks']);
            if (empty($reportData['top_queries'])) {
                $write(['No data']);
            } else {
                foreach ($reportData['top_queries'] as $row) {
                    $write([$row['query'], $row['clicks']]);
                }
            }
            $write([]);
        }

        // ── Top pages ─────────────────────────────────────────────────────────

        if ($showGa4) {
            $write(['TOP PAGES']);
            $write(['Page Path', 'Sessions']);
            if (empty($reportData['top_pages'])) {
                $write(['No data']);
            } else {
                foreach ($reportData['top_pages'] as $row) {
                    $write([$row['page_path'], $row['sessions']]);
                }
            }
            $write([]);
        }

        // ── SEO insights ──────────────────────────────────────────────────────

        $write(['SEO INSIGHTS']);
        $insights = $reportData['seo_insights'] ?? [];
        if (empty($insights)) {
            $write(['No SEO insights available.']);
        } else {
            $write(['Title', 'Type', 'Severity', 'Status']);
            foreach ($insights as $insight) {
                $write([
                    $insight['title'] ?? '',
                    $insight['type_label'] ?? '',
                    $insight['severity'] ?? '',
                    $insight['status_label'] ?? '',
                ]);
            }
        }
        $write([]);

        rewind($handle);
        $content = (string) stream_get_contents($handle);
        fclose($handle);

        return $content;
    }
}
