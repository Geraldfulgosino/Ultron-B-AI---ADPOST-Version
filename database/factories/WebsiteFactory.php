<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Website>
 */
class WebsiteFactory extends Factory
{
    protected $model = Website::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'client_id' => Client::factory(),
            'created_by' => User::factory(),
            'name' => fake()->company().' Website',
            'domain' => fake()->unique()->domainName(),
            'platform' => null,
            'status' => 'active',
            'timezone' => 'UTC',
            'currency' => 'USD',
            'primary_conversion' => null,
        ];
    }

    public function archived(): static
    {
        return $this->state(['status' => 'archived']);
    }
}
