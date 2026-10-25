<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Clients\Models\Website;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SeoInsightFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_filter_by_status_returns_only_matching_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        SeoInsight::factory()->create(['organization_id' => $org->id, 'status' => SeoInsightStatus::Pending]);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'status' => SeoInsightStatus::Approved]);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'status' => 'approved']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/InsightsIndex')
                ->has('insights.data', 1)
                ->where('insights.data.0.status', 'approved')
            );
    }

    public function test_filter_by_severity_returns_only_matching_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        SeoInsight::factory()->create(['organization_id' => $org->id, 'severity' => 'high']);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'severity' => 'low']);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'severity' => 'high']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('insights.data', 1)
                ->where('insights.data.0.severity', 'high')
            );
    }

    public function test_filter_by_type_returns_only_matching_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'type' => SeoInsightType::DecliningPageClicks,
        ]);
        SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'type' => SeoInsightType::RankingOpportunity,
        ]);

        $this->actingAs($user)
            ->get(route('seo.insights.index', [
                'organization' => $org->slug,
                'type' => SeoInsightType::DecliningPageClicks->value,
            ]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('insights.data', 1)
                ->where('insights.data.0.type', SeoInsightType::DecliningPageClicks->value)
            );
    }

    public function test_filter_by_website_id_returns_only_matching_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $websiteA = Website::factory()->create(['organization_id' => $org->id]);
        $websiteB = Website::factory()->create(['organization_id' => $org->id]);
        $insightA = SeoInsight::factory()->create(['organization_id' => $org->id, 'website_id' => $websiteA->id]);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'website_id' => $websiteB->id]);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'website_id' => $websiteA->id]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('insights.data', 1)
                ->where('insights.data.0.id', $insightA->id)
            );
    }

    public function test_invalid_status_filter_returns_validation_error(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'status' => 'nonexistent']))
            ->assertSessionHasErrors('status');
    }

    public function test_invalid_type_filter_returns_validation_error(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'type' => 'bogus_type']))
            ->assertSessionHasErrors('type');
    }

    public function test_website_id_from_other_org_returns_validation_error(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('viewer');
        [$orgB] = $this->createOrgWithOwner();
        $websiteB = Website::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->get(route('seo.insights.index', ['organization' => $orgA->slug, 'website_id' => $websiteB->id]))
            ->assertSessionHasErrors('website_id');
    }

    public function test_no_filters_returns_all_org_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        SeoInsight::factory()->count(3)->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->has('insights.data', 3)
            );
    }

    public function test_filters_are_passed_back_to_the_page(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'status' => 'pending']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('filters.status', 'pending')
            );
    }
}
