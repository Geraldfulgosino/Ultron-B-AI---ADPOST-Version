<?php

declare(strict_types=1);

namespace Tests\Feature\Clients;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientCrudTest extends TestCase
{
    use RefreshDatabase;

    public function test_member_can_create_client_for_active_organization(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->post(route('clients.store', ['organization' => $organization->slug]), [
                'name' => 'Acme Client',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
                'business_goals' => 'Increase qualified leads.',
                'organization_id' => 999999,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('clients', [
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'name' => 'Acme Client',
        ]);
        $this->assertDatabaseMissing('clients', ['organization_id' => 999999]);
    }

    public function test_admin_can_update_client(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->patch(route('clients.update', ['organization' => $organization->slug, 'client' => $client->id]), [
                'name' => 'Updated Client',
                'status' => 'active',
                'timezone' => 'Asia/Manila',
                'currency' => 'PHP',
                'business_goals' => null,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('clients', [
            'id' => $client->id,
            'name' => 'Updated Client',
            'currency' => 'PHP',
        ]);
    }

    public function test_viewer_cannot_create_client(): void
    {
        [$organization, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->post(route('clients.store', ['organization' => $organization->slug]), [
                'name' => 'Denied Client',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
            ])
            ->assertForbidden();
    }

    public function test_admin_can_delete_client(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->delete(route('clients.destroy', ['organization' => $organization->slug, 'client' => $client->id]))
            ->assertRedirect();

        $this->assertSoftDeleted('clients', ['id' => $client->id]);
    }

    public function test_viewer_cannot_delete_client(): void
    {
        [$organization, $owner] = $this->createOrgWithOwner();
        $viewer = User::factory()->create();
        OrganizationMember::factory()->create([
            'organization_id' => $organization->id,
            'user_id' => $viewer->id,
            'role' => 'viewer',
        ]);
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $owner->id,
        ]);

        $this->actingAs($viewer)
            ->delete(route('clients.destroy', ['organization' => $organization->slug, 'client' => $client->id]))
            ->assertForbidden();

        $this->assertNotSoftDeleted('clients', ['id' => $client->id]);
    }

    public function test_cross_organization_client_update_is_forbidden(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        [$otherOrganization, $otherUser] = $this->createOrgWithOwner();
        $client = Client::factory()->create([
            'organization_id' => $otherOrganization->id,
            'created_by' => $otherUser->id,
        ]);

        $this->actingAs($user)
            ->patch(route('clients.update', ['organization' => $organization->slug, 'client' => $client->id]), [
                'name' => 'Cross Org Write',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
                'business_goals' => null,
            ])
            ->assertForbidden();

        $this->assertDatabaseMissing('clients', [
            'id' => $client->id,
            'name' => 'Cross Org Write',
        ]);
    }
}
