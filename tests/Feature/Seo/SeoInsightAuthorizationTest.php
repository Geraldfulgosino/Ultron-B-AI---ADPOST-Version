<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SeoInsightAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    // ─── Index ────────────────────────────────────────────────────────────────

    public function test_viewer_can_access_insight_list(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertOk();
    }

    public function test_unauthenticated_user_cannot_access_insight_list(): void
    {
        [$org] = $this->createOrgWithOwner();

        $this->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertRedirect(route('login'));
    }

    // ─── Show ─────────────────────────────────────────────────────────────────

    public function test_viewer_can_view_insight_detail(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->get(route('seo.insights.show', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertOk();
    }

    // ─── Status update authorization ─────────────────────────────────────────

    public function test_member_cannot_mark_insight_as_reviewed(): void
    {
        [$org, $user] = $this->createOrgWithUser('member');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_viewer_cannot_mark_insight_as_reviewed(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_viewer_cannot_approve_insight(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.approved', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_viewer_cannot_dismiss_insight(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.dismissed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_viewer_cannot_reopen_insight(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Dismissed,
        ]);

        $this->actingAs($user)
            ->post(route('seo.insights.reopened', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_admin_can_mark_reviewed(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();
    }

    public function test_owner_can_mark_reviewed(): void
    {
        [$org, $user] = $this->createOrgWithOwner();
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();
    }

    // ─── Bulk action authorization ────────────────────────────────────────────

    public function test_viewer_cannot_bulk_mark_reviewed(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-reviewed', ['organization' => $org->slug]), [
                'ids' => [$insight->id],
            ])
            ->assertForbidden();
    }

    public function test_member_cannot_bulk_dismiss(): void
    {
        [$org, $user] = $this->createOrgWithUser('member');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-dismissed', ['organization' => $org->slug]), [
                'ids' => [$insight->id],
            ])
            ->assertForbidden();
    }

    public function test_admin_can_bulk_dismiss(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insights = SeoInsight::factory()->count(2)->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-dismissed', ['organization' => $org->slug]), [
                'ids' => $insights->pluck('id')->toArray(),
            ])
            ->assertRedirect();
    }
}
