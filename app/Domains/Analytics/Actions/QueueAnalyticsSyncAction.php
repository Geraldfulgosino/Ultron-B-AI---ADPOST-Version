<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Actions;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Jobs\SyncGoogleAnalyticsJob;
use App\Domains\Analytics\Jobs\SyncGoogleSearchConsoleJob;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Models\Integration;
use Illuminate\Support\Carbon;
use RuntimeException;

class QueueAnalyticsSyncAction
{
    public function execute(Integration $integration, User $user): AnalyticsSyncHistory
    {
        if (! $integration->isHealthy()) {
            throw new RuntimeException('Only connected integrations with a valid token can be synced.');
        }

        $dateTo = Carbon::yesterday()->toDateString();
        $dateFrom = Carbon::yesterday()->subDays(29)->toDateString();

        $history = AnalyticsSyncHistory::create([
            'organization_id' => $integration->organization_id,
            'website_id' => $integration->website_id,
            'integration_id' => $integration->id,
            'requested_by' => $user->id,
            'provider' => $integration->provider,
            'status' => AnalyticsSyncStatus::Queued,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
        ]);

        match ($integration->provider) {
            IntegrationProvider::GoogleAnalytics => SyncGoogleAnalyticsJob::dispatch($history->id),
            IntegrationProvider::GoogleSearchConsole => SyncGoogleSearchConsoleJob::dispatch($history->id),
        };

        return $history;
    }
}
