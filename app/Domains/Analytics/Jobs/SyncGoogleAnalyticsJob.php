<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Jobs;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Analytics\Services\GoogleAnalyticsDataService;
use App\Domains\Integrations\Enums\IntegrationStatus;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class SyncGoogleAnalyticsJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public function __construct(private readonly int $syncHistoryId) {}

    public function handle(GoogleAnalyticsDataService $service): void
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

        Log::info('GA4 sync started', [
            'sync_history_id' => $this->syncHistoryId,
            'organization_id' => $history->organization_id,
            'integration_id' => $history->integration_id,
        ]);

        try {
            $dailyMetrics = $service->fetchDailyMetrics($integration, $history->date_from->toDateString(), $history->date_to->toDateString());
            $landingPages = $service->fetchLandingPages($integration, $history->date_from->toDateString(), $history->date_to->toDateString());

            DB::transaction(function () use ($history, $integration, $dailyMetrics, $landingPages): void {
                foreach ($dailyMetrics as $metric) {
                    AnalyticsDailyMetric::updateOrCreate([
                        'organization_id' => $history->organization_id,
                        'website_id' => $history->website_id,
                        'integration_id' => $history->integration_id,
                        'metric_date' => $metric['metric_date'],
                    ], [
                        'sessions' => $metric['sessions'],
                        'active_users' => $metric['active_users'],
                        'new_users' => $metric['new_users'],
                        'screen_page_views' => $metric['screen_page_views'],
                        'conversions' => $metric['conversions'],
                        'total_revenue' => $metric['total_revenue'],
                    ]);
                }

                foreach ($landingPages as $page) {
                    AnalyticsLandingPage::updateOrCreate([
                        'organization_id' => $history->organization_id,
                        'website_id' => $history->website_id,
                        'integration_id' => $history->integration_id,
                        'metric_date' => $page['metric_date'],
                        'page_path_hash' => hash('sha256', $page['page_path']),
                    ], [
                        'page_path' => $page['page_path'],
                        'sessions' => $page['sessions'],
                        'active_users' => $page['active_users'],
                        'screen_page_views' => $page['screen_page_views'],
                        'conversions' => $page['conversions'],
                        'total_revenue' => $page['total_revenue'],
                    ]);
                }

                $recordCount = count($dailyMetrics) + count($landingPages);

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

                Log::info('GA4 sync completed', [
                    'sync_history_id' => $this->syncHistoryId,
                    'organization_id' => $history->organization_id,
                    'records_synced' => $recordCount,
                ]);
            });
        } catch (Throwable $exception) {
            $this->failHistory($history, $this->safeMessage($exception));

            Log::error('GA4 sync failed', [
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
