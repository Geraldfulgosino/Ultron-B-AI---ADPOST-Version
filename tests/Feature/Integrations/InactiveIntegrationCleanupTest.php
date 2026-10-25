<?php

declare(strict_types=1);

namespace Tests\Feature\Integrations;

use App\Domains\Clients\Models\Client;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InactiveIntegrationCleanupTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_delete_inactive_integration_record(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $inactive = Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $owner->id,
        ]);

        $this->actingAs($owner)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $org->slug,
                'integration'  => $inactive->id,
            ]))
            ->assertRedirect();

        $this->assertDatabaseMissing('integrations', ['id' => $inactive->id]);
    }

    public function test_admin_can_delete_inactive_integration_record(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $inactive = Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $admin->id,
        ]);

        $this->actingAs($admin)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $org->slug,
                'integration'  => $inactive->id,
            ]))
            ->assertRedirect();

        $this->assertDatabaseMissing('integrations', ['id' => $inactive->id]);
    }

    public function test_owner_cannot_delete_active_connected_integration_via_inactive_route(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $connected = Integration::factory()->create([
            'organization_id' => $org->id,
            'created_by'      => $owner->id,
            'status'          => IntegrationStatus::Connected->value,
        ]);

        $this->actingAs($owner)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $org->slug,
                'integration'  => $connected->id,
            ]))
            ->assertRedirect()
            ->assertSessionHas('error');

        $this->assertDatabaseHas('integrations', ['id' => $connected->id]);
    }

    public function test_member_cannot_delete_inactive_integration_record(): void
    {
        [$org, $member] = $this->createOrgWithUser('member');
        $inactive = Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $member->id,
        ]);

        $this->actingAs($member)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $org->slug,
                'integration'  => $inactive->id,
            ]))
            ->assertForbidden();

        $this->assertDatabaseHas('integrations', ['id' => $inactive->id]);
    }

    public function test_viewer_cannot_delete_inactive_integration_record(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        [, $viewer] = $this->createOrgWithUser('viewer');
        $viewer->memberships()->update(['organization_id' => $org->id]);

        $inactive = Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $admin->id,
        ]);

        $this->actingAs($viewer)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $org->slug,
                'integration'  => $inactive->id,
            ]))
            ->assertForbidden();

        $this->assertDatabaseHas('integrations', ['id' => $inactive->id]);
    }

    public function test_client_cannot_delete_inactive_integration_record(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $inactive = Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $admin->id,
        ]);

        $this->actingAs($clientUser)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $org->slug,
                'integration'  => $inactive->id,
            ]))
            ->assertForbidden();

        $this->assertDatabaseHas('integrations', ['id' => $inactive->id]);
    }

    public function test_cross_organization_deletion_is_blocked(): void
    {
        [$orgA, $ownerA] = $this->createOrgWithOwner();
        [$orgB, $ownerB] = $this->createOrgWithOwner();

        $inactiveInOrgB = Integration::factory()->disconnected()->create([
            'organization_id' => $orgB->id,
            'created_by'      => $ownerB->id,
        ]);

        $this->actingAs($ownerA)
            ->delete(route('integrations.inactive.destroy', [
                'organization' => $orgA->slug,
                'integration'  => $inactiveInOrgB->id,
            ]))
            ->assertForbidden();

        $this->assertDatabaseHas('integrations', ['id' => $inactiveInOrgB->id]);
    }

    public function test_inactive_integration_props_expose_can_delete_inactive_for_admin(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $admin->id,
            'provider'        => IntegrationProvider::GoogleSearchConsole->value,
        ]);

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('inactiveIntegrations.0.can_delete_inactive', true)
            );
    }

    public function test_inactive_integration_props_hide_can_delete_inactive_for_viewer(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        [, $viewer] = $this->createOrgWithUser('viewer');
        $viewer->memberships()->update(['organization_id' => $org->id]);

        Integration::factory()->disconnected()->create([
            'organization_id' => $org->id,
            'created_by'      => $admin->id,
            'provider'        => IntegrationProvider::GoogleSearchConsole->value,
        ]);

        $this->actingAs($viewer)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('inactiveIntegrations.0.can_delete_inactive', false)
            );
    }
}
