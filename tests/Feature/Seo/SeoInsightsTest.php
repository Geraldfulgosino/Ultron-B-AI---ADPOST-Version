<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Analytics\Models\AnalyticsSearchPage;
use App\Domains\Analytics\Models\AnalyticsSearchQuery;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SeoInsightsTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_generate_seo_insights_from_local_analytics_data(): void
    {
        Http::fake();

        [$organization, $user] = $this->createOrgWithUser('admin');
        $website = $this->createWebsite($organization->id, $user->id);

        $this->seedInsightSignals($organization->id, $website->id);

        $this->actingAs($user)
            ->post(route('seo.insights.generate', ['organization' => $organization->slug]))
            ->assertRedirect()
            ->assertSessionHas('success');

        foreach (SeoInsightType::cases() as $type) {
            $this->assertDatabaseHas('seo_insights', [
                'organization_id' => $organization->id,
                'type' => $type->value,
                'status' => SeoInsightStatus::Pending->value,
            ]);
        }

        Http::assertNothingSent();
    }

    public function test_viewer_cannot_generate_seo_insights(): void
    {
        [$organization, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->post(route('seo.insights.generate', ['organization' => $organization->slug]))
            ->assertForbidden();

        $this->assertDatabaseCount('seo_insights', 0);
    }

    public function test_seo_insights_are_tenant_isolated_on_generation_and_dashboard(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        [$otherOrganization, $otherUser] = $this->createOrgWithOwner();
        $website = $this->createWebsite($organization->id, $user->id);
        $otherWebsite = $this->createWebsite($otherOrganization->id, $otherUser->id);

        $this->seedInsightSignals($organization->id, $website->id);
        $this->seedInsightSignals($otherOrganization->id, $otherWebsite->id);
        SeoInsight::factory()->create([
            'organization_id' => $otherOrganization->id,
            'website_id' => $otherWebsite->id,
            'title' => 'Other tenant insight',
        ]);

        $this->actingAs($user)
            ->post(route('seo.insights.generate', ['organization' => $organization->slug]))
            ->assertRedirect();

        $this->assertDatabaseHas('seo_insights', [
            'organization_id' => $organization->id,
            'subject_value' => '/declining-page',
        ]);
        $this->assertDatabaseMissing('seo_insights', [
            'organization_id' => $organization->id,
            'title' => 'Other tenant insight',
        ]);

        $this->actingAs($user)
            ->get(route('seo.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/Index')
                ->where('canGenerateInsights', true)
                ->where('insights.0.title', fn (string $title) => $title !== 'Other tenant insight'));
    }

    private function createWebsite(int $organizationId, int $userId): Website
    {
        $client = Client::factory()->create([
            'organization_id' => $organizationId,
            'created_by' => $userId,
        ]);

        return Website::factory()->create([
            'organization_id' => $organizationId,
            'client_id' => $client->id,
            'created_by' => $userId,
        ]);
    }

    private function seedInsightSignals(int $organizationId, int $websiteId): void
    {
        AnalyticsSearchPage::create([
            'organization_id' => $organizationId,
            'website_id' => $websiteId,
            'metric_date' => '2026-06-03',
            'page_url' => '/declining-page',
            'page_url_hash' => hash('sha256', '/declining-page'),
            'clicks' => 30,
            'impressions' => 100,
        ]);
        AnalyticsSearchPage::create([
            'organization_id' => $organizationId,
            'website_id' => $websiteId,
            'metric_date' => '2026-06-10',
            'page_url' => '/declining-page',
            'page_url_hash' => hash('sha256', '/declining-page'),
            'clicks' => 6,
            'impressions' => 90,
        ]);
        AnalyticsSearchPage::create([
            'organization_id' => $organizationId,
            'website_id' => $websiteId,
            'metric_date' => '2026-06-03',
            'page_url' => '/improving-page',
            'page_url_hash' => hash('sha256', '/improving-page'),
            'clicks' => 4,
            'impressions' => 40,
        ]);
        AnalyticsSearchPage::create([
            'organization_id' => $organizationId,
            'website_id' => $websiteId,
            'metric_date' => '2026-06-10',
            'page_url' => '/improving-page',
            'page_url_hash' => hash('sha256', '/improving-page'),
            'clicks' => 8,
            'impressions' => 130,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organizationId,
            'website_id' => $websiteId,
            'metric_date' => '2026-06-10',
            'query' => 'high impression low ctr',
            'query_hash' => hash('sha256', 'high impression low ctr'),
            'clicks' => 1,
            'impressions' => 200,
            'ctr' => 0.005,
            'average_position' => 3,
        ]);
        AnalyticsSearchQuery::create([
            'organization_id' => $organizationId,
            'website_id' => $websiteId,
            'metric_date' => '2026-06-10',
            'query' => 'ranking opportunity keyword',
            'query_hash' => hash('sha256', 'ranking opportunity keyword'),
            'clicks' => 5,
            'impressions' => 180,
            'ctr' => 0.0278,
            'average_position' => 8,
        ]);
    }
}
