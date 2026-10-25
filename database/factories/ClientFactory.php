<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Client>
 */
class ClientFactory extends Factory
{
    protected $model = Client::class;

    public function definition(): array
    {
        $name = fake()->company();

        return [
            'organization_id' => Organization::factory(),
            'created_by' => User::factory(),
            'name' => $name,
            'slug' => Str::slug($name).'-'.fake()->unique()->numerify('####'),
            'status' => 'active',
            'timezone' => 'UTC',
            'currency' => 'USD',
            'business_goals' => null,
        ];
    }

    public function archived(): static
    {
        return $this->state(['status' => 'archived']);
    }
}
