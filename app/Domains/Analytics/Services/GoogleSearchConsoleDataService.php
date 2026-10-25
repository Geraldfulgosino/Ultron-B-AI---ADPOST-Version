<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Services;

use App\Domains\Integrations\Models\Integration;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class GoogleSearchConsoleDataService
{
    /**
     * @return list<array{metric_date: string, clicks: int, impressions: int, ctr: float, average_position: float}>
     */
    public function fetchDailyMetrics(Integration $integration, string $dateFrom, string $dateTo): array
    {
        $rows = $this->query($integration, $dateFrom, $dateTo, ['date']);

        return array_map(fn (array $row) => [
            'metric_date' => (string) ($row['keys'][0] ?? ''),
            'clicks' => (int) ($row['clicks'] ?? 0),
            'impressions' => (int) ($row['impressions'] ?? 0),
            'ctr' => (float) ($row['ctr'] ?? 0),
            'average_position' => (float) ($row['position'] ?? 0),
        ], $rows);
    }

    /**
     * @return list<array{metric_date: string, query: string, clicks: int, impressions: int, ctr: float, average_position: float}>
     */
    public function fetchQueries(Integration $integration, string $dateFrom, string $dateTo): array
    {
        $rows = $this->query($integration, $dateFrom, $dateTo, ['date', 'query']);

        return array_map(fn (array $row) => [
            'metric_date' => (string) ($row['keys'][0] ?? ''),
            'query' => (string) ($row['keys'][1] ?? ''),
            'clicks' => (int) ($row['clicks'] ?? 0),
            'impressions' => (int) ($row['impressions'] ?? 0),
            'ctr' => (float) ($row['ctr'] ?? 0),
            'average_position' => (float) ($row['position'] ?? 0),
        ], $rows);
    }

    /**
     * @return list<array{metric_date: string, page_url: string, clicks: int, impressions: int, ctr: float, average_position: float}>
     */
    public function fetchPages(Integration $integration, string $dateFrom, string $dateTo): array
    {
        $rows = $this->query($integration, $dateFrom, $dateTo, ['date', 'page']);

        return array_map(fn (array $row) => [
            'metric_date' => (string) ($row['keys'][0] ?? ''),
            'page_url' => (string) ($row['keys'][1] ?? ''),
            'clicks' => (int) ($row['clicks'] ?? 0),
            'impressions' => (int) ($row['impressions'] ?? 0),
            'ctr' => (float) ($row['ctr'] ?? 0),
            'average_position' => (float) ($row['position'] ?? 0),
        ], $rows);
    }

    /**
     * @param  list<string>  $dimensions
     * @return list<array<string, mixed>>
     */
    private function query(Integration $integration, string $dateFrom, string $dateTo, array $dimensions): array
    {
        $siteUrl = $integration->website?->gsc_site_url
            ?: $integration->external_property_id
            ?: $integration->website?->domain;

        if (! $siteUrl) {
            throw new RuntimeException('Search Console site URL is missing.');
        }

        if (! $integration->access_token) {
            throw new RuntimeException('Search Console access token is missing.');
        }

        $response = Http::withToken($integration->access_token)
            ->post('https://searchconsole.googleapis.com/webmasters/v3/sites/'.rawurlencode($siteUrl).'/searchAnalytics/query', [
                'startDate' => $dateFrom,
                'endDate' => $dateTo,
                'dimensions' => $dimensions,
                'rowLimit' => 25000,
            ])
            ->throw()
            ->json();

        return $response['rows'] ?? [];
    }
}
