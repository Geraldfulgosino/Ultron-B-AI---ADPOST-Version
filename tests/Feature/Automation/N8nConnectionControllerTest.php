<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use App\Domains\Clients\Models\Client;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class N8nConnectionControllerTest extends TestCase
{
    use RefreshDatabase;

    // ── store ──────────────────────────────────────────────────────────────────

    public function test_owner_can_save_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url'    => 'https://n8n.example.com/webhook/test',
                'webhook_secret' => 'my-secret',
                'is_enabled'     => true,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('n8n_connections', [
            'organization_id' => $org->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/test',
        ]);
    }

    public function test_admin_can_save_n8n_connection(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url'    => 'https://n8n.example.com/webhook/test',
                'webhook_secret' => 'my-secret',
                'is_enabled'     => true,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('n8n_connections', ['organization_id' => $org->id]);
    }

    public function test_member_cannot_save_n8n_connection(): void
    {
        [$org, $member] = $this->createOrgWithUser('member');

        $this->actingAs($member)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url' => 'https://n8n.example.com/webhook/test',
                'is_enabled'  => true,
            ])
            ->assertForbidden();

        $this->assertDatabaseCount('n8n_connections', 0);
    }

    public function test_viewer_cannot_save_n8n_connection(): void
    {
        [$org, $viewer] = $this->createOrgWithUser('viewer');

        $this->actingAs($viewer)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url' => 'https://n8n.example.com/webhook/test',
                'is_enabled'  => true,
            ])
            ->assertForbidden();
    }

    public function test_client_cannot_save_n8n_connection(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url' => 'https://n8n.example.com/webhook/test',
                'is_enabled'  => true,
            ])
            ->assertForbidden();
    }

    public function test_invalid_url_is_rejected(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url' => 'not-a-valid-url',
                'is_enabled'  => true,
            ])
            ->assertSessionHasErrors('webhook_url');

        $this->assertDatabaseCount('n8n_connections', 0);
    }

    public function test_non_https_scheme_is_rejected(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url' => 'ftp://example.com/webhook',
                'is_enabled'  => true,
            ])
            ->assertSessionHasErrors('webhook_url');
    }

    public function test_blank_webhook_url_is_rejected(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->post(route('automations.n8n.store', ['organization' => $org->slug]), [
                'webhook_url' => '',
                'is_enabled'  => true,
            ])
            ->assertSessionHasErrors('webhook_url');
    }

    // ── testConnection ─────────────────────────────────────────────────────────

    public function test_owner_can_test_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $this->actingAs($owner)
            ->post(route('automations.n8n.test', ['organization' => $org->slug]))
            ->assertOk()
            ->assertJson(['success' => true]);
    }

    public function test_member_cannot_test_n8n_connection(): void
    {
        [$org, $member] = $this->createOrgWithUser('member');

        $this->actingAs($member)
            ->post(route('automations.n8n.test', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    public function test_test_route_when_no_connection_returns_safe_error(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->post(route('automations.n8n.test', ['organization' => $org->slug]))
            ->assertStatus(422)
            ->assertJson(['success' => false]);
    }

    public function test_test_route_never_exposes_webhook_secret(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_secret'  => 'super-secret-token',
        ]);

        Http::fake(['*' => Http::response('{"ok":true}', 200)]);

        $response = $this->actingAs($owner)
            ->post(route('automations.n8n.test', ['organization' => $org->slug]));

        $this->assertStringNotContainsString('super-secret-token', $response->getContent());
    }

    public function test_failed_test_connection_returns_safe_error(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);

        Http::fake(['*' => Http::response('{"error":"bad request"}', 400)]);

        $this->actingAs($owner)
            ->post(route('automations.n8n.test', ['organization' => $org->slug]))
            ->assertOk()
            ->assertJson(['success' => false]);
    }

    // ── destroy ────────────────────────────────────────────────────────────────

    public function test_owner_can_disconnect_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'is_enabled'      => true,
        ]);

        $this->actingAs($owner)
            ->delete(route('automations.n8n.destroy', ['organization' => $org->slug]))
            ->assertRedirect();

        $this->assertDatabaseHas('n8n_connections', [
            'organization_id' => $org->id,
            'is_enabled'      => false,
        ]);
    }

    public function test_disconnect_preserves_delivery_history(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);
        N8nWebhookDelivery::factory()->sent()->create([
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
        ]);

        $this->actingAs($owner)
            ->delete(route('automations.n8n.destroy', ['organization' => $org->slug]))
            ->assertRedirect();

        $this->assertDatabaseCount('n8n_webhook_deliveries', 1);
    }

    public function test_member_cannot_disconnect_n8n_connection(): void
    {
        [$org, $member] = $this->createOrgWithUser('member');

        $this->actingAs($member)
            ->delete(route('automations.n8n.destroy', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    // ── Integrations page n8n props ────────────────────────────────────────────

    public function test_integrations_page_includes_n8n_status_for_owner(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/test',
            'is_enabled'      => true,
            'last_status'     => 'success',
        ]);

        $this->actingAs($owner)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('n8nConnection')
                ->where('n8nConnection.webhook_url', 'https://n8n.example.com/webhook/test')
                ->where('n8nConnection.is_enabled', true)
                ->where('n8nConnection.last_status', 'success')
            );
    }

    public function test_integrations_page_never_includes_webhook_secret_for_any_role(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_secret'  => 'should-never-appear',
        ]);

        $response = $this->actingAs($owner)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk();

        $this->assertStringNotContainsString('should-never-appear', $response->getContent());
        $response->assertInertia(fn ($page) => $page->missing('n8nConnection.webhook_secret'));
    }

    public function test_integrations_page_n8n_prop_is_null_for_client_role(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $admin->id,
        ]);
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('n8nConnection', null));
    }

    public function test_integrations_page_n8n_prop_is_null_when_no_connection_configured(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('n8nConnection', null));
    }

    // ── clearDeliveries ────────────────────────────────────────────────────────

    public function test_owner_can_clear_n8n_delivery_history(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
        ]);
        N8nWebhookDelivery::factory()->sent()->count(3)->create([
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
        ]);

        $this->actingAs($owner)
            ->delete(route('automations.n8n.deliveries.clear', ['organization' => $org->slug]))
            ->assertRedirect()
            ->assertSessionHas('success');

        $this->assertDatabaseCount('n8n_webhook_deliveries', 0);
    }

    public function test_clearing_n8n_delivery_history_does_not_delete_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/test',
        ]);
        N8nWebhookDelivery::factory()->sent()->create([
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
        ]);

        $this->actingAs($owner)
            ->delete(route('automations.n8n.deliveries.clear', ['organization' => $org->slug]));

        $this->assertDatabaseHas('n8n_connections', [
            'id'          => $connection->id,
            'webhook_url' => 'https://n8n.example.com/webhook/test',
        ]);
        $this->assertDatabaseCount('n8n_webhook_deliveries', 0);
    }

    public function test_clearing_deliveries_only_affects_current_organization(): void
    {
        [$orgA, $ownerA] = $this->createOrgWithOwner();
        [$orgB, $ownerB] = $this->createOrgWithOwner();

        $connA = N8nConnection::factory()->create(['organization_id' => $orgA->id, 'connected_by' => $ownerA->id]);
        $connB = N8nConnection::factory()->create(['organization_id' => $orgB->id, 'connected_by' => $ownerB->id]);

        N8nWebhookDelivery::factory()->sent()->create(['organization_id' => $orgA->id, 'n8n_connection_id' => $connA->id]);
        N8nWebhookDelivery::factory()->sent()->create(['organization_id' => $orgB->id, 'n8n_connection_id' => $connB->id]);

        $this->actingAs($ownerA)
            ->delete(route('automations.n8n.deliveries.clear', ['organization' => $orgA->slug]));

        $this->assertDatabaseCount('n8n_webhook_deliveries', 1);
        $this->assertDatabaseHas('n8n_webhook_deliveries', ['organization_id' => $orgB->id]);
    }

    public function test_client_cannot_clear_n8n_delivery_history(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $admin->id,
        ]);
        N8nWebhookDelivery::factory()->sent()->create([
            'organization_id'   => $org->id,
            'n8n_connection_id' => $connection->id,
        ]);

        $this->actingAs($clientUser)
            ->delete(route('automations.n8n.deliveries.clear', ['organization' => $org->slug]))
            ->assertForbidden();

        $this->assertDatabaseCount('n8n_webhook_deliveries', 1);
    }

    // ── tenant isolation ───────────────────────────────────────────────────────

    public function test_owner_of_org_a_cannot_post_to_org_b_n8n_endpoint(): void
    {
        [$orgA, $ownerA] = $this->createOrgWithOwner();
        [$orgB] = $this->createOrgWithOwner();

        $this->actingAs($ownerA)
            ->post(route('automations.n8n.store', ['organization' => $orgB->slug]), [
                'webhook_url' => 'https://n8n.example.com/webhook/test',
                'is_enabled'  => true,
            ])
            ->assertForbidden();

        $this->assertDatabaseCount('n8n_connections', 0);
    }

    public function test_invalid_org_slug_returns_404(): void
    {
        [, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->post(route('automations.n8n.store', ['organization' => 'does-not-exist']), [
                'webhook_url' => 'https://n8n.example.com/webhook/test',
                'is_enabled'  => true,
            ])
            ->assertNotFound();
    }
}
