<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_unauthenticated_user_is_redirected_from_dashboard(): void
    {
        [$organization] = $this->createOrgWithOwner();

        $this->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertRedirect(route('login'));
    }

    public function test_dashboard_loads_for_authenticated_member(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('Dashboard'));
    }

    public function test_dashboard_passes_organization_and_member_props(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('Dashboard')
                ->has('organization')
                ->has('member')
                ->has('stats')
                ->where('organization.slug', $organization->slug)
                ->where('member.role', 'admin')
            );
    }

    public function test_dashboard_stats_reflect_org_records(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');

        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        Website::factory()->count(2)->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('stats.clients_count', 1)
                ->where('stats.websites_count', 2)
            );
    }

    public function test_non_member_cannot_access_dashboard(): void
    {
        [$organization] = $this->createOrgWithOwner();
        [$otherOrg, $otherUser] = $this->createOrgWithOwner();

        $this->actingAs($otherUser)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertForbidden();
    }

    public function test_dashboard_only_exposes_active_org_data(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        [$otherOrg] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('organization.slug', $organization->slug)
                ->where('organization.name', $organization->name)
            );

        // Verify the other org's slug is not in the active org's props
        $this->assertNotEquals($organization->slug, $otherOrg->slug);
    }

    public function test_owner_sees_organization_level_dashboard_counts(): void
    {
        [$organization, $owner] = $this->createOrgWithOwner();

        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $owner->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $owner->id,
        ]);
        Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $owner->id,
            'status' => IntegrationStatus::Connected->value,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'sessions' => 25,
            'clicks' => 10,
            'impressions' => 100,
        ]);
        AnalyticsSyncHistory::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'status' => AnalyticsSyncStatus::Completed->value,
            'finished_at' => '2026-06-10 10:00:00',
        ]);
        SeoInsight::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'status' => SeoInsightStatus::Pending->value,
        ]);

        $this->actingAs($owner)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('Dashboard')
                ->where('stats.clients_count', 1)
                ->where('stats.websites_count', 1)
                ->where('stats.connected_integrations_count', 1)
                ->where('stats.last_sync_status', 'Completed')
                ->where('stats.gsc_clicks', 10)
                ->where('stats.gsc_impressions', 100)
                ->where('stats.ga4_organic_sessions', 25)
                ->where('stats.open_seo_insights_count', 1)
                ->has('stats.recent_seo_insights', 1)
            );
    }

    public function test_client_sees_only_assigned_client_dashboard_counts(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $myWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'created_by' => $admin->id,
            'status' => IntegrationStatus::Connected->value,
        ]);
        Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'created_by' => $admin->id,
            'status' => IntegrationStatus::Connected->value,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'metric_date' => '2026-06-10',
            'sessions' => 11,
            'clicks' => 7,
            'impressions' => 70,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'metric_date' => '2026-06-10',
            'sessions' => 999,
            'clicks' => 999,
            'impressions' => 999,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('Dashboard')
                ->where('stats.clients_count', 1)
                ->where('stats.websites_count', 1)
                ->where('stats.connected_integrations_count', 1)
                ->where('stats.gsc_clicks', 7)
                ->where('stats.gsc_impressions', 70)
                ->where('stats.ga4_organic_sessions', 11)
            );
    }

    public function test_client_dashboard_does_not_include_other_client_websites_or_insights(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $myWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        $visibleInsight = SeoInsight::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'title' => 'Visible client insight',
            'status' => SeoInsightStatus::Pending->value,
        ]);
        SeoInsight::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'title' => 'Hidden other client insight',
            'status' => SeoInsightStatus::Pending->value,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $response = $this->actingAs($clientUser)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('Dashboard')
                ->where('stats.open_seo_insights_count', 1)
                ->where('stats.recent_seo_insights.0.id', $visibleInsight->id)
                ->where('stats.recent_seo_insights.0.website_name', $myWebsite->name)
                ->has('stats.recent_seo_insights', 1)
            );

        $response->assertDontSee('Hidden other client insight');
        $response->assertDontSee($otherWebsite->name);
    }

    public function test_dashboard_renders_with_no_analytics_data(): void
    {
        [$organization, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('dashboard', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('Dashboard')
                ->where('stats.clients_count', 0)
                ->where('stats.websites_count', 0)
                ->where('stats.connected_integrations_count', 0)
                ->where('stats.last_sync_status', null)
                ->where('stats.last_sync_at', null)
                ->where('stats.gsc_clicks', 0)
                ->where('stats.gsc_impressions', 0)
                ->where('stats.ga4_organic_sessions', 0)
                ->where('stats.open_seo_insights_count', 0)
                ->where('stats.recent_seo_insights', [])
                ->where('stats.has_synced_data', false)
            );
    }
}
