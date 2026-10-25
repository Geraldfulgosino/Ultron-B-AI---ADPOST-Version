<?php

declare(strict_types=1);

namespace Tests\Feature\Organizations;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrganizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_create_organization(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->post(route('organizations.store'), [
            'name' => 'Acme Corp',
            'timezone' => 'UTC',
            'currency' => 'USD',
        ]);

        $response->assertRedirect();
        $this->assertDatabaseHas('organizations', ['name' => 'Acme Corp']);

        $org = Organization::where('name', 'Acme Corp')->first();
        $this->assertNotNull($org);
        $this->assertDatabaseHas('organization_members', [
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'role' => 'owner',
        ]);
    }

    public function test_unauthenticated_user_cannot_create_organization(): void
    {
        $this->post(route('organizations.store'), ['name' => 'Test'])->assertRedirect(route('login'));
    }

    public function test_organization_slug_is_unique(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->post(route('organizations.store'), ['name' => 'Same Name']);
        $this->actingAs(User::factory()->create())->post(route('organizations.store'), ['name' => 'Same Name']);

        $this->assertDatabaseCount('organizations', 2);
        $slugs = Organization::pluck('slug')->toArray();
        $this->assertCount(2, array_unique($slugs));
    }

    public function test_admin_can_view_organization_settings(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('organization.settings', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('organizations/Settings'));
    }

    public function test_viewer_cannot_access_settings(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('organization.settings', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    public function test_admin_can_update_organization(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->patch(route('organization.update', ['organization' => $org->slug]), [
                'name' => 'Updated Name',
                'timezone' => 'America/New_York',
                'currency' => 'USD',
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('organizations', ['id' => $org->id, 'name' => 'Updated Name']);
    }

    public function test_member_cannot_update_organization(): void
    {
        [$org, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->patch(route('organization.update', ['organization' => $org->slug]), [
                'name' => 'Hacked Name',
            ])
            ->assertForbidden();
    }
}
