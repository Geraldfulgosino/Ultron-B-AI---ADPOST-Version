<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Jobs\SendN8nWebhookJob;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SendN8nWebhookJobTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
    }

    private function makeDelivery(array $connectionOverrides = [], array $deliveryOverrides = []): N8nWebhookDelivery
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create(array_merge([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/test',
            'webhook_secret'  => 'secret-token',
        ], $connectionOverrides));

        return N8nWebhookDelivery::factory()->create(array_merge([
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
            'webhook_url'       => $connection->webhook_url,
            'status'            => N8nDeliveryStatus::Pending,
            'payload'           => ['event' => 'ultron.test'],
        ], $deliveryOverrides));
    }

    public function test_job_marks_delivery_sent_on_2xx_response(): void
    {
        $delivery = $this->makeDelivery();

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        $delivery->refresh();
        $this->assertSame(N8nDeliveryStatus::Sent, $delivery->status);
        $this->assertNotNull($delivery->sent_at);
    }

    public function test_job_marks_delivery_failed_on_non_2xx_response(): void
    {
        $delivery = $this->makeDelivery();

        Http::fake(['*' => Http::response('{"error":"bad gateway"}', 502)]);

        $job = new SendN8nWebhookJob($delivery->id);
        try {
            $job->handle();
        } catch (\Throwable $e) {
            $job->failed($e);
        }

        $delivery->refresh();
        $this->assertSame(N8nDeliveryStatus::Failed, $delivery->status);
    }

    public function test_job_marks_delivery_failed_on_connection_exception(): void
    {
        $delivery = $this->makeDelivery();

        Http::fake(fn () => throw new ConnectionException('Connection timed out'));

        $job = new SendN8nWebhookJob($delivery->id);
        try {
            $job->handle();
        } catch (\Throwable $e) {
            $job->failed($e);
        }

        $delivery->refresh();
        $this->assertSame(N8nDeliveryStatus::Failed, $delivery->status);
        $this->assertNotNull($delivery->error_message);
    }

    public function test_job_stores_response_code_on_success(): void
    {
        $delivery = $this->makeDelivery();

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        $delivery->refresh();
        $this->assertSame(200, $delivery->response_code);
    }

    public function test_job_stores_response_code_on_failure(): void
    {
        $delivery = $this->makeDelivery();

        Http::fake(['*' => Http::response('upstream error', 503)]);

        $job = new SendN8nWebhookJob($delivery->id);
        try {
            $job->handle();
        } catch (\Throwable $e) {
            $job->failed($e);
        }

        $delivery->refresh();
        $this->assertSame(503, $delivery->response_code);
    }

    public function test_job_truncates_response_body_to_1000_chars(): void
    {
        $delivery = $this->makeDelivery();
        $longBody = str_repeat('x', 3000);

        Http::fake(['*' => Http::response($longBody, 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        $delivery->refresh();
        $this->assertSame(1000, mb_strlen($delivery->response_body));
    }

    public function test_job_includes_x_ultron_secret_header(): void
    {
        $delivery = $this->makeDelivery(['webhook_secret' => 'my-test-secret']);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        Http::assertSent(fn ($req) => $req->hasHeader('X-Ultron-Secret', 'my-test-secret'));
    }

    public function test_job_omits_secret_header_when_no_secret(): void
    {
        $delivery = $this->makeDelivery(['webhook_secret' => null]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        Http::assertSent(fn ($req) => ! $req->hasHeader('X-Ultron-Secret'));
    }

    public function test_job_skips_already_terminal_delivery(): void
    {
        $delivery = $this->makeDelivery(deliveryOverrides: ['status' => N8nDeliveryStatus::Sent]);

        // No Http::fake needed — job should return before any HTTP call
        Http::fake(['*' => Http::response('should not be called', 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        Http::assertNothingSent();
    }

    public function test_job_increments_attempts_on_success(): void
    {
        $delivery = $this->makeDelivery(deliveryOverrides: ['attempts' => 0]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        (new SendN8nWebhookJob($delivery->id))->handle();

        $delivery->refresh();
        $this->assertSame(1, $delivery->attempts);
    }
}
