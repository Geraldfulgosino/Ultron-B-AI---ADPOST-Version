<?php

declare(strict_types=1);

namespace App\Domains\Automation\Actions;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use App\Domains\Identity\Models\User;
use Illuminate\Support\Facades\Http;

class TestN8nConnectionAction
{
    public function execute(N8nConnection $connection, User $triggeredBy): array
    {
        $connection->loadMissing('organization');

        $payload = [
            'event'        => 'ultron.test',
            'organization' => [
                'id'   => $connection->organization_id,
                'name' => $connection->organization->name,
            ],
            'triggered_by' => [
                'id'    => $triggeredBy->id,
                'email' => $triggeredBy->email,
            ],
            'timestamp' => now()->toIso8601String(),
        ];

        $headers = [];
        if ($connection->webhook_secret !== null) {
            $headers['X-Ultron-Secret'] = $connection->webhook_secret;
        }

        $success      = false;
        $errorMessage = null;
        $responseCode = null;
        $responseBody = null;
        $now          = now();

        try {
            $response = Http::withHeaders($headers)
                ->timeout(30)
                ->post($connection->webhook_url, $payload);

            $responseCode = $response->status();
            $responseBody = mb_substr($response->body(), 0, 1000);
            $success      = $response->successful();

            if (! $success) {
                $errorMessage = "HTTP {$responseCode}";
            }
        } catch (\Throwable $e) {
            $errorMessage = mb_substr($e->getMessage(), 0, 500);
        }

        $connection->update([
            'last_tested_at' => $now,
            'last_status'    => $success ? 'success' : 'failed',
            'last_error'     => $errorMessage,
        ]);

        N8nWebhookDelivery::create([
            'organization_id'   => $connection->organization_id,
            'n8n_connection_id' => $connection->id,
            'event_name'        => 'ultron.test',
            'webhook_url'       => $connection->webhook_url,
            'status'            => $success ? N8nDeliveryStatus::Sent : N8nDeliveryStatus::Failed,
            'response_code'     => $responseCode,
            'response_body'     => $responseBody,
            'error_message'     => $errorMessage,
            'attempts'          => 1,
            'payload'           => $payload,
            'sent_at'           => $success ? $now : null,
        ]);

        return [
            'success'     => $success,
            'status_code' => $responseCode,
            'message'     => $success
                ? 'Connection successful'
                : ($errorMessage ?? 'Connection failed'),
        ];
    }
}
