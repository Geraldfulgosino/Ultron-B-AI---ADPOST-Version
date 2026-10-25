<?php

declare(strict_types=1);

namespace App\Domains\Automation\Actions;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Jobs\SendN8nWebhookJob;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;

class DispatchN8nWebhookAction
{
    public function execute(
        Organization $org,
        string $event,
        array $data,
        User $triggeredBy,
    ): ?N8nWebhookDelivery {
        $connection = N8nConnection::where('organization_id', $org->id)
            ->where('is_enabled', true)
            ->first();

        if ($connection === null) {
            return null;
        }

        $payload = [
            'event'        => $event,
            'organization' => [
                'id'   => $org->id,
                'name' => $org->name,
            ],
            'triggered_by' => [
                'id'    => $triggeredBy->id,
                'email' => $triggeredBy->email,
            ],
            'timestamp' => now()->toIso8601String(),
            'data'      => $data,
        ];

        $delivery = N8nWebhookDelivery::create([
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
            'event_name'        => $event,
            'webhook_url'       => $connection->webhook_url,
            'status'            => N8nDeliveryStatus::Pending,
            'payload'           => $payload,
        ]);

        SendN8nWebhookJob::dispatch($delivery->id);

        return $delivery;
    }
}
