<?php

declare(strict_types=1);

namespace App\Domains\Automation\Jobs;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

class SendN8nWebhookJob implements ShouldQueue
{
    use Queueable;

    public int $tries   = 3;
    public int $timeout = 60;

    public function __construct(public readonly int $deliveryId) {}

    public function handle(): void
    {
        $delivery = N8nWebhookDelivery::with('connection')->findOrFail($this->deliveryId);

        if ($delivery->status->isTerminal()) {
            return;
        }

        $connection = $delivery->connection;
        $headers    = [];

        if ($connection->webhook_secret !== null) {
            $headers['X-Ultron-Secret'] = $connection->webhook_secret;
        }

        $response = Http::withHeaders($headers)
            ->timeout(30)
            ->post($delivery->webhook_url, $delivery->payload);

        $responseBody = mb_substr($response->body(), 0, 1000);

        $delivery->update([
            'response_code' => $response->status(),
            'response_body' => $responseBody,
            'attempts'      => $delivery->attempts + 1,
        ]);

        if ($response->successful()) {
            $delivery->update([
                'status'  => N8nDeliveryStatus::Sent,
                'sent_at' => now(),
            ]);

            return;
        }

        // Non-2xx: throw so Laravel retries; failed() handles terminal state.
        throw new \RuntimeException("Webhook returned HTTP {$response->status()}");
    }

    public function failed(\Throwable $e): void
    {
        N8nWebhookDelivery::where('id', $this->deliveryId)->update([
            'status'        => N8nDeliveryStatus::Failed->value,
            'error_message' => mb_substr($e->getMessage(), 0, 500),
        ]);
    }
}
