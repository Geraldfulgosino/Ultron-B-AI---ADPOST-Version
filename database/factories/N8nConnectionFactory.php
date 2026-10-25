<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<N8nConnection>
 */
class N8nConnectionFactory extends Factory
{
    protected $model = N8nConnection::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'connected_by'    => User::factory(),
            'webhook_url'     => 'https://n8n.lugenixdigitalservices.com/webhook/ultron-test',
            'webhook_secret'  => $this->faker->uuid(),
            'is_enabled'      => true,
            'last_tested_at'  => null,
            'last_status'     => null,
            'last_error'      => null,
        ];
    }
}
