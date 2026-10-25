<?php

declare(strict_types=1);

namespace Tests\Feature\Organizations;

use App\Domains\Clients\Models\Client;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MembersAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_access_members_page(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('organizations/Members'));
    }

    public function test_admin_can_access_members_page(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('organizations/Members'));
    }

    public function test_client_user_cannot_access_members_page(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    public function test_client_user_cannot_see_organization_members_data(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $response = $this->actingAs($clientUser)
            ->get(route('organization.members', ['organization' => $org->slug]));

        $response->assertForbidden();
        $response->assertDontSee($admin->email);
        $response->assertDontSee($admin->name);
    }

    public function test_members_nav_is_hidden_for_client_users(): void
    {
        // The AppLayout filters nav items with clientVisible: false when role === 'client'.
        // Verify the backend shares role='client' in currentOrganization props so the filter applies.
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('dashboard', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('currentOrganization.role', 'client')
            );
    }
}
