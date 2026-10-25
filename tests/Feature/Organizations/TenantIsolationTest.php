<?php

declare(strict_types=1);

namespace Tests\Feature\Organizations;

use App\Domains\Identity\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    public function test_member_of_one_org_cannot_access_another_org_dashboard(): void
    {
        [$org1] = $this->createOrgWithOwner();
        [, $user2] = $this->createOrgWithOwner();

        $this->actingAs($user2)
            ->get(route('dashboard', ['organization' => $org1->slug]))
            ->assertForbidden();
    }

    public function test_non_member_cannot_access_org_routes(): void
    {
        [$org] = $this->createOrgWithOwner();
        $outsider = User::factory()->create();

        $this->actingAs($outsider)
            ->get(route('dashboard', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    public function test_non_existent_org_slug_returns_404(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->get('/totally-fake-org-slug/dashboard')
            ->assertNotFound();
    }

    public function test_suspended_org_denies_access(): void
    {
        [$org, $user] = $this->createOrgWithOwner();
        $org->update(['status' => 'suspended']);

        $this->actingAs($user)
            ->get(route('dashboard', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    public function test_member_can_access_own_org_members_page(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertOk();
    }

    public function test_cross_org_member_page_is_forbidden(): void
    {
        [$org1] = $this->createOrgWithOwner();
        [, $user2] = $this->createOrgWithOwner();

        $this->actingAs($user2)
            ->get(route('organization.members', ['organization' => $org1->slug]))
            ->assertForbidden();
    }

    public function test_unauthenticated_request_redirects_to_login(): void
    {
        [$org] = $this->createOrgWithOwner();

        $this->get(route('dashboard', ['organization' => $org->slug]))
            ->assertRedirect(route('login'));
    }
}
