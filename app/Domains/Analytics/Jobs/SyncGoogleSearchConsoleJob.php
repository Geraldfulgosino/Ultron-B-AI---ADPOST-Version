<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Jobs;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsSearchPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Analytics\Services\GoogleSearchConsoleDataService;
use App\Domains\Integrations\Enums\IntegrationStatus;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class SyncGoogleSearchConsoleJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public function __construct(private readonly int $syncHistoryId) {}

    public function handle(GoogleSearchConsoleDataService $service): void
    {
        $history = AnalyticsSyncHistory::with('integration')->findOrFail($this->syncHistoryId);
        $integration = $history->integration;

        if ($integration === null) {
            $this->failHistory($history, 'Integration no longer exists.');

            return;
        }

        $history->update([
            'status' => AnalyticsSyncStatus::Running,
            'started_at' => now(),
        ]);

        Log::info('Search Console sync started', [
            'sync_history_id' => $this->syncHistoryId,
            'organization_id' => $history->organization_id,
            'integration_id' => $history->integration_id,
        ]);

        try {
            $dailyMetrics = $service->fetchDailyMetrics($integration, $history->date_from->toDateString(), $history->date_to->toDateString());
            $queries = $service->fetchQueries($integration, $history->date_from->toDateString(), $history->date_to->toDateString());
            $pages = $service->fetchPages($integration, $history->date_from->toDateString(), $history->date_to->toDateString());

            DB::transaction(function () use ($history, $integration, $dailyMetrics, $queries, $pages): void {
                foreach ($dailyMetrics as $metric) {
                    AnalyticsDailyMetric::updateOrCreate([
                        'organization_id' => $history->organization_id,
                        'website_id' => $history->website_id,
                        'integration_id' => $history->integration_id,
                        'metric_date' => $metric['metric_date'],
                    ], [
                        'clicks' => $metric['clicks'],
                        'impressions' => $metric['impressions'],
                        'ctr' => $metric['ctr'],
                        'average_position' => $metric['average_position'],
                    ]);
                }

                foreach ($queries as $query) {
                    AnalyticsSearchQuery::updateOrCreate([
                        'organization_id' => $history->organization_id,
                        'website_id' => $history->website_id,
                        'integration_id' => $history->integration_id,
                        'metric_date' => $query['metric_date'],
                        'query_hash' => hash('sha256', $query['query']),
                    ], [
                        'query' => $query['query'],
                        'clicks' => $query['clicks'],
                        'impressions' => $query['impressions'],
                        'ctr' => $query['ctr'],
                        'average_position' => $query['average_position'],
                    ]);
                }

                foreach ($pages as $page) {
                    AnalyticsSearchPage::updateOrCreate([
                        'organization_id' => $history->organization_id,
                        'website_id' => $history->website_id,
                        'integration_id' => $history->integration_id,
                        'metric_date' => $page['metric_date'],
                        'page_url_hash' => hash('sha256', $page['page_url']),
                    ], [
                        'page_url' => $page['page_url'],
                        'clicks' => $page['clicks'],
                        'impressions' => $page['impressions'],
                        'ctr' => $page['ctr'],
                        'average_position' => $page['average_position'],
                    ]);
                }

                $recordCount = count($dailyMetrics) + count($queries) + count($pages);

                $history->update([
                    'status' => AnalyticsSyncStatus::Completed,
                    'records_synced' => $recordCount,
                    'finished_at' => now(),
                    'failed_at' => null,
                    'error_message' => null,
                ]);

                $integration->update([
                    'status' => IntegrationStatus::Connected,
                    'last_synced_at' => now(),
                    'last_error_at' => null,
                    'last_error_message' => null,
                ]);

                Log::info('Search Console sync completed', [
                    'sync_history_id' => $this->syncHistoryId,
                    'organization_id' => $history->organization_id,
                    'records_synced' => $recordCount,
                ]);
            });
        } catch (Throwable $exception) {
            $this->failHistory($history, $this->safeMessage($exception));

            Log::error('Search Console sync failed', [
                'sync_history_id' => $this->syncHistoryId,
                'organization_id' => $history->organization_id,
                'error' => $this->safeMessage($exception),
            ]);

            throw $exception;
        }
    }

    private function failHistory(AnalyticsSyncHistory $history, string $message): void
    {
        $history->update([
            'status' => AnalyticsSyncStatus::Failed,
            'failed_at' => now(),
            'finished_at' => now(),
            'error_message' => $message,
        ]);

        $history->integration?->update([
            'status' => IntegrationStatus::Error,
            'last_error_at' => now(),
            'last_error_message' => $message,
        ]);
    }

    private function safeMessage(Throwable $exception): string
    {
        return mb_strimwidth($exception->getMessage(), 0, 1000, '...');
    }
}
