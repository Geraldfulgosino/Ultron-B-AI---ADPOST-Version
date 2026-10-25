<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrganizationPageRenderTest extends TestCase
{
    use RefreshDatabase;

    // ─── clients.index ───────────────────────────────────────────────────────

    public function test_member_can_view_clients_index(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('clients.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('clients/Index'));
    }

    public function test_clients_index_passes_current_organization_in_shared_props(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('clients.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('currentOrganization')
                ->where('currentOrganization.slug', $organization->slug)
            );
    }

    public function test_unauthenticated_user_is_redirected_from_clients_index(): void
    {
        [$organization] = $this->createOrgWithOwner();

        $this->get(route('clients.index', ['organization' => $organization->slug]))
            ->assertRedirect(route('login'));
    }

    public function test_non_member_cannot_access_clients_index(): void
    {
        [$organization] = $this->createOrgWithOwner();
        [, $otherUser] = $this->createOrgWithOwner();

        $this->actingAs($otherUser)
            ->get(route('clients.index', ['organization' => $organization->slug]))
            ->assertForbidden();
    }

    // ─── websites.index ──────────────────────────────────────────────────────

    public function test_member_can_view_websites_index(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('websites.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('websites/Index'));
    }

    public function test_websites_index_passes_current_organization_in_shared_props(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('websites.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('currentOrganization')
                ->where('currentOrganization.slug', $organization->slug)
            );
    }

    public function test_unauthenticated_user_is_redirected_from_websites_index(): void
    {
        [$organization] = $this->createOrgWithOwner();

        $this->get(route('websites.index', ['organization' => $organization->slug]))
            ->assertRedirect(route('login'));
    }

    public function test_non_member_cannot_access_websites_index(): void
    {
        [$organization] = $this->createOrgWithOwner();
        [, $otherUser] = $this->createOrgWithOwner();

        $this->actingAs($otherUser)
            ->get(route('websites.index', ['organization' => $organization->slug]))
            ->assertForbidden();
    }

    // ─── seo.insights.index ──────────────────────────────────────────────────

    public function test_member_can_view_seo_insights_index(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('seo/InsightsIndex'));
    }

    public function test_seo_insights_index_passes_current_organization_in_shared_props(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('currentOrganization')
                ->where('currentOrganization.slug', $organization->slug)
            );
    }

    public function test_unauthenticated_user_is_redirected_from_seo_insights_index(): void
    {
        [$organization] = $this->createOrgWithOwner();

        $this->get(route('seo.insights.index', ['organization' => $organization->slug]))
            ->assertRedirect(route('login'));
    }

    public function test_non_member_cannot_access_seo_insights_index(): void
    {
        [$organization] = $this->createOrgWithOwner();
        [, $otherUser] = $this->createOrgWithOwner();

        $this->actingAs($otherUser)
            ->get(route('seo.insights.index', ['organization' => $organization->slug]))
            ->assertForbidden();
    }
}
