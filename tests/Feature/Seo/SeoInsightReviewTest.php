<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Audit\Models\AuditLog;
use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Seo\Actions\UpdateSeoInsightStatusAction;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class SeoInsightReviewTest extends TestCase
{
    use RefreshDatabase;

    // ─── UpdateSeoInsightStatusAction unit-level tests ───────────────────────

    public function test_update_status_action_transitions_insight_and_sets_reviewer_fields(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $action = app(UpdateSeoInsightStatusAction::class);
        $action->execute($insight, $user, SeoInsightStatus::Reviewed, 'Test note', Request::create('/test', 'POST'), 'insight.reviewed');

        $insight->refresh();
        $this->assertEquals(SeoInsightStatus::Reviewed, $insight->status);
        $this->assertEquals($user->id, $insight->reviewed_by);
        $this->assertNotNull($insight->reviewed_at);
        $this->assertEquals('Test note', $insight->review_notes);
        $this->assertDatabaseHas('audit_logs', [
            'event' => 'insight.reviewed',
            'auditable_id' => $insight->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_reopen_clears_reviewer_fields(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Dismissed,
            'reviewed_by' => $user->id,
            'reviewed_at' => now(),
            'review_notes' => 'Old note',
        ]);

        $action = app(UpdateSeoInsightStatusAction::class);
        $action->execute($insight, $user, SeoInsightStatus::Pending, null, Request::create('/test'), 'insight.reopened');

        $insight->refresh();
        $this->assertEquals(SeoInsightStatus::Pending, $insight->status);
        $this->assertNull($insight->reviewed_by);
        $this->assertNull($insight->reviewed_at);
        $this->assertNull($insight->review_notes);
    }

    // ─── AuditLogger smoke test ───────────────────────────────────────────────

    public function test_audit_logger_inserts_a_row(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $request = Request::create('/test', 'POST');

        AuditLogger::log(
            event: 'insight.reviewed',
            auditableType: SeoInsight::class,
            auditableId: 42,
            organizationId: $org->id,
            actor: $user,
            oldValues: ['status' => 'pending'],
            newValues: ['status' => 'reviewed', 'review_notes' => null],
            request: $request,
        );

        $this->assertDatabaseHas('audit_logs', [
            'event' => 'insight.reviewed',
            'auditable_id' => 42,
            'user_id' => $user->id,
        ]);
    }

    // ─── HTTP-layer tests ─────────────────────────────────────────────────────

    public function test_admin_can_mark_insight_as_reviewed_via_http(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id, 'status' => SeoInsightStatus::Pending]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]), [
                'review_notes' => 'Looks valid',
            ])
            ->assertRedirect()
            ->assertSessionHas('success');

        $insight->refresh();
        $this->assertEquals(SeoInsightStatus::Reviewed, $insight->status);
        $this->assertEquals($user->id, $insight->reviewed_by);
        $this->assertNotNull($insight->reviewed_at);
        $this->assertEquals('Looks valid', $insight->review_notes);
    }

    public function test_admin_can_mark_insight_as_approved(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.approved', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();

        $this->assertEquals(SeoInsightStatus::Approved, $insight->fresh()->status);
    }

    public function test_admin_can_dismiss_insight(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.dismissed', ['organization' => $org->slug, 'insight' => $insight->id]), [
                'review_notes' => 'Expected seasonal variation',
            ])
            ->assertRedirect();

        $insight->refresh();
        $this->assertEquals(SeoInsightStatus::Dismissed, $insight->status);
        $this->assertEquals('Expected seasonal variation', $insight->review_notes);
    }

    public function test_admin_can_reopen_insight_via_http(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Dismissed,
            'reviewed_by' => $user->id,
            'reviewed_at' => now(),
            'review_notes' => 'Was valid',
        ]);

        $this->actingAs($user)
            ->post(route('seo.insights.reopened', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();

        $insight->refresh();
        $this->assertEquals(SeoInsightStatus::Pending, $insight->status);
        $this->assertNull($insight->reviewed_by);
        $this->assertNull($insight->reviewed_at);
        $this->assertNull($insight->review_notes);
    }

    public function test_review_notes_are_null_when_omitted(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();

        $this->assertNull($insight->fresh()->review_notes);
    }

    public function test_review_notes_max_length_validation(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]), [
                'review_notes' => str_repeat('a', 1001),
            ])
            ->assertSessionHasErrors('review_notes');
    }

    public function test_audit_log_is_written_on_status_change(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]), [
                'review_notes' => 'Confirmed',
            ]);

        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'event' => 'insight.reviewed',
            'auditable_type' => SeoInsight::class,
            'auditable_id' => $insight->id,
        ]);
    }

    public function test_audit_log_captures_old_and_new_status(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $this->actingAs($user)
            ->post(route('seo.insights.approved', ['organization' => $org->slug, 'insight' => $insight->id]));

        $log = AuditLog::where('event', 'insight.approved')->first();
        $this->assertNotNull($log);
        $this->assertEquals(['status' => 'pending'], $log->old_values);
        $this->assertEquals('approved', $log->new_values['status']);
    }

    public function test_insight_detail_is_accessible_to_viewer(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->get(route('seo.insights.show', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/InsightShow')
                ->where('canUpdateStatus', false)
            );
    }
}
