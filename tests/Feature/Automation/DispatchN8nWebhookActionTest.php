<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Actions\DispatchN8nWebhookAction;
use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Jobs\SendN8nWebhookJob;
use App\Domains\Automation\Models\N8nConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class DispatchN8nWebhookActionTest extends TestCase
{
    use RefreshDatabase;

    private DispatchN8nWebhookAction $action;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->action = new DispatchN8nWebhookAction();
    }

    public function test_creates_pending_delivery_and_dispatches_job(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'is_enabled'      => true,
        ]);

        $delivery = $this->action->execute($org, 'ultron.test', [], $owner);

        $this->assertNotNull($delivery);
        $this->assertDatabaseHas('n8n_webhook_deliveries', [
            'organization_id' => $org->id,
            'event_name'      => 'ultron.test',
            'status'          => N8nDeliveryStatus::Pending->value,
        ]);

        Queue::assertPushed(SendN8nWebhookJob::class, fn ($job) => $job->deliveryId === $delivery->id);
    }

    public function test_skips_if_no_connection_exists(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $result = $this->action->execute($org, 'ultron.test', [], $owner);

        $this->assertNull($result);
        Queue::assertNothingPushed();
        $this->assertDatabaseCount('n8n_webhook_deliveries', 0);
    }

    public function test_skips_if_connection_is_disabled(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'is_enabled'      => false,
        ]);

        $result = $this->action->execute($org, 'ultron.test', [], $owner);

        $this->assertNull($result);
        Queue::assertNothingPushed();
    }

    public function test_payload_contains_org_id_and_triggered_by(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'is_enabled'      => true,
        ]);

        $delivery = $this->action->execute($org, 'ultron.test', ['key' => 'value'], $owner);

        $this->assertNotNull($delivery);
        $payload = $delivery->payload;
        $this->assertSame($org->id, $payload['organization']['id']);
        $this->assertSame($owner->id, $payload['triggered_by']['id']);
        $this->assertSame('ultron.test', $payload['event']);
        $this->assertSame(['key' => 'value'], $payload['data']);
    }

    public function test_delivery_uses_webhook_url_snapshot_from_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/test',
            'is_enabled'      => true,
        ]);

        $delivery = $this->action->execute($org, 'ultron.test', [], $owner);

        $this->assertDatabaseHas('n8n_webhook_deliveries', [
            'id'          => $delivery->id,
            'webhook_url' => 'https://n8n.example.com/webhook/test',
        ]);
    }
}
