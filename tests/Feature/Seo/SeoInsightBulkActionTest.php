<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Seo\Actions\BulkUpdateSeoInsightStatusAction;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class SeoInsightBulkActionTest extends TestCase
{
    use RefreshDatabase;

    public function test_bulk_action_updates_all_org_scoped_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insights = SeoInsight::factory()->count(3)->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $action = app(BulkUpdateSeoInsightStatusAction::class);
        $count = $action->execute(
            $org,
            $insights->pluck('id')->toArray(),
            $user,
            SeoInsightStatus::Reviewed,
            null,
            Request::create('/test', 'POST'),
            'insight.bulk_reviewed',
        );

        $this->assertEquals(3, $count);
        foreach ($insights as $insight) {
            $this->assertEquals(SeoInsightStatus::Reviewed, $insight->fresh()->status);
        }
    }

    public function test_bulk_action_ignores_ids_from_other_org(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create([
            'organization_id' => $orgB->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $action = app(BulkUpdateSeoInsightStatusAction::class);
        $count = $action->execute(
            $orgA,
            [$insightB->id],
            $userA,
            SeoInsightStatus::Dismissed,
            null,
            Request::create('/test', 'POST'),
            'insight.bulk_dismissed',
        );

        $this->assertEquals(0, $count);
        $this->assertEquals(SeoInsightStatus::Pending, $insightB->fresh()->status);
    }

    public function test_bulk_action_writes_one_audit_log(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insights = SeoInsight::factory()->count(2)->create(['organization_id' => $org->id]);

        $action = app(BulkUpdateSeoInsightStatusAction::class);
        $action->execute(
            $org,
            $insights->pluck('id')->toArray(),
            $user,
            SeoInsightStatus::Dismissed,
            null,
            Request::create('/test', 'POST'),
            'insight.bulk_dismissed',
        );

        $this->assertDatabaseCount('audit_logs', 1);
        $this->assertDatabaseHas('audit_logs', [
            'event' => 'insight.bulk_dismissed',
            'organization_id' => $org->id,
        ]);
    }

    public function test_admin_can_bulk_mark_reviewed_via_http(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insights = SeoInsight::factory()->count(3)->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-reviewed', ['organization' => $org->slug]), [
                'ids' => $insights->pluck('id')->toArray(),
            ])
            ->assertRedirect()
            ->assertSessionHas('success');

        foreach ($insights as $insight) {
            $this->assertEquals(SeoInsightStatus::Reviewed, $insight->fresh()->status);
        }
    }

    public function test_admin_can_bulk_dismiss_via_http(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insights = SeoInsight::factory()->count(2)->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-dismissed', ['organization' => $org->slug]), [
                'ids' => $insights->pluck('id')->toArray(),
            ])
            ->assertRedirect();

        foreach ($insights as $insight) {
            $this->assertEquals(SeoInsightStatus::Dismissed, $insight->fresh()->status);
        }
    }

    public function test_bulk_action_requires_at_least_one_id(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-reviewed', ['organization' => $org->slug]), [
                'ids' => [],
            ])
            ->assertSessionHasErrors('ids');
    }

    public function test_bulk_reviewed_writes_audit_log_via_http(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-reviewed', ['organization' => $org->slug]), [
                'ids' => [$insight->id],
            ]);

        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'event' => 'insight.bulk_reviewed',
        ]);
    }

    public function test_bulk_dismissed_writes_audit_log_via_http(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-dismissed', ['organization' => $org->slug]), [
                'ids' => [$insight->id],
            ]);

        $this->assertDatabaseHas('audit_logs', ['event' => 'insight.bulk_dismissed']);
    }
}
