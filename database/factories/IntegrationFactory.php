<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Integration>
 */
class IntegrationFactory extends Factory
{
    protected $model = Integration::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'website_id' => null,
            'created_by' => User::factory(),
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => IntegrationStatus::Connected->value,
            'external_account_id' => (string) fake()->randomNumber(9),
            'external_account_name' => fake()->safeEmail(),
            'external_property_id' => null,
            'external_property_name' => null,
            'scopes' => ['https://www.googleapis.com/auth/analytics.readonly'],
            'token_expires_at' => now()->addHour(),
        ];
    }

    public function disconnected(): static
    {
        return $this->state(['status' => IntegrationStatus::Disconnected->value]);
    }

    public function expired(): static
    {
        return $this->state([
            'status' => IntegrationStatus::TokenExpired->value,
            'token_expires_at' => now()->subHour(),
        ]);
    }
}
