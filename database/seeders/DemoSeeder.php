<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        abort_if(app()->isProduction(), 403, 'DemoSeeder must not run in production.');

        // ── Users ────────────────────────────────────────────────────────────

        $owner = User::factory()->create([
            'name' => 'Demo Owner',
            'email' => 'demo@example.com',
            'password' => Hash::make('password'),
        ]);

        $admin = User::factory()->create([
            'name' => 'Demo Admin',
            'email' => 'admin@example.com',
            'password' => Hash::make('password'),
        ]);

        $member = User::factory()->create([
            'name' => 'Demo Member',
            'email' => 'member@example.com',
            'password' => Hash::make('password'),
        ]);

        $viewer = User::factory()->create([
            'name' => 'Demo Viewer',
            'email' => 'viewer@example.com',
            'password' => Hash::make('password'),
        ]);

        // ── Organization ─────────────────────────────────────────────────────

        $org = Organization::factory()->create([
            'name' => 'Demo Agency',
            'slug' => 'demo-agency',
        ]);

        OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $owner->id,
            'role' => MemberRole::Owner->value,
        ]);

        OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $admin->id,
            'role' => MemberRole::Admin->value,
        ]);

        OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $member->id,
            'role' => MemberRole::Member->value,
        ]);

        OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $viewer->id,
            'role' => MemberRole::Viewer->value,
        ]);

        // ── Clients ──────────────────────────────────────────────────────────

        $clientA = Client::factory()->create([
            'organization_id' => $org->id,
            'created_by' => $owner->id,
            'name' => 'Acme Corp',
            'slug' => 'acme-corp',
        ]);

        $clientB = Client::factory()->create([
            'organization_id' => $org->id,
            'created_by' => $admin->id,
            'name' => 'Beta Foods',
            'slug' => 'beta-foods',
        ]);

        $clientC = Client::factory()->archived()->create([
            'organization_id' => $org->id,
            'created_by' => $admin->id,
            'name' => 'Old Client (Archived)',
            'slug' => 'old-client-archived',
        ]);

        // ── Websites ─────────────────────────────────────────────────────────

        $websiteA = Website::factory()->create([
            'organization_id' => $org->id,
            'client_id' => $clientA->id,
            'created_by' => $owner->id,
            'name' => 'Acme Main Site',
            'domain' => 'acme-corp.example.com',
        ]);

        $websiteB = Website::factory()->create([
            'organization_id' => $org->id,
            'client_id' => $clientA->id,
            'created_by' => $owner->id,
            'name' => 'Acme Blog',
            'domain' => 'blog.acme-corp.example.com',
        ]);

        $websiteC = Website::factory()->create([
            'organization_id' => $org->id,
            'client_id' => $clientB->id,
            'created_by' => $admin->id,
            'name' => 'Beta Foods Site',
            'domain' => 'beta-foods.example.com',
        ]);

        $websiteD = Website::factory()->archived()->create([
            'organization_id' => $org->id,
            'client_id' => $clientC->id,
            'created_by' => $admin->id,
            'name' => 'Old Site (Archived)',
            'domain' => 'old-site.example.com',
        ]);

        // ── Integration ──────────────────────────────────────────────────────

        $integration = Integration::factory()->create([
            'organization_id' => $org->id,
            'website_id' => $websiteA->id,
            'created_by' => $owner->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => IntegrationStatus::Connected->value,
            'external_account_id' => '123456789',
            'external_account_name' => 'demo@example.com',
            'token_expires_at' => now()->addDays(30),
        ]);

        // ── Analytics (30 days of daily metrics for websiteA) ────────────────

        $this->seedAnalytics($org->id, $websiteA->id, $integration->id);

        // ── SEO Insights ─────────────────────────────────────────────────────

        $this->seedInsights($org, $websiteA, $websiteB, $owner, $admin);
    }

    private function seedAnalytics(int $orgId, int $websiteId, int $integrationId): void
    {
        $rows = [];
        $base = now()->subDays(30);

        for ($i = 0; $i < 30; $i++) {
            $date = $base->copy()->addDays($i)->toDateString();
            $sessions = random_int(80, 400);
            $clicks = random_int(30, 200);
            $impressions = $clicks * random_int(5, 20);
            $ctr = $impressions > 0 ? round($clicks / $impressions, 4) : 0;
            $avgPos = round(mt_rand(15, 80) / 10, 2);

            $rows[] = [
                'organization_id' => $orgId,
                'website_id' => $websiteId,
                'integration_id' => $integrationId,
                'metric_date' => $date,
                'sessions' => $sessions,
                'active_users' => (int) ($sessions * 0.8),
                'new_users' => (int) ($sessions * 0.4),
                'screen_page_views' => $sessions * random_int(2, 5),
                'conversions' => random_int(0, 10),
                'total_revenue' => 0,
                'clicks' => $clicks,
                'impressions' => $impressions,
                'ctr' => $ctr,
                'average_position' => $avgPos,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        DB::table('analytics_daily_metrics')->insert($rows);

        // A handful of landing page rows
        $pages = ['/home', '/about', '/products', '/contact', '/blog'];
        $lpRows = [];
        foreach ($pages as $path) {
            $lpRows[] = [
                'organization_id' => $orgId,
                'website_id' => $websiteId,
                'integration_id' => $integrationId,
                'metric_date' => now()->subDays(1)->toDateString(),
                'page_path' => $path,
                'page_path_hash' => hash('sha256', $path),
                'sessions' => random_int(20, 150),
                'active_users' => random_int(15, 100),
                'screen_page_views' => random_int(30, 300),
                'conversions' => random_int(0, 5),
                'total_revenue' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('analytics_landing_pages')->insert($lpRows);

        // A handful of search query rows
        $queries = ['best seo tools', 'digital marketing agency', 'content strategy 2026', 'local seo tips', 'google analytics tutorial'];
        $sqRows = [];
        foreach ($queries as $query) {
            $sqClicks = random_int(5, 80);
            $sqImpressions = $sqClicks * random_int(8, 25);
            $sqRows[] = [
                'organization_id' => $orgId,
                'website_id' => $websiteId,
                'integration_id' => $integrationId,
                'metric_date' => now()->subDays(1)->toDateString(),
                'query' => $query,
                'query_hash' => hash('sha256', $query),
                'clicks' => $sqClicks,
                'impressions' => $sqImpressions,
                'ctr' => $sqImpressions > 0 ? round($sqClicks / $sqImpressions, 4) : 0,
                'average_position' => round(mt_rand(15, 80) / 10, 2),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('analytics_search_queries')->insert($sqRows);

        // Sync history
        DB::table('analytics_sync_histories')->insert([
            'organization_id' => $orgId,
            'website_id' => $websiteId,
            'integration_id' => $integrationId,
            'requested_by' => null,
            'provider' => 'google_analytics',
            'status' => 'completed',
            'date_from' => now()->subDays(30)->toDateString(),
            'date_to' => now()->toDateString(),
            'records_synced' => 30,
            'started_at' => now()->subMinutes(5),
            'finished_at' => now()->subMinutes(4),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedInsights(
        Organization $org,
        Website $websiteA,
        Website $websiteB,
        User $owner,
        User $admin,
    ): void {
        $base = [
            'organization_id' => $org->id,
            'date_from' => now()->subDays(14)->toDateString(),
            'date_to' => now()->toDateString(),
        ];

        // Pending insights
        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteA->id,
            'generated_by' => $owner->id,
            'type' => SeoInsightType::RankingOpportunity->value,
            'status' => SeoInsightStatus::Pending->value,
            'severity' => 'high',
            'subject_type' => 'query',
            'subject_value' => 'digital marketing agency',
            'title' => 'Ranking opportunity: "digital marketing agency"',
            'summary' => 'This query has strong impressions but ranks between 11–20. Improving the landing page could capture first-page clicks.',
            'recommendation' => 'Update the landing page title and add a dedicated FAQ section targeting this query.',
            'evidence' => ['impressions' => 1200, 'average_position' => 14.3, 'clicks' => 22],
        ]));

        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteA->id,
            'generated_by' => $owner->id,
            'type' => SeoInsightType::HighImpressionLowCtrQuery->value,
            'status' => SeoInsightStatus::Pending->value,
            'severity' => 'medium',
            'subject_type' => 'query',
            'subject_value' => 'best seo tools',
            'title' => 'High impressions, low CTR: "best seo tools"',
            'summary' => 'Query gets 900+ impressions but only 1.2% CTR. The meta title and description may not match user intent.',
            'recommendation' => 'Rewrite the meta description to include a clear value proposition and call to action.',
            'evidence' => ['impressions' => 940, 'ctr' => 0.012, 'clicks' => 11],
        ]));

        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteB->id,
            'generated_by' => $owner->id,
            'type' => SeoInsightType::DecliningPageClicks->value,
            'status' => SeoInsightStatus::Pending->value,
            'severity' => 'critical',
            'subject_type' => 'page',
            'subject_value' => '/blog/seo-guide-2025',
            'title' => 'Declining clicks: /blog/seo-guide-2025',
            'summary' => 'Clicks dropped 40% compared to the previous period. This page may need a content refresh.',
            'recommendation' => 'Review the content for accuracy and add new statistics from 2026 to stay relevant.',
            'evidence' => ['previous_clicks' => 180, 'current_clicks' => 108],
        ]));

        // Reviewed insight
        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteA->id,
            'generated_by' => $owner->id,
            'reviewed_by' => $admin->id,
            'type' => SeoInsightType::ImprovingPageImpressions->value,
            'status' => SeoInsightStatus::Reviewed->value,
            'severity' => 'low',
            'subject_type' => 'page',
            'subject_value' => '/products',
            'title' => 'Improving impressions: /products',
            'summary' => 'The products page impressions grew 28% over the last two weeks.',
            'recommendation' => 'Consider adding internal links from other high-traffic pages to accelerate ranking.',
            'review_notes' => 'Looks good. Monitoring for another week before approving.',
            'reviewed_at' => now()->subDays(2),
            'evidence' => ['previous_impressions' => 320, 'current_impressions' => 409],
        ]));

        // Approved insight
        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteA->id,
            'generated_by' => $owner->id,
            'reviewed_by' => $admin->id,
            'type' => SeoInsightType::RankingOpportunity->value,
            'status' => SeoInsightStatus::Approved->value,
            'severity' => 'medium',
            'subject_type' => 'query',
            'subject_value' => 'content strategy 2026',
            'title' => 'Ranking opportunity: "content strategy 2026"',
            'summary' => 'Emerging query with growing impressions. Currently ranking at position 18.',
            'recommendation' => 'Publish a dedicated pillar post targeting this query.',
            'review_notes' => 'Approved — assigned to content team for Q3.',
            'reviewed_at' => now()->subDay(),
            'evidence' => ['impressions' => 560, 'average_position' => 18.1],
        ]));

        // Dismissed insight
        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteB->id,
            'generated_by' => $owner->id,
            'reviewed_by' => $admin->id,
            'type' => SeoInsightType::MissingOrStaleSync->value,
            'status' => SeoInsightStatus::Dismissed->value,
            'severity' => 'low',
            'subject_type' => 'website',
            'subject_value' => 'blog.acme-corp.example.com',
            'title' => 'Stale analytics sync',
            'summary' => 'Last successful sync for this website was over 7 days ago.',
            'recommendation' => 'Reconnect the integration and trigger a manual sync.',
            'review_notes' => 'Dismissed — integration was intentionally paused during redesign.',
            'reviewed_at' => now()->subDays(3),
            'evidence' => ['last_sync_days_ago' => 8],
        ]));

        // Org-wide insight (no website)
        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => null,
            'generated_by' => $owner->id,
            'type' => SeoInsightType::MissingOrStaleSync->value,
            'status' => SeoInsightStatus::Pending->value,
            'severity' => 'medium',
            'subject_type' => 'organization',
            'subject_value' => 'demo-agency',
            'title' => 'Organization has websites without analytics integrations',
            'summary' => '2 of 4 active websites have no connected analytics integration.',
            'recommendation' => 'Connect a Google Analytics integration for each website to enable data sync.',
            'evidence' => ['unconnected_websites' => 2],
        ]));

        // High-severity pending for dramatic demo
        SeoInsight::factory()->create(array_merge($base, [
            'website_id' => $websiteA->id,
            'generated_by' => $owner->id,
            'type' => SeoInsightType::DecliningPageClicks->value,
            'status' => SeoInsightStatus::Pending->value,
            'severity' => 'critical',
            'subject_type' => 'page',
            'subject_value' => '/home',
            'title' => 'Critical click drop on homepage',
            'summary' => 'Homepage organic clicks fell 52% in the last 14 days compared to the prior period.',
            'recommendation' => 'Audit recent title tag and meta description changes. Check Google Search Console coverage report for manual actions.',
            'evidence' => ['previous_clicks' => 850, 'current_clicks' => 408],
        ]));
    }
}
