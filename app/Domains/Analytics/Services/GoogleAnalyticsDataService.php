<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Services;

use App\Domains\Integrations\Models\Integration;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class GoogleAnalyticsDataService
{
    /**
     * @return list<array{metric_date: string, sessions: int, active_users: int, new_users: int, screen_page_views: int, conversions: int, total_revenue: float}>
     */
    public function fetchDailyMetrics(Integration $integration, string $dateFrom, string $dateTo): array
    {
        $report = $this->runReport($integration, $dateFrom, $dateTo, ['date'], [
            'sessions',
            'activeUsers',
            'newUsers',
            'screenPageViews',
            'conversions',
            'totalRevenue',
        ]);

        return array_map(fn (array $row) => [
            'metric_date' => $this->formatDate($row['dimensions'][0] ?? ''),
            'sessions' => (int) ($row['metrics'][0] ?? 0),
            'active_users' => (int) ($row['metrics'][1] ?? 0),
            'new_users' => (int) ($row['metrics'][2] ?? 0),
            'screen_page_views' => (int) ($row['metrics'][3] ?? 0),
            'conversions' => (int) ($row['metrics'][4] ?? 0),
            'total_revenue' => (float) ($row['metrics'][5] ?? 0),
        ], $report);
    }

    /**
     * @return list<array{metric_date: string, page_path: string, sessions: int, active_users: int, screen_page_views: int, conversions: int, total_revenue: float}>
     */
    public function fetchLandingPages(Integration $integration, string $dateFrom, string $dateTo): array
    {
        $report = $this->runReport($integration, $dateFrom, $dateTo, ['date', 'landingPagePlusQueryString'], [
            'sessions',
            'activeUsers',
            'screenPageViews',
            'conversions',
            'totalRevenue',
        ]);

        return array_map(fn (array $row) => [
            'metric_date' => $this->formatDate($row['dimensions'][0] ?? ''),
            'page_path' => (string) ($row['dimensions'][1] ?? '(not set)'),
            'sessions' => (int) ($row['metrics'][0] ?? 0),
            'active_users' => (int) ($row['metrics'][1] ?? 0),
            'screen_page_views' => (int) ($row['metrics'][2] ?? 0),
            'conversions' => (int) ($row['metrics'][3] ?? 0),
            'total_revenue' => (float) ($row['metrics'][4] ?? 0),
        ], $report);
    }

    /**
     * @param  list<string>  $dimensions
     * @param  list<string>  $metrics
     * @return list<array{dimensions: list<string>, metrics: list<string>}>
     */
    private function runReport(Integration $integration, string $dateFrom, string $dateTo, array $dimensions, array $metrics): array
    {
        $propertyId = $integration->website?->ga4_property_id
            ?: $integration->external_property_id;

        if (! $propertyId) {
            throw new RuntimeException('Google Analytics property ID is missing.');
        }

        if (! $integration->access_token) {
            throw new RuntimeException('Google Analytics access token is missing.');
        }

        $response = Http::withToken($integration->access_token)
            ->post("https://analyticsdata.googleapis.com/v1beta/properties/{$propertyId}:runReport", [
                'dateRanges' => [['startDate' => $dateFrom, 'endDate' => $dateTo]],
                'dimensions' => array_map(fn (string $name) => ['name' => $name], $dimensions),
                'metrics' => array_map(fn (string $name) => ['name' => $name], $metrics),
                'limit' => 10000,
            ])
            ->throw()
            ->json();

        return array_map(fn (array $row) => [
            'dimensions' => array_map(fn (array $value) => (string) ($value['value'] ?? ''), $row['dimensionValues'] ?? []),
            'metrics' => array_map(fn (array $value) => (string) ($value['value'] ?? '0'), $row['metricValues'] ?? []),
        ], $response['rows'] ?? []);
    }

    private function formatDate(string $value): string
    {
        if (preg_match('/^\d{8}$/', $value) !== 1) {
            throw new RuntimeException('Google Analytics returned an invalid metric date.');
        }

        return substr($value, 0, 4).'-'.substr($value, 4, 2).'-'.substr($value, 6, 2);
    }
}
