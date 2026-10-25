<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<N8nWebhookDelivery>
 */
class N8nWebhookDeliveryFactory extends Factory
{
    protected $model = N8nWebhookDelivery::class;

    public function definition(): array
    {
        return [
            'organization_id'   => Organization::factory(),
            'n8n_connection_id' => N8nConnection::factory(),
            'event_name'        => 'ultron.test',
            'webhook_url'       => 'https://n8n.lugenixdigitalservices.com/webhook/ultron-test',
            'status'            => N8nDeliveryStatus::Pending,
            'response_code'     => null,
            'response_body'     => null,
            'error_message'     => null,
            'attempts'          => 0,
            'payload'           => ['event' => 'ultron.test'],
            'sent_at'           => null,
        ];
    }

    public function sent(): static
    {
        return $this->state([
            'status'        => N8nDeliveryStatus::Sent,
            'response_code' => 200,
            'response_body' => '{"ok":true}',
            'attempts'      => 1,
            'sent_at'       => now(),
        ]);
    }

    public function failed(): static
    {
        return $this->state([
            'status'        => N8nDeliveryStatus::Failed,
            'error_message' => 'Connection timed out',
            'attempts'      => 3,
        ]);
    }
}
