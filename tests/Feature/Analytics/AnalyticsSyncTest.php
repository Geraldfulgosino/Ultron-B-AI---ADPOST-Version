<?php

declare(strict_types=1);

namespace Tests\Feature\Analytics;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Jobs\SyncGoogleAnalyticsJob;
use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Analytics\Services\GoogleAnalyticsDataService;
use App\Domains\Analytics\Services\GoogleSearchConsoleDataService;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class AnalyticsSyncTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_queue_manual_analytics_sync(): void
    {
        Queue::fake();

        [$organization, $user] = $this->createOrgWithUser('admin');
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => IntegrationStatus::Connected->value,
            'external_property_id' => '123456',
            'access_token' => 'encrypted-access-token',
            'token_expires_at' => now()->addHour(),
        ]);

        $this->actingAs($user)
            ->post(route('integrations.sync', ['organization' => $organization->slug, 'integration' => $integration->id]), [
                'organization_id' => 999999,
            ])
            ->assertRedirect()
            ->assertSessionHas('success');

        $this->assertDatabaseHas('analytics_sync_histories', [
            'organization_id' => $organization->id,
            'integration_id' => $integration->id,
            'requested_by' => $user->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => AnalyticsSyncStatus::Queued->value,
        ]);
        $this->assertDatabaseMissing('analytics_sync_histories', ['organization_id' => 999999]);

        Queue::assertPushed(SyncGoogleAnalyticsJob::class);
    }

    public function test_member_cannot_queue_manual_analytics_sync(): void
    {
        Queue::fake();

        [$organization, $user] = $this->createOrgWithUser('member');
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'status' => IntegrationStatus::Connected->value,
            'access_token' => 'encrypted-access-token',
            'token_expires_at' => now()->addHour(),
        ]);

        $this->actingAs($user)
            ->post(route('integrations.sync', ['organization' => $organization->slug, 'integration' => $integration->id]))
            ->assertForbidden();

        Queue::assertNothingPushed();
    }

    public function test_cross_organization_sync_is_forbidden(): void
    {
        Queue::fake();

        [$organization, $user] = $this->createOrgWithUser('admin');
        [$otherOrganization, $otherUser] = $this->createOrgWithOwner();
        $integration = Integration::factory()->create([
            'organization_id' => $otherOrganization->id,
            'created_by' => $otherUser->id,
            'status' => IntegrationStatus::Connected->value,
            'access_token' => 'encrypted-access-token',
            'token_expires_at' => now()->addHour(),
        ]);

        $this->actingAs($user)
            ->post(route('integrations.sync', ['organization' => $organization->slug, 'integration' => $integration->id]))
            ->assertForbidden();

        Queue::assertNothingPushed();
    }

    public function test_seo_dashboard_uses_local_synced_analytics_only(): void
    {
        Http::fake();

        [$organization, $user] = $this->createOrgWithUser('member');
        [$otherOrganization] = $this->createOrgWithOwner();

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'metric_date' => now()->subDay()->toDateString(),
            'sessions' => 25,
            'clicks' => 10,
            'impressions' => 100,
            'average_position' => 4.5,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organization->id,
            'metric_date' => now()->subDay()->toDateString(),
            'query' => 'ultron business ai',
            'clicks' => 10,
            'impressions' => 100,
            'ctr' => 0.1,
            'average_position' => 4.5,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $otherOrganization->id,
            'metric_date' => now()->subDay()->toDateString(),
            'sessions' => 999,
            'clicks' => 999,
            'impressions' => 999,
            'average_position' => 99,
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('stats.organic_sessions', 25)
                ->where('stats.clicks', 10)
                ->where('stats.impressions', 100)
                ->where('stats.keywords_tracked', 1)
                ->where('stats.has_synced_data', true));

        Http::assertNothingSent();
    }

    public function test_ga_sync_fails_clearly_when_ga4_property_id_is_missing(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'website_id' => null,
            'external_property_id' => null,
            'access_token' => 'token',
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Google Analytics property ID is missing.');

        (new GoogleAnalyticsDataService())->fetchDailyMetrics($integration, '2026-01-01', '2026-01-07');
    }

    public function test_gsc_sync_fails_clearly_when_gsc_site_url_is_missing(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
            'website_id' => null,
            'external_property_id' => null,
            'access_token' => 'token',
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Search Console site URL is missing.');

        (new GoogleSearchConsoleDataService())->fetchDailyMetrics($integration, '2026-01-01', '2026-01-07');
    }

    public function test_ga_sync_reads_property_id_from_website_ga4_property_id_field(): void
    {
        Http::fake(['analyticsdata.googleapis.com/*' => Http::response(['rows' => []], 200)]);

        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
            'ga4_property_id' => '516552354',
        ]);
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'external_property_id' => null,
            'access_token' => 'token',
        ]);

        $result = (new GoogleAnalyticsDataService())->fetchDailyMetrics($integration, '2026-01-01', '2026-01-07');

        $this->assertIsArray($result);
        Http::assertSent(fn ($request) => str_contains((string) $request->url(), '516552354'));
    }

    public function test_gsc_sync_passes_sc_domain_value_directly_to_api(): void
    {
        Http::fake(['searchconsole.googleapis.com/*' => Http::response(['rows' => []], 200)]);

        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
            'gsc_site_url' => 'sc-domain:lugenixdigitalservices.com',
        ]);
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
            'external_property_id' => null,
            'access_token' => 'token',
        ]);

        (new GoogleSearchConsoleDataService())->fetchDailyMetrics($integration, '2026-01-01', '2026-01-07');

        Http::assertSent(fn ($request) => str_contains(
            (string) $request->url(),
            rawurlencode('sc-domain:lugenixdigitalservices.com')
        ));
    }

    public function test_gsc_sync_reads_site_url_from_website_gsc_site_url_field(): void
    {
        Http::fake(['searchconsole.googleapis.com/*' => Http::response(['rows' => []], 200)]);

        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
            'gsc_site_url' => 'https://lugenixdigitalservices.com/',
        ]);
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
            'external_property_id' => null,
            'access_token' => 'token',
        ]);

        (new GoogleSearchConsoleDataService())->fetchDailyMetrics($integration, '2026-01-01', '2026-01-07');

        Http::assertSent(fn ($request) => str_contains(
            (string) $request->url(),
            rawurlencode('https://lugenixdigitalservices.com/')
        ));
    }

    public function test_google_analytics_job_persists_metrics_and_sync_history(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => IntegrationStatus::Connected->value,
            'external_property_id' => '123456',
            'access_token' => 'encrypted-access-token',
            'token_expires_at' => now()->addHour(),
        ]);
        $history = AnalyticsSyncHistory::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'integration_id' => $integration->id,
            'requested_by' => $user->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => AnalyticsSyncStatus::Queued->value,
        ]);

        $service = new class extends GoogleAnalyticsDataService
        {
            public function fetchDailyMetrics(Integration $integration, string $dateFrom, string $dateTo): array
            {
                return [[
                    'metric_date' => $dateTo,
                    'sessions' => 7,
                    'active_users' => 6,
                    'new_users' => 5,
                    'screen_page_views' => 14,
                    'conversions' => 2,
                    'total_revenue' => 19.99,
                ]];
            }

            public function fetchLandingPages(Integration $integration, string $dateFrom, string $dateTo): array
            {
                return [[
                    'metric_date' => $dateTo,
                    'page_path' => '/',
                    'sessions' => 7,
                    'active_users' => 6,
                    'screen_page_views' => 14,
                    'conversions' => 2,
                    'total_revenue' => 19.99,
                ]];
            }
        };

        (new SyncGoogleAnalyticsJob($history->id))->handle($service);

        $this->assertDatabaseHas('analytics_daily_metrics', [
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'integration_id' => $integration->id,
            'sessions' => 7,
            'screen_page_views' => 14,
        ]);
        $this->assertDatabaseHas('analytics_landing_pages', [
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'integration_id' => $integration->id,
            'page_path' => '/',
            'sessions' => 7,
        ]);
        $this->assertDatabaseHas('analytics_sync_histories', [
            'id' => $history->id,
            'status' => AnalyticsSyncStatus::Completed->value,
            'records_synced' => 2,
        ]);
    }
}
