<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Enums\IntegrationProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SeoDashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_member_can_view_seo_dashboard_with_empty_state(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('stats.websites', 1)
                ->where('stats.keywords_tracked', 0)
                ->where('stats.has_synced_data', false)
                ->where('trends.gsc_clicks', [])
                ->where('trends.gsc_impressions', [])
                ->where('trends.ga4_organic_sessions', [])
                ->where('landingPages', [])
                ->where('searchQueries', []));
    }

    public function test_dashboard_reads_filtered_local_analytics_tables_only(): void
    {
        Http::fake();

        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);
        $otherWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'sessions' => 42,
            'conversions' => 3,
            'clicks' => 12,
            'impressions' => 100,
            'average_position' => 5.25,
        ]);
        AnalyticsLandingPage::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'page_path' => '/services',
            'page_path_hash' => hash('sha256', '/services'),
            'sessions' => 30,
            'conversions' => 2,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'query' => 'ultron seo',
            'query_hash' => hash('sha256', 'ultron seo'),
            'clicks' => 12,
            'impressions' => 100,
            'ctr' => 0.12,
            'average_position' => 5.25,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'metric_date' => '2026-06-10',
            'sessions' => 999,
            'clicks' => 999,
            'impressions' => 999,
        ]);
        AnalyticsSyncHistory::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => AnalyticsSyncStatus::Completed->value,
            'date_from' => '2026-06-01',
            'date_to' => '2026-06-10',
            'records_synced' => 3,
            'finished_at' => '2026-06-11 00:00:00',
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', [
                'organization' => $organization->slug,
                'website_id' => $website->id,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-10',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('filters.website_id', $website->id)
                ->where('stats.clicks', 12)
                ->where('stats.impressions', 100)
                ->where('stats.ctr', 12)
                ->where('stats.average_position', 5.25)
                ->where('stats.organic_sessions', 42)
                ->where('stats.conversions', 3)
                ->where('stats.last_sync_status', 'Completed')
                ->where('trends.gsc_clicks.0.date', '2026-06-10 00:00:00')
                ->where('trends.gsc_clicks.0.value', 12)
                ->where('trends.gsc_impressions.0.value', 100)
                ->where('trends.ga4_organic_sessions.0.value', 42)
                ->where('landingPages.0.page_path', '/services')
                ->where('landingPages.0.sessions', 30)
                ->where('searchQueries.0.query', 'ultron seo')
                ->where('searchQueries.0.clicks', 12));

        Http::assertNothingSent();
    }

    public function test_cross_organization_seo_dashboard_is_forbidden(): void
    {
        [$organization] = $this->createOrgWithOwner();
        [, $otherUser] = $this->createOrgWithOwner();

        $this->actingAs($otherUser)
            ->get(route('seo.index', ['organization' => $organization->slug]))
            ->assertForbidden();
    }

    public function test_unauthenticated_user_is_redirected_from_seo_dashboard(): void
    {
        [$organization] = $this->createOrgWithOwner();

        $this->get(route('seo.index', ['organization' => $organization->slug]))
            ->assertRedirect(route('login'));
    }

    public function test_seo_dashboard_loads_with_source_all(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug, 'source' => 'all']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('filters.source', 'all'));
    }

    public function test_seo_dashboard_loads_with_source_ga4(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug, 'source' => 'ga4']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('filters.source', 'ga4'));
    }

    public function test_seo_dashboard_loads_with_source_gsc(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug, 'source' => 'gsc']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('filters.source', 'gsc'));
    }

    public function test_seo_dashboard_rejects_invalid_source(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug, 'source' => 'invalid']))
            ->assertSessionHasErrors('source');
    }

    public function test_seo_dashboard_defaults_source_to_all(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('filters.source', 'all'));
    }

    public function test_cross_organization_website_filter_is_rejected(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        [$otherOrganization, $otherUser] = $this->createOrgWithOwner();
        $client = Client::factory()->create([
            'organization_id' => $otherOrganization->id,
            'created_by' => $otherUser->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $otherOrganization->id,
            'client_id' => $client->id,
            'created_by' => $otherUser->id,
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', [
                'organization' => $organization->slug,
                'website_id' => $website->id,
            ]))
            ->assertSessionHasErrors('website_id');
    }

    public function test_gsc_trend_data_returns_daily_clicks_and_impressions(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-09',
            'clicks' => 5,
            'impressions' => 50,
            'sessions' => 0,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 9,
            'impressions' => 90,
            'sessions' => 0,
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', [
                'organization' => $organization->slug,
                'source' => 'gsc',
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->has('trends.gsc_clicks', 2)
                ->where('trends.gsc_clicks.0.value', 5)
                ->where('trends.gsc_clicks.1.value', 9)
                ->has('trends.gsc_impressions', 2)
                ->where('trends.gsc_impressions.0.value', 50)
                ->where('trends.gsc_impressions.1.value', 90)
                ->where('trends.ga4_organic_sessions', [])
            );
    }

    public function test_ga4_trend_data_returns_daily_organic_sessions(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-09',
            'sessions' => 17,
            'clicks' => 0,
            'impressions' => 0,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'sessions' => 29,
            'clicks' => 0,
            'impressions' => 0,
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', [
                'organization' => $organization->slug,
                'source' => 'ga4',
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('trends.gsc_clicks', [])
                ->where('trends.gsc_impressions', [])
                ->has('trends.ga4_organic_sessions', 2)
                ->where('trends.ga4_organic_sessions.0.value', 17)
                ->where('trends.ga4_organic_sessions.1.value', 29)
            );
    }

    public function test_trend_data_is_scoped_to_allowed_client_websites(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $myWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'metric_date' => '2026-06-10',
            'sessions' => 10,
            'clicks' => 2,
            'impressions' => 20,
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
            ->get(route('seo.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('trends.gsc_clicks.0.value', 2)
                ->where('trends.gsc_impressions.0.value', 20)
                ->where('trends.ga4_organic_sessions.0.value', 10)
                ->has('trends.gsc_clicks', 1)
                ->has('trends.gsc_impressions', 1)
                ->has('trends.ga4_organic_sessions', 1)
            );
    }

    public function test_dashboard_renders_when_trend_data_is_empty(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('seo.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('trends.gsc_clicks', [])
                ->where('trends.gsc_impressions', [])
                ->where('trends.ga4_organic_sessions', [])
            );
    }
}
