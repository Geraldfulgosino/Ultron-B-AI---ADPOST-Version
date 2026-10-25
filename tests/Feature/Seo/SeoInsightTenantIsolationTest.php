<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SeoInsightTenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_cannot_view_another_orgs_insight(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->get(route('seo.insights.show', ['organization' => $orgA->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_admin_cannot_mark_another_orgs_insight_as_reviewed(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->post(route('seo.insights.reviewed', ['organization' => $orgA->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_admin_cannot_approve_another_orgs_insight(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->post(route('seo.insights.approved', ['organization' => $orgA->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_admin_cannot_dismiss_another_orgs_insight(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->post(route('seo.insights.dismissed', ['organization' => $orgA->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_admin_cannot_reopen_another_orgs_insight(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create([
            'organization_id' => $orgB->id,
            'status' => SeoInsightStatus::Dismissed,
        ]);

        $this->actingAs($userA)
            ->post(route('seo.insights.reopened', ['organization' => $orgA->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_bulk_action_only_affects_own_org_insights(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightA = SeoInsight::factory()->create([
            'organization_id' => $orgA->id,
            'status' => SeoInsightStatus::Pending,
        ]);
        $insightB = SeoInsight::factory()->create([
            'organization_id' => $orgB->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $this->actingAs($userA)
            ->post(route('seo.insights.bulk-reviewed', ['organization' => $orgA->slug]), [
                'ids' => [$insightA->id, $insightB->id],
            ])
            ->assertRedirect();

        $this->assertEquals(SeoInsightStatus::Reviewed, $insightA->fresh()->status);
        $this->assertEquals(SeoInsightStatus::Pending, $insightB->fresh()->status);
    }

    public function test_insight_index_only_shows_own_org_insights(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('viewer');
        [$orgB] = $this->createOrgWithOwner();
        $insightA = SeoInsight::factory()->create(['organization_id' => $orgA->id]);
        SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $response = $this->actingAs($userA)
            ->get(route('seo.insights.index', ['organization' => $orgA->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/InsightsIndex')
                ->has('insights.data', 1)
                ->where('insights.data.0.id', $insightA->id)
            );
    }
}
