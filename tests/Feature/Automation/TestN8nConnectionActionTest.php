<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Actions\TestN8nConnectionAction;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TestN8nConnectionActionTest extends TestCase
{
    use RefreshDatabase;

    private TestN8nConnectionAction $action;

    protected function setUp(): void
    {
        parent::setUp();
        $this->action = new TestN8nConnectionAction();
        Http::preventStrayRequests();
    }

    public function test_sends_post_to_webhook_url(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $org->load('members');

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/ultron-test',
            'webhook_secret'  => null,
        ]);

        Http::fake(['https://n8n.example.com/webhook/ultron-test' => Http::response('{"ok":true}', 200)]);

        $this->action->execute($connection, $owner);

        Http::assertSent(fn ($req) => $req->url() === 'https://n8n.example.com/webhook/ultron-test'
            && $req->method() === 'POST');
    }

    public function test_includes_x_ultron_secret_header_when_secret_set(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $org->load('members');

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/ultron-test',
            'webhook_secret'  => 'my-webhook-secret',
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $this->action->execute($connection, $owner);

        Http::assertSent(fn ($req) => $req->hasHeader('X-Ultron-Secret', 'my-webhook-secret'));
    }

    public function test_does_not_send_secret_header_when_no_secret(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_secret'  => null,
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $this->action->execute($connection, $owner);

        Http::assertSent(fn ($req) => ! $req->hasHeader('X-Ultron-Secret'));
    }

    public function test_successful_response_updates_last_status_to_success(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $result = $this->action->execute($connection, $owner);

        $connection->refresh();
        $this->assertSame('success', $connection->last_status);
        $this->assertNotNull($connection->last_tested_at);
        $this->assertNull($connection->last_error);
        $this->assertTrue($result['success']);
    }

    public function test_failed_response_updates_last_status_to_failed(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(['*' => Http::response('{"error":"bad request"}', 400)]);

        $result = $this->action->execute($connection, $owner);

        $connection->refresh();
        $this->assertSame('failed', $connection->last_status);
        $this->assertNotNull($connection->last_error);
        $this->assertFalse($result['success']);
    }

    public function test_connection_exception_updates_last_status_to_failed(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(fn () => throw new \Illuminate\Http\Client\ConnectionException('Connection refused'));

        $result = $this->action->execute($connection, $owner);

        $connection->refresh();
        $this->assertSame('failed', $connection->last_status);
        $this->assertFalse($result['success']);
    }

    public function test_test_action_creates_delivery_log_row(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $this->action->execute($connection, $owner);

        $this->assertDatabaseHas('n8n_webhook_deliveries', [
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
            'event_name'        => 'ultron.test',
        ]);
    }

    public function test_payload_contains_organization_and_triggered_by(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $this->action->execute($connection, $owner);

        Http::assertSent(function ($req) use ($org, $owner) {
            $body = $req->data();
            return isset($body['organization']['id'])
                && $body['organization']['id'] === $org->id
                && isset($body['triggered_by']['id'])
                && $body['triggered_by']['id'] === $owner->id
                && $body['event'] === 'ultron.test';
        });
    }
}
