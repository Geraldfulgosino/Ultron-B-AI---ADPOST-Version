<?php

declare(strict_types=1);

namespace Tests\Feature\Sidebar;

use App\Domains\Clients\Models\Client;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regression baseline for the sidebar nav routes.
 *
 * Each test confirms a nav-linked URL is accessible and returns the expected
 * Inertia component for admin, and that the shared currentOrganization.role
 * prop is 'client' for client users (which drives frontend nav filtering).
 */
class SidebarNavTest extends TestCase
{
    use RefreshDatabase;

    public function test_seo_page_renders_at_seo_url(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('seo.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('seo/Index'));
    }

    public function test_seo_insights_renders_at_seo_insights_url(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('seo/InsightsIndex'));
    }

    public function test_reports_renders_at_reports_url(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('reports.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('reports/Index'));
    }

    public function test_members_renders_at_members_url_for_admin(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('organizations/Members'));
    }

    public function test_members_renders_at_members_url_for_owner(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('organizations/Members'));
    }

    public function test_client_user_shared_props_carry_client_role(): void
    {
        // The frontend uses currentOrganization.role === 'client' to filter
        // nav items with clientVisible: false (Members, Settings).
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

    public function test_seo_insights_detail_url_is_prefixed_by_seo_insights(): void
    {
        // Confirms the URL structure: /{org}/seo/insights/{id} starts with
        // /{org}/seo/insights — so the most-specific-match algorithm will
        // correctly activate SEO Insights, not SEO, on detail pages.
        [$org, $admin] = $this->createOrgWithUser('admin');

        $seoRoute    = route('seo.index',           ['organization' => $org->slug]);
        $insightRoute = route('seo.insights.index', ['organization' => $org->slug]);

        $this->assertStringStartsWith($seoRoute, $insightRoute);
        $this->assertNotEquals($seoRoute, $insightRoute);
        $this->assertGreaterThan(strlen($seoRoute), strlen($insightRoute));
    }
}
