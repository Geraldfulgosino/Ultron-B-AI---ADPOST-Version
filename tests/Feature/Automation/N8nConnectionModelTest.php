<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class N8nConnectionModelTest extends TestCase
{
    use RefreshDatabase;

    // ── N8nConnection model ────────────────────────────────────────────────

    public function test_webhook_secret_is_stored_encrypted(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
            'webhook_secret' => 'super-secret-value',
        ]);

        // Raw DB value must NOT be the plaintext secret
        $rawRow = \DB::table('n8n_connections')->where('id', $connection->id)->first();
        $this->assertNotSame('super-secret-value', $rawRow->webhook_secret);

        // But the model attribute must decrypt it transparently
        $fresh = N8nConnection::find($connection->id);
        $this->assertSame('super-secret-value', $fresh->webhook_secret);
    }

    public function test_webhook_secret_is_hidden_from_array_output(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
            'webhook_secret' => 'super-secret-value',
        ]);

        $this->assertArrayNotHasKey('webhook_secret', $connection->toArray());
    }

    public function test_webhook_secret_is_hidden_from_json_output(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
            'webhook_secret' => 'super-secret-value',
        ]);

        $json = json_decode($connection->toJson(), true);
        $this->assertArrayNotHasKey('webhook_secret', $json);
    }

    public function test_is_enabled_is_cast_to_boolean(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
            'is_enabled' => true,
        ]);

        $this->assertIsBool($connection->is_enabled);
        $this->assertTrue($connection->is_enabled);
    }

    public function test_last_tested_at_is_cast_to_datetime(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
            'last_tested_at' => now(),
        ]);

        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $connection->last_tested_at);
    }

    // ── N8nWebhookDelivery model ───────────────────────────────────────────

    public function test_delivery_status_is_cast_to_enum(): void
    {
        [$org, $user] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
        ]);

        $delivery = N8nWebhookDelivery::factory()->create([
            'organization_id' => $org->id,
            'n8n_connection_id' => $connection->id,
            'status' => N8nDeliveryStatus::Pending,
        ]);

        $fresh = N8nWebhookDelivery::find($delivery->id);
        $this->assertInstanceOf(N8nDeliveryStatus::class, $fresh->status);
        $this->assertSame(N8nDeliveryStatus::Pending, $fresh->status);
    }

    public function test_delivery_payload_is_cast_to_array(): void
    {
        [$org, $user] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
        ]);

        $payload = ['event' => 'ultron.test', 'organization' => ['id' => $org->id]];
        $delivery = N8nWebhookDelivery::factory()->create([
            'organization_id' => $org->id,
            'n8n_connection_id' => $connection->id,
            'payload' => $payload,
        ]);

        $fresh = N8nWebhookDelivery::find($delivery->id);
        $this->assertIsArray($fresh->payload);
        $this->assertSame('ultron.test', $fresh->payload['event']);
    }

    public function test_connection_belongs_to_organization(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
        ]);

        $this->assertTrue($connection->organization->is($org));
    }

    public function test_delivery_belongs_to_connection(): void
    {
        [$org, $user] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $user->id,
        ]);
        $delivery = N8nWebhookDelivery::factory()->create([
            'organization_id' => $org->id,
            'n8n_connection_id' => $connection->id,
        ]);

        $this->assertTrue($delivery->connection->is($connection));
    }
}
