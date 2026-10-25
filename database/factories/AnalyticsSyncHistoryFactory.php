<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AnalyticsSyncHistory>
 */
class AnalyticsSyncHistoryFactory extends Factory
{
    protected $model = AnalyticsSyncHistory::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'website_id' => null,
            'integration_id' => Integration::factory(),
            'requested_by' => User::factory(),
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => AnalyticsSyncStatus::Queued->value,
            'date_from' => now()->subDays(30)->toDateString(),
            'date_to' => now()->subDay()->toDateString(),
        ];
    }
}
