<?php

declare(strict_types=1);

namespace Tests\Feature\Reports;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsLandingPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportsTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_access_reports_page(): void
    {
        [$organization, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('reports.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('reports/Index'));
    }

    public function test_client_can_access_reports_page(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
        ]);
        [$clientUser] = $this->createClientUser($organization, $client);

        $this->actingAs($clientUser)
            ->get(route('reports.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('reports/Index'));
    }

    public function test_client_only_receives_assigned_website_report_data(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $myWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $myClient->id,
            'created_by' => $admin->id,
        ]);
        $otherWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $otherClient->id,
            'created_by' => $admin->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'metric_date' => '2026-06-10',
            'clicks' => 20,
            'impressions' => 200,
            'sessions' => 50,
            'conversions' => 5,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'metric_date' => '2026-06-10',
            'clicks' => 999,
            'impressions' => 9999,
            'sessions' => 999,
            'conversions' => 99,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('summary.gsc_clicks', 20)
                ->where('summary.gsc_impressions', 200)
                ->where('summary.ga4_sessions', 50)
                ->where('summary.ga4_conversions', 5)
            );
    }

    public function test_report_preview_renders_with_empty_data(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', false)
                ->where('summary.gsc_clicks', 0)
                ->where('summary.ga4_sessions', 0)
                ->where('top_queries', [])
                ->where('top_pages', [])
                ->where('seo_insights', [])
            );
    }

    public function test_report_preview_returns_ga4_gsc_summary_when_data_exists(): void
    {
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

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
            'average_position' => 4.5,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'query' => 'ultron reports',
            'query_hash' => hash('sha256', 'ultron reports'),
            'clicks' => 30,
            'impressions' => 300,
            'ctr' => 0.10,
            'average_position' => 4.5,
        ]);
        AnalyticsLandingPage::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'page_path' => '/about',
            'page_path_hash' => hash('sha256', '/about'),
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', true)
                ->where('summary.gsc_clicks', 30)
                ->where('summary.gsc_impressions', 300)
                ->where('summary.ga4_sessions', 80)
                ->where('summary.ga4_conversions', 8)
                ->where('top_queries.0.query', 'ultron reports')
                ->where('top_queries.0.clicks', 30)
                ->where('top_pages.0.page_path', '/about')
                ->where('top_pages.0.sessions', 80)
            );
    }

    public function test_website_id_filter_scopes_report_to_single_website(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $websiteA = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);
        $websiteB = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $websiteA->id,
            'metric_date' => '2026-06-10',
            'clicks' => 100,
            'impressions' => 1000,
            'sessions' => 200,
            'conversions' => 10,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $websiteB->id,
            'metric_date' => '2026-06-10',
            'clicks' => 50,
            'impressions' => 500,
            'sessions' => 80,
            'conversions' => 5,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'website_id' => $websiteA->id,
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('summary.gsc_clicks', 100)
                ->where('summary.ga4_sessions', 200)
            );
    }

    public function test_date_range_excludes_out_of_range_metrics(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-05-15',
            'clicks' => 999,
            'impressions' => 9999,
            'sessions' => 999,
            'conversions' => 99,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', true)
                ->where('summary.gsc_clicks', 30)
                ->where('summary.ga4_sessions', 80)
            );
    }

    public function test_source_ga4_only_returns_ga4_metrics_and_empty_queries(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'query' => 'test query',
            'query_hash' => hash('sha256', 'test query'),
            'clicks' => 30,
            'impressions' => 300,
            'ctr' => 0.10,
            'average_position' => 4.5,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'source' => 'ga4',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', true)
                ->where('summary.ga4_sessions', 80)
                ->where('summary.ga4_conversions', 8)
                ->where('summary.gsc_clicks', 0)
                ->where('summary.gsc_impressions', 0)
                ->where('top_queries', [])
            );
    }

    public function test_source_gsc_only_returns_gsc_metrics_and_empty_pages(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);
        AnalyticsLandingPage::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'page_path' => '/about',
            'page_path_hash' => hash('sha256', '/about'),
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'source' => 'gsc',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('has_report_data', true)
                ->where('summary.gsc_clicks', 30)
                ->where('summary.gsc_impressions', 300)
                ->where('summary.ga4_sessions', 0)
                ->where('summary.ga4_conversions', 0)
                ->where('top_pages', [])
            );
    }

    public function test_client_cannot_filter_by_another_clients_website(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $myClient->id,
            'created_by' => $admin->id,
        ]);
        $otherWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $otherClient->id,
            'created_by' => $admin->id,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'website_id' => $otherWebsite->id,
            ]))
            ->assertSessionHasErrors('website_id');
    }

    public function test_websites_list_returned_for_dropdown(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->has('websites', 1)
                ->has('websites.0.id')
                ->has('websites.0.name')
            );
    }

    public function test_trends_returned_for_source_all(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'source' => 'all',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->has('trends.gsc_clicks', 1)
                ->where('trends.gsc_clicks.0.value', 30)
                ->has('trends.gsc_impressions', 1)
                ->where('trends.gsc_impressions.0.value', 300)
                ->has('trends.ga4_sessions', 1)
                ->where('trends.ga4_sessions.0.value', 80)
            );
    }

    public function test_gsc_trends_empty_for_source_ga4(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'source' => 'ga4',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->where('trends.gsc_clicks', [])
                ->where('trends.gsc_impressions', [])
                ->has('trends.ga4_sessions', 1)
                ->where('trends.ga4_sessions.0.value', 80)
            );
    }

    public function test_ga4_trends_empty_for_source_gsc(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'source' => 'gsc',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->has('trends.gsc_clicks', 1)
                ->where('trends.gsc_clicks.0.value', 30)
                ->where('trends.ga4_sessions', [])
            );
    }

    public function test_trends_respect_website_id_filter(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $websiteA = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);
        $websiteB = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $websiteA->id,
            'metric_date' => '2026-06-10',
            'clicks' => 100,
            'impressions' => 1000,
            'sessions' => 200,
            'conversions' => 10,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $websiteB->id,
            'metric_date' => '2026-06-10',
            'clicks' => 50,
            'impressions' => 500,
            'sessions' => 80,
            'conversions' => 5,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
                'website_id' => $websiteA->id,
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->has('trends.gsc_clicks', 1)
                ->where('trends.gsc_clicks.0.value', 100)
                ->has('trends.ga4_sessions', 1)
                ->where('trends.ga4_sessions.0.value', 200)
            );
    }

    public function test_trends_exclude_out_of_range_dates(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-05-15',
            'clicks' => 999,
            'impressions' => 9999,
            'sessions' => 999,
            'conversions' => 99,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'metric_date' => '2026-06-10',
            'clicks' => 30,
            'impressions' => 300,
            'sessions' => 80,
            'conversions' => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->has('trends.gsc_clicks', 1)
                ->where('trends.gsc_clicks.0.value', 30)
            );
    }

    public function test_client_trend_data_scoped_to_own_websites(): void
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
            'clicks' => 20,
            'impressions' => 200,
            'sessions' => 50,
            'conversions' => 5,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'metric_date' => '2026-06-10',
            'clicks' => 999,
            'impressions' => 9999,
            'sessions' => 999,
            'conversions' => 99,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.index', [
                'organization' => $organization->slug,
                'date_from' => '2026-06-01',
                'date_to' => '2026-06-30',
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('reports/Index')
                ->has('trends.gsc_clicks', 1)
                ->where('trends.gsc_clicks.0.value', 20)
            );
    }
}
