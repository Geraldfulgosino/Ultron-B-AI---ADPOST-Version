# Sprint 6 — SEO Insights Review & Action Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full SEO insight review and action-management workflow: detail view, status transitions (reviewed/approved/dismissed/reopened), optional review notes, bulk actions, audit logging, filters, and comprehensive tests.

**Architecture:** Single `SeoInsightController` extended with per-transition named routes. A shared `UpdateSeoInsightStatusAction` handles single-insight transitions + audit logging. `BulkUpdateSeoInsightStatusAction` handles batch updates with one bulk audit event. `AuditLogger` service writes to the existing `audit_logs` table synchronously. Two new Inertia pages: `seo/InsightsIndex` (list + filters + bulk) and `seo/InsightShow` (detail + inline status forms).

**Tech Stack:** PHP 8.4 / Laravel 13, Inertia.js v2, React 19, TypeScript, Tailwind CSS v4, MySQL 8.4. Docker Compose for running commands.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `database/migrations/2026_06_11_000013_add_review_notes_to_seo_insights_table.php` | Add nullable `review_notes TEXT` column |
| `app/Domains/Audit/Models/AuditLog.php` | Eloquent model for `audit_logs` table |
| `app/Domains/Audit/Services/AuditLogger.php` | Static service: inserts audit log rows synchronously |
| `app/Domains/Seo/Actions/UpdateSeoInsightStatusAction.php` | Single-insight status transition + audit log |
| `app/Domains/Seo/Actions/BulkUpdateSeoInsightStatusAction.php` | Batch status update + single bulk audit event |
| `app/Domains/Seo/Actions/GetSeoInsightListAction.php` | Filtered, paginated insight query with `through()` transform |
| `app/Domains/Seo/Actions/GetSeoInsightDetailAction.php` | Single insight with relations, mapped to typed array |
| `app/Http/Requests/Seo/SeoInsightIndexRequest.php` | Auth + filter validation (type/status/website/severity/dates) |
| `app/Http/Requests/Seo/UpdateSeoInsightStatusRequest.php` | Auth via `updateStatus` policy + `review_notes` max:1000 |
| `app/Http/Requests/Seo/BulkUpdateSeoInsightStatusRequest.php` | Auth via `memberCan('approval.decide')` + ids array validation |
| `resources/js/pages/seo/InsightsIndex.tsx` | List page: filter bar, paginated table, bulk checkboxes |
| `resources/js/pages/seo/InsightShow.tsx` | Detail page: full insight + inline status-action forms |
| `tests/Feature/Seo/SeoInsightReviewTest.php` | Happy-path transitions, notes persistence, audit log |
| `tests/Feature/Seo/SeoInsightBulkActionTest.php` | Bulk reviewed/dismissed, cross-org safety, audit log |
| `tests/Feature/Seo/SeoInsightAuthorizationTest.php` | Role-based access: viewer/member denied, admin/owner allowed |
| `tests/Feature/Seo/SeoInsightTenantIsolationTest.php` | Cross-org access denied at URL and direct API level |
| `tests/Feature/Seo/SeoInsightFilterTest.php` | Each filter returns correct subset; cross-org website_id rejected |

### Modified files
| File | Change |
|------|--------|
| `app/Domains/Seo/Models/SeoInsight.php` | Add `review_notes` to `$fillable` |
| `app/Domains/Seo/Policies/SeoInsightPolicy.php` | Add `viewList` method for index authorization |
| `app/Http/Controllers/SeoInsightController.php` | Add `index`, `show`, `markReviewed`, `markApproved`, `markDismissed`, `reopen`, `bulkReviewed`, `bulkDismissed` |
| `routes/web.php` | Register 8 new insight routes (bulk before `{insight}` wildcard) |
| `resources/js/pages/seo/Index.tsx` | Add "View detail →" link on each insight card |
| `docs/sprint-status.md` | Add Sprint 6 completion entry |

---

## Task 1: Migration + Model Update

**Files:**
- Create: `database/migrations/2026_06_11_000013_add_review_notes_to_seo_insights_table.php`
- Modify: `app/Domains/Seo/Models/SeoInsight.php`

- [ ] **Step 1: Create the migration**

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seo_insights', function (Blueprint $table) {
            $table->text('review_notes')->nullable()->after('reviewed_at');
        });
    }

    public function down(): void
    {
        Schema::table('seo_insights', function (Blueprint $table) {
            $table->dropColumn('review_notes');
        });
    }
};
```

- [ ] **Step 2: Add `review_notes` to `SeoInsight::$fillable`**

In `app/Domains/Seo/Models/SeoInsight.php`, add `'review_notes'` to the `$fillable` array after `'reviewed_at'`. No cast needed (plain nullable string).

- [ ] **Step 3: Run the migration**

```bash
docker compose exec ultron-app php artisan migrate
```

Expected: `Migrating: 2026_06_11_000013_add_review_notes_to_seo_insights_table` followed by `Migrated`.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026_06_11_000013_add_review_notes_to_seo_insights_table.php \
        app/Domains/Seo/Models/SeoInsight.php
git commit -m "Add review_notes column to seo_insights table"
```

---

## Task 2: AuditLog Model + AuditLogger Service

**Files:**
- Create: `app/Domains/Audit/Models/AuditLog.php`
- Create: `app/Domains/Audit/Services/AuditLogger.php`

The `audit_logs` table already exists (Sprint 1 migration). This task gives it an Eloquent model and a static logger service.

- [ ] **Step 1: Write a failing test for the AuditLogger**

Create `tests/Feature/Seo/SeoInsightReviewTest.php` with just this one test to start — add more tests in Task 8:

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Audit\Models\AuditLog;
use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Identity\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class SeoInsightReviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_audit_logger_inserts_a_row(): void
    {
        $user = User::factory()->create();
        $request = Request::create('/test', 'POST');

        AuditLogger::log(
            event: 'insight.reviewed',
            auditableType: 'App\Domains\Seo\Models\SeoInsight',
            auditableId: 42,
            organizationId: 1,
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
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
docker compose exec ultron-app php artisan test --filter=test_audit_logger_inserts_a_row
```

Expected: FAIL with class not found error.

- [ ] **Step 3: Create the `AuditLog` model**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Audit\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'audit_logs';

    protected $fillable = [
        'organization_id',
        'user_id',
        'event',
        'auditable_type',
        'auditable_id',
        'old_values',
        'new_values',
        'ip_address',
        'user_agent',
        'url',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'old_values' => 'array',
            'new_values' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
```

- [ ] **Step 4: Create the `AuditLogger` service**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Audit\Services;

use App\Domains\Audit\Models\AuditLog;
use App\Domains\Identity\Models\User;
use Illuminate\Http\Request;

class AuditLogger
{
    public static function log(
        string $event,
        string $auditableType,
        ?int $auditableId,
        int $organizationId,
        User $actor,
        array $oldValues,
        array $newValues,
        Request $request,
    ): void {
        AuditLog::create([
            'organization_id' => $organizationId,
            'user_id' => $actor->id,
            'event' => $event,
            'auditable_type' => $auditableType,
            'auditable_id' => $auditableId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'url' => $request->fullUrl(),
            'created_at' => now(),
        ]);
    }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
docker compose exec ultron-app php artisan test --filter=test_audit_logger_inserts_a_row
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/Domains/Audit/Models/AuditLog.php \
        app/Domains/Audit/Services/AuditLogger.php \
        tests/Feature/Seo/SeoInsightReviewTest.php
git commit -m "Add AuditLog model and AuditLogger service"
```

---

## Task 3: UpdateSeoInsightStatusAction

**Files:**
- Create: `app/Domains/Seo/Actions/UpdateSeoInsightStatusAction.php`

- [ ] **Step 1: Add a failing test to `SeoInsightReviewTest`**

Append this test to `tests/Feature/Seo/SeoInsightReviewTest.php` (keep the existing test, add this one):

```php
public function test_update_status_action_transitions_insight_and_sets_reviewer_fields(): void
{
    [$org, $user] = $this->createOrgWithUser('admin');
    $insight = \App\Domains\Seo\Models\SeoInsight::factory()->create([
        'organization_id' => $org->id,
        'status' => \App\Domains\Seo\Enums\SeoInsightStatus::Pending,
    ]);

    $action = app(\App\Domains\Seo\Actions\UpdateSeoInsightStatusAction::class);
    $request = \Illuminate\Http\Request::create('/test', 'POST');

    $action->execute(
        $insight,
        $user,
        \App\Domains\Seo\Enums\SeoInsightStatus::Reviewed,
        'Test note',
        $request,
        'insight.reviewed',
    );

    $insight->refresh();
    $this->assertEquals(\App\Domains\Seo\Enums\SeoInsightStatus::Reviewed, $insight->status);
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
    $insight = \App\Domains\Seo\Models\SeoInsight::factory()->create([
        'organization_id' => $org->id,
        'status' => \App\Domains\Seo\Enums\SeoInsightStatus::Dismissed,
        'reviewed_by' => $user->id,
        'reviewed_at' => now(),
        'review_notes' => 'Old note',
    ]);

    $action = app(\App\Domains\Seo\Actions\UpdateSeoInsightStatusAction::class);
    $action->execute($insight, $user, \App\Domains\Seo\Enums\SeoInsightStatus::Pending, null, \Illuminate\Http\Request::create('/test'), 'insight.reopened');

    $insight->refresh();
    $this->assertEquals(\App\Domains\Seo\Enums\SeoInsightStatus::Pending, $insight->status);
    $this->assertNull($insight->reviewed_by);
    $this->assertNull($insight->reviewed_at);
    $this->assertNull($insight->review_notes);
}
```

- [ ] **Step 2: Run to confirm fail**

```bash
docker compose exec ultron-app php artisan test --filter=test_update_status_action_transitions
```

Expected: FAIL with class not found.

- [ ] **Step 3: Create `UpdateSeoInsightStatusAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Identity\Models\User;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Http\Request;

class UpdateSeoInsightStatusAction
{
    public function execute(
        SeoInsight $insight,
        User $actor,
        SeoInsightStatus $newStatus,
        ?string $reviewNotes,
        Request $request,
        string $auditEvent,
    ): SeoInsight {
        $oldStatus = $insight->status;

        $insight->status = $newStatus;

        if ($newStatus === SeoInsightStatus::Pending) {
            $insight->reviewed_by = null;
            $insight->reviewed_at = null;
            $insight->review_notes = null;
        } else {
            $insight->reviewed_by = $actor->id;
            $insight->reviewed_at = now();
            $insight->review_notes = $reviewNotes;
        }

        $insight->save();

        AuditLogger::log(
            event: $auditEvent,
            auditableType: SeoInsight::class,
            auditableId: $insight->id,
            organizationId: $insight->organization_id,
            actor: $actor,
            oldValues: ['status' => $oldStatus->value],
            newValues: ['status' => $newStatus->value, 'review_notes' => $reviewNotes],
            request: $request,
        );

        return $insight->refresh();
    }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightReviewTest
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/Domains/Seo/Actions/UpdateSeoInsightStatusAction.php \
        tests/Feature/Seo/SeoInsightReviewTest.php
git commit -m "Add UpdateSeoInsightStatusAction with audit logging"
```

---

## Task 4: BulkUpdateSeoInsightStatusAction

**Files:**
- Create: `app/Domains/Seo/Actions/BulkUpdateSeoInsightStatusAction.php`
- Create: `tests/Feature/Seo/SeoInsightBulkActionTest.php`

- [ ] **Step 1: Write failing tests**

Create `tests/Feature/Seo/SeoInsightBulkActionTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Organizations\Models\Organization;
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
}
```

- [ ] **Step 2: Run to confirm fail**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightBulkActionTest
```

Expected: FAIL with class not found.

- [ ] **Step 3: Create `BulkUpdateSeoInsightStatusAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Http\Request;

class BulkUpdateSeoInsightStatusAction
{
    public function execute(
        Organization $org,
        array $ids,
        User $actor,
        SeoInsightStatus $newStatus,
        ?string $reviewNotes,
        Request $request,
        string $auditEvent,
    ): int {
        $fields = $newStatus === SeoInsightStatus::Pending
            ? [
                'status' => $newStatus->value,
                'reviewed_by' => null,
                'reviewed_at' => null,
                'review_notes' => null,
            ]
            : [
                'status' => $newStatus->value,
                'reviewed_by' => $actor->id,
                'reviewed_at' => now(),
                'review_notes' => $reviewNotes,
            ];

        $count = SeoInsight::query()
            ->where('organization_id', $org->id)
            ->whereIn('id', $ids)
            ->update($fields);

        AuditLogger::log(
            event: $auditEvent,
            auditableType: SeoInsight::class,
            auditableId: null,
            organizationId: $org->id,
            actor: $actor,
            oldValues: [],
            newValues: ['count' => $count, 'ids' => $ids, 'status' => $newStatus->value],
            request: $request,
        );

        return $count;
    }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightBulkActionTest
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/Domains/Seo/Actions/BulkUpdateSeoInsightStatusAction.php \
        tests/Feature/Seo/SeoInsightBulkActionTest.php
git commit -m "Add BulkUpdateSeoInsightStatusAction with org-scoped safety"
```

---

## Task 5: GetSeoInsightListAction + GetSeoInsightDetailAction

**Files:**
- Create: `app/Domains/Seo/Actions/GetSeoInsightListAction.php`
- Create: `app/Domains/Seo/Actions/GetSeoInsightDetailAction.php`

These are read-only, tested via the controller HTTP tests in Task 11. Create them now.

- [ ] **Step 1: Create `GetSeoInsightListAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Pagination\LengthAwarePaginator;

class GetSeoInsightListAction
{
    public function execute(Organization $organization, array $filters): LengthAwarePaginator
    {
        $query = SeoInsight::query()
            ->where('organization_id', $organization->id)
            ->with(['website', 'reviewedBy'])
            ->latest();

        if (!empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }
        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (!empty($filters['website_id'])) {
            $query->where('website_id', (int) $filters['website_id']);
        }
        if (!empty($filters['severity'])) {
            $query->where('severity', $filters['severity']);
        }
        if (!empty($filters['date_from'])) {
            $query->where('date_from', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->where('date_to', '<=', $filters['date_to']);
        }

        return $query->paginate(20)->through(fn (SeoInsight $insight) => [
            'id' => $insight->id,
            'type' => $insight->type->value,
            'type_label' => $insight->type->label(),
            'status' => $insight->status->value,
            'status_label' => $insight->status->label(),
            'severity' => $insight->severity,
            'title' => $insight->title,
            'website_name' => $insight->website?->name,
            'reviewed_by_name' => $insight->reviewedBy?->name,
            'created_at' => $insight->created_at?->toDateTimeString(),
        ])->withQueryString();
    }
}
```

- [ ] **Step 2: Create `GetSeoInsightDetailAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Seo\Models\SeoInsight;

class GetSeoInsightDetailAction
{
    /** @return array<string, mixed> */
    public function execute(SeoInsight $insight): array
    {
        $insight->load(['website', 'generatedBy', 'reviewedBy']);

        return [
            'id' => $insight->id,
            'type' => $insight->type->value,
            'type_label' => $insight->type->label(),
            'status' => $insight->status->value,
            'status_label' => $insight->status->label(),
            'severity' => $insight->severity,
            'title' => $insight->title,
            'summary' => $insight->summary,
            'recommendation' => $insight->recommendation,
            'evidence' => $insight->evidence,
            'subject_type' => $insight->subject_type,
            'subject_value' => $insight->subject_value,
            'website_name' => $insight->website?->name,
            'generated_by_name' => $insight->generatedBy?->name,
            'reviewed_by_name' => $insight->reviewedBy?->name,
            'review_notes' => $insight->review_notes,
            'date_from' => $insight->date_from?->toDateString(),
            'date_to' => $insight->date_to?->toDateString(),
            'created_at' => $insight->created_at?->toDateTimeString(),
            'reviewed_at' => $insight->reviewed_at?->toDateTimeString(),
        ];
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/Domains/Seo/Actions/GetSeoInsightListAction.php \
        app/Domains/Seo/Actions/GetSeoInsightDetailAction.php
git commit -m "Add GetSeoInsightListAction and GetSeoInsightDetailAction"
```

---

## Task 6: Form Requests

**Files:**
- Create: `app/Http/Requests/Seo/SeoInsightIndexRequest.php`
- Create: `app/Http/Requests/Seo/UpdateSeoInsightStatusRequest.php`
- Create: `app/Http/Requests/Seo/BulkUpdateSeoInsightStatusRequest.php`
- Modify: `app/Domains/Seo/Policies/SeoInsightPolicy.php`

- [ ] **Step 1: Add `viewList` to `SeoInsightPolicy`**

Add this method to `app/Domains/Seo/Policies/SeoInsightPolicy.php` after the `view` method:

```php
public function viewList(User $user, int $organizationId): bool
{
    return $this->memberCan($user, $organizationId, 'report.view');
}
```

- [ ] **Step 2: Create `SeoInsightIndexRequest`**

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SeoInsightIndexRequest extends FormRequest
{
    public function authorize(): bool
    {
        return app(OrganizationContextService::class)->memberCan('report.view');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $organization = app(OrganizationContextService::class)->current();
        $typeValues = array_column(SeoInsightType::cases(), 'value');
        $statusValues = array_column(SeoInsightStatus::cases(), 'value');

        return [
            'type' => ['nullable', 'string', Rule::in($typeValues)],
            'status' => ['nullable', 'string', Rule::in($statusValues)],
            'website_id' => [
                'nullable',
                'integer',
                Rule::exists('websites', 'id')->where('organization_id', $organization?->id),
            ],
            'severity' => ['nullable', 'string', Rule::in(['low', 'medium', 'high'])],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],
        ];
    }

    /** @return array<string, mixed> */
    public function filters(): array
    {
        $validated = $this->validated();

        return array_filter([
            'type' => $validated['type'] ?? null,
            'status' => $validated['status'] ?? null,
            'website_id' => isset($validated['website_id']) ? (int) $validated['website_id'] : null,
            'severity' => $validated['severity'] ?? null,
            'date_from' => $validated['date_from'] ?? null,
            'date_to' => $validated['date_to'] ?? null,
        ], fn ($v) => $v !== null);
    }
}
```

- [ ] **Step 3: Create `UpdateSeoInsightStatusRequest`**

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSeoInsightStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        $insight = $this->route('insight');

        return $insight !== null && $this->user()?->can('updateStatus', $insight);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'review_notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
```

- [ ] **Step 4: Create `BulkUpdateSeoInsightStatusRequest`**

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;

class BulkUpdateSeoInsightStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return app(OrganizationContextService::class)->memberCan('approval.decide');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:50'],
            'ids.*' => ['integer', 'min:1'],
            'review_notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add app/Http/Requests/Seo/SeoInsightIndexRequest.php \
        app/Http/Requests/Seo/UpdateSeoInsightStatusRequest.php \
        app/Http/Requests/Seo/BulkUpdateSeoInsightStatusRequest.php \
        app/Domains/Seo/Policies/SeoInsightPolicy.php
git commit -m "Add SEO insight form requests and viewList policy method"
```

---

## Task 7: Controller Methods + Routes

**Files:**
- Modify: `app/Http/Controllers/SeoInsightController.php`
- Modify: `routes/web.php`

- [ ] **Step 1: Replace `SeoInsightController` with the full implementation**

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Clients\Models\Website;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Actions\BulkUpdateSeoInsightStatusAction;
use App\Domains\Seo\Actions\GenerateSeoInsightsAction;
use App\Domains\Seo\Actions\GetSeoInsightDetailAction;
use App\Domains\Seo\Actions\GetSeoInsightListAction;
use App\Domains\Seo\Actions\UpdateSeoInsightStatusAction;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use App\Http\Requests\Seo\BulkUpdateSeoInsightStatusRequest;
use App\Http\Requests\Seo\GenerateSeoInsightsRequest;
use App\Http\Requests\Seo\SeoInsightIndexRequest;
use App\Http\Requests\Seo\UpdateSeoInsightStatusRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class SeoInsightController extends Controller
{
    public function index(
        SeoInsightIndexRequest $request,
        OrganizationContextService $context,
        GetSeoInsightListAction $action,
    ): Response {
        $organization = $context->current();

        return Inertia::render('seo/InsightsIndex', [
            'insights' => $action->execute($organization, $request->filters()),
            'filters' => $request->filters(),
            'websites' => Website::where('organization_id', $organization->id)
                ->select('id', 'name', 'domain')
                ->orderBy('name')
                ->get(),
            'canUpdateStatus' => $context->memberCan('approval.decide'),
        ]);
    }

    public function show(
        SeoInsight $insight,
        OrganizationContextService $context,
        GetSeoInsightDetailAction $action,
    ): Response {
        $this->authorize('view', $insight);

        return Inertia::render('seo/InsightShow', [
            'insight' => $action->execute($insight),
            'canUpdateStatus' => $context->memberCan('approval.decide'),
        ]);
    }

    public function generate(
        GenerateSeoInsightsRequest $request,
        OrganizationContextService $context,
        GenerateSeoInsightsAction $action,
    ): RedirectResponse {
        $count = $action->execute($context->current(), $request->user());

        return back()->with('success', "{$count} SEO insights generated from local analytics data.");
    }

    public function markReviewed(
        UpdateSeoInsightStatusRequest $request,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Reviewed, $request->input('review_notes'), $request, 'insight.reviewed');

        return back()->with('success', 'Insight marked as reviewed.');
    }

    public function markApproved(
        UpdateSeoInsightStatusRequest $request,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Approved, $request->input('review_notes'), $request, 'insight.approved');

        return back()->with('success', 'Insight approved.');
    }

    public function markDismissed(
        UpdateSeoInsightStatusRequest $request,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Dismissed, $request->input('review_notes'), $request, 'insight.dismissed');

        return back()->with('success', 'Insight dismissed.');
    }

    public function reopen(
        UpdateSeoInsightStatusRequest $request,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Pending, null, $request, 'insight.reopened');

        return back()->with('success', 'Insight reopened.');
    }

    public function bulkReviewed(
        BulkUpdateSeoInsightStatusRequest $request,
        OrganizationContextService $context,
        BulkUpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $count = $action->execute(
            $context->current(),
            $request->input('ids'),
            $request->user(),
            SeoInsightStatus::Reviewed,
            $request->input('review_notes'),
            $request,
            'insight.bulk_reviewed',
        );

        return back()->with('success', "{$count} insights marked as reviewed.");
    }

    public function bulkDismissed(
        BulkUpdateSeoInsightStatusRequest $request,
        OrganizationContextService $context,
        BulkUpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $count = $action->execute(
            $context->current(),
            $request->input('ids'),
            $request->user(),
            SeoInsightStatus::Dismissed,
            null,
            $request,
            'insight.bulk_dismissed',
        );

        return back()->with('success', "{$count} insights dismissed.");
    }
}
```

- [ ] **Step 2: Add the 8 new routes to `routes/web.php`**

Inside the `/{organization}` prefix group (after the existing `seo.insights.generate` route), add:

```php
// SEO insight list and detail
Route::get('/seo/insights', [SeoInsightController::class, 'index'])->name('seo.insights.index');
// Bulk routes BEFORE {insight} wildcard to prevent literal string collision
Route::post('/seo/insights/bulk-reviewed', [SeoInsightController::class, 'bulkReviewed'])->name('seo.insights.bulk-reviewed');
Route::post('/seo/insights/bulk-dismissed', [SeoInsightController::class, 'bulkDismissed'])->name('seo.insights.bulk-dismissed');
// Individual insight routes
Route::get('/seo/insights/{insight}', [SeoInsightController::class, 'show'])->name('seo.insights.show');
Route::post('/seo/insights/{insight}/reviewed', [SeoInsightController::class, 'markReviewed'])->name('seo.insights.reviewed');
Route::post('/seo/insights/{insight}/approved', [SeoInsightController::class, 'markApproved'])->name('seo.insights.approved');
Route::post('/seo/insights/{insight}/dismissed', [SeoInsightController::class, 'markDismissed'])->name('seo.insights.dismissed');
Route::post('/seo/insights/{insight}/reopened', [SeoInsightController::class, 'reopen'])->name('seo.insights.reopened');
```

- [ ] **Step 3: Run the full test suite to ensure nothing is broken**

```bash
docker compose exec ultron-app php artisan test
```

Expected: all existing tests still pass (58+). New routes are wired but Inertia pages don't exist yet — only existing tests run.

- [ ] **Step 4: Commit**

```bash
git add app/Http/Controllers/SeoInsightController.php routes/web.php
git commit -m "Extend SeoInsightController with status actions and register routes"
```

---

## Task 8: Full SeoInsightReviewTest

**Files:**
- Modify: `tests/Feature/Seo/SeoInsightReviewTest.php`

Replace the file with the complete happy-path + audit test suite.

- [ ] **Step 1: Write the complete test file**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Audit\Models\AuditLog;
use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Identity\Models\User;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class SeoInsightReviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_audit_logger_inserts_a_row(): void
    {
        $user = User::factory()->create();
        $request = Request::create('/test', 'POST');

        AuditLogger::log(
            event: 'insight.reviewed',
            auditableType: SeoInsight::class,
            auditableId: 42,
            organizationId: 1,
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

    public function test_update_status_action_transitions_insight_and_sets_reviewer_fields(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $action = app(\App\Domains\Seo\Actions\UpdateSeoInsightStatusAction::class);

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

        $action = app(\App\Domains\Seo\Actions\UpdateSeoInsightStatusAction::class);
        $action->execute($insight, $user, SeoInsightStatus::Pending, null, Request::create('/test'), 'insight.reopened');

        $insight->refresh();
        $this->assertEquals(SeoInsightStatus::Pending, $insight->status);
        $this->assertNull($insight->reviewed_by);
        $this->assertNull($insight->reviewed_at);
        $this->assertNull($insight->review_notes);
    }

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
```

- [ ] **Step 2: Run the tests**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightReviewTest
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/Feature/Seo/SeoInsightReviewTest.php
git commit -m "Add full SeoInsightReviewTest with audit log assertions"
```

---

## Task 9: Full SeoInsightBulkActionTest (HTTP layer)

**Files:**
- Modify: `tests/Feature/Seo/SeoInsightBulkActionTest.php`

Replace the file with the complete HTTP-level bulk tests.

- [ ] **Step 1: Write the complete test file**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Organizations\Models\Organization;
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
        $count = $action->execute($orgA, [$insightB->id], $userA, SeoInsightStatus::Dismissed, null, Request::create('/test', 'POST'), 'insight.bulk_dismissed');

        $this->assertEquals(0, $count);
        $this->assertEquals(SeoInsightStatus::Pending, $insightB->fresh()->status);
    }

    public function test_bulk_action_writes_one_audit_log(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insights = SeoInsight::factory()->count(2)->create(['organization_id' => $org->id]);

        $action = app(BulkUpdateSeoInsightStatusAction::class);
        $action->execute($org, $insights->pluck('id')->toArray(), $user, SeoInsightStatus::Dismissed, null, Request::create('/test', 'POST'), 'insight.bulk_dismissed');

        $this->assertDatabaseCount('audit_logs', 1);
        $this->assertDatabaseHas('audit_logs', ['event' => 'insight.bulk_dismissed']);
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
```

- [ ] **Step 2: Run**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightBulkActionTest
```

Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/Feature/Seo/SeoInsightBulkActionTest.php
git commit -m "Add SeoInsightBulkActionTest with HTTP and action-level assertions"
```

---

## Task 10: Authorization + Tenant Isolation Tests

**Files:**
- Create: `tests/Feature/Seo/SeoInsightAuthorizationTest.php`
- Create: `tests/Feature/Seo/SeoInsightTenantIsolationTest.php`

- [ ] **Step 1: Create `SeoInsightAuthorizationTest`**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SeoInsightAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_viewer_cannot_update_insight_status(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_member_cannot_update_insight_status(): void
    {
        [$org, $user] = $this->createOrgWithUser('member');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertForbidden();
    }

    public function test_admin_can_update_insight_status(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();
    }

    public function test_owner_can_update_insight_status(): void
    {
        [$org, $user] = $this->createOrgWithOwner();
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.approved', ['organization' => $org->slug, 'insight' => $insight->id]))
            ->assertRedirect();
    }

    public function test_viewer_cannot_bulk_update(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-reviewed', ['organization' => $org->slug]), [
                'ids' => [$insight->id],
            ])
            ->assertForbidden();
    }

    public function test_member_cannot_bulk_update(): void
    {
        [$org, $user] = $this->createOrgWithUser('member');
        $insight = SeoInsight::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->post(route('seo.insights.bulk-dismissed', ['organization' => $org->slug]), [
                'ids' => [$insight->id],
            ])
            ->assertForbidden();
    }

    public function test_viewer_can_view_insight_list(): void
    {
        [$org, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/InsightsIndex')
                ->where('canUpdateStatus', false)
            );
    }

    public function test_viewer_can_view_insight_detail(): void
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

    public function test_unauthenticated_user_is_redirected_from_index(): void
    {
        [$org] = $this->createOrgWithOwner();

        $this->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertRedirect(route('login'));
    }
}
```

- [ ] **Step 2: Create `SeoInsightTenantIsolationTest`**

```php
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

    public function test_user_cannot_view_another_orgs_insight_detail(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->get(route('seo.insights.show', ['organization' => $orgB->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_user_cannot_update_another_orgs_insight_status(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create(['organization_id' => $orgB->id]);

        $this->actingAs($userA)
            ->post(route('seo.insights.reviewed', ['organization' => $orgB->slug, 'insight' => $insightB->id]))
            ->assertForbidden();
    }

    public function test_insight_list_only_shows_own_org_insights(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        SeoInsight::factory()->create(['organization_id' => $orgA->id, 'title' => 'Org A insight']);
        SeoInsight::factory()->create(['organization_id' => $orgB->id, 'title' => 'Org B insight']);

        $this->actingAs($userA)
            ->get(route('seo.insights.index', ['organization' => $orgA->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('seo/InsightsIndex')
                ->where('insights.total', 1)
                ->where('insights.data.0.title', 'Org A insight')
            );
    }

    public function test_bulk_action_ignores_cross_org_ids_via_http(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithOwner();
        $insightB = SeoInsight::factory()->create([
            'organization_id' => $orgB->id,
            'status' => SeoInsightStatus::Pending,
        ]);

        $this->actingAs($userA)
            ->post(route('seo.insights.bulk-dismissed', ['organization' => $orgA->slug]), [
                'ids' => [$insightB->id],
            ])
            ->assertRedirect();

        $this->assertEquals(SeoInsightStatus::Pending, $insightB->fresh()->status);
    }
}
```

- [ ] **Step 3: Run both test classes**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightAuthorizationTest
docker compose exec ultron-app php artisan test --filter=SeoInsightTenantIsolationTest
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/Feature/Seo/SeoInsightAuthorizationTest.php \
        tests/Feature/Seo/SeoInsightTenantIsolationTest.php
git commit -m "Add authorization and tenant isolation tests for SEO insights"
```

---

## Task 11: Filter Tests

**Files:**
- Create: `tests/Feature/Seo/SeoInsightFilterTest.php`

- [ ] **Step 1: Create the filter test file**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Seo;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SeoInsightFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_filter_by_status_returns_correct_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        SeoInsight::factory()->create(['organization_id' => $org->id, 'status' => SeoInsightStatus::Pending, 'title' => 'Pending insight']);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'status' => SeoInsightStatus::Approved, 'title' => 'Approved insight']);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'status' => 'pending']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('insights.total', 1)
                ->where('insights.data.0.title', 'Pending insight')
            );
    }

    public function test_filter_by_type_returns_correct_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'type' => SeoInsightType::RankingOpportunity,
            'title' => 'Ranking insight',
        ]);
        SeoInsight::factory()->create([
            'organization_id' => $org->id,
            'type' => SeoInsightType::MissingOrStaleSync,
            'title' => 'Sync insight',
        ]);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'type' => SeoInsightType::RankingOpportunity->value]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('insights.total', 1)
                ->where('insights.data.0.title', 'Ranking insight')
            );
    }

    public function test_filter_by_severity_returns_correct_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        SeoInsight::factory()->create(['organization_id' => $org->id, 'severity' => 'high', 'title' => 'High severity']);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'severity' => 'low', 'title' => 'Low severity']);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'severity' => 'high']))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('insights.total', 1)
                ->where('insights.data.0.title', 'High severity')
            );
    }

    public function test_filter_by_website_id_returns_correct_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $client->id, 'created_by' => $user->id]);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'website_id' => $website->id, 'title' => 'Site insight']);
        SeoInsight::factory()->create(['organization_id' => $org->id, 'website_id' => null, 'title' => 'Org-wide insight']);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug, 'website_id' => $website->id]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('insights.total', 1)
                ->where('insights.data.0.title', 'Site insight')
            );
    }

    public function test_invalid_website_id_from_other_org_is_rejected(): void
    {
        [$orgA, $userA] = $this->createOrgWithUser('admin');
        [$orgB, $userB] = $this->createOrgWithOwner();
        $clientB = Client::factory()->create(['organization_id' => $orgB->id, 'created_by' => $userB->id]);
        $websiteB = Website::factory()->create(['organization_id' => $orgB->id, 'client_id' => $clientB->id, 'created_by' => $userB->id]);

        $this->actingAs($userA)
            ->get(route('seo.insights.index', ['organization' => $orgA->slug, 'website_id' => $websiteB->id]))
            ->assertSessionHasErrors('website_id');
    }

    public function test_no_filters_returns_all_org_insights(): void
    {
        [$org, $user] = $this->createOrgWithUser('admin');
        SeoInsight::factory()->count(3)->create(['organization_id' => $org->id]);

        $this->actingAs($user)
            ->get(route('seo.insights.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('insights.total', 3));
    }
}
```

- [ ] **Step 2: Run**

```bash
docker compose exec ultron-app php artisan test --filter=SeoInsightFilterTest
```

Expected: all 6 tests pass.

- [ ] **Step 3: Run the full suite to confirm nothing broken**

```bash
docker compose exec ultron-app php artisan test
```

Expected: all tests pass (58 existing + ~30 new = ~88+).

- [ ] **Step 4: Commit**

```bash
git add tests/Feature/Seo/SeoInsightFilterTest.php
git commit -m "Add SeoInsightFilterTest covering type, status, severity, website, and cross-org rejection"
```

---

## Task 12: Frontend — InsightsIndex Page

**Files:**
- Create: `resources/js/pages/seo/InsightsIndex.tsx`

- [ ] **Step 1: Create the page**

```tsx
import React, { useState } from 'react';
import { Head, Link, useForm, usePage, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

interface InsightRow {
    id: number;
    type: string;
    type_label: string;
    status: string;
    status_label: string;
    severity: string;
    title: string;
    website_name: string | null;
    reviewed_by_name: string | null;
    created_at: string | null;
}

interface PaginationLink {
    url: string | null;
    label: string;
    active: boolean;
}

interface InsightsIndexProps {
    insights: {
        data: InsightRow[];
        links: PaginationLink[];
        total: number;
        current_page: number;
        last_page: number;
    };
    filters: {
        type?: string;
        status?: string;
        website_id?: number;
        severity?: string;
        date_from?: string;
        date_to?: string;
    };
    websites: Array<{ id: number; name: string; domain: string }>;
    canUpdateStatus: boolean;
}

interface SharedProps {
    currentOrganization: { slug: string };
    errors?: Record<string, string>;
}

const statusVariant = (status: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' => {
    if (status === 'approved') return 'green';
    if (status === 'dismissed') return 'gray';
    if (status === 'reviewed') return 'indigo';
    return 'yellow';
};

const severityVariant = (severity: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' => {
    if (severity === 'high') return 'red';
    if (severity === 'medium') return 'yellow';
    return 'blue';
};

export default function InsightsIndex({ insights, filters, websites, canUpdateStatus }: InsightsIndexProps) {
    const { currentOrganization, errors = {} } = usePage().props as unknown as SharedProps;
    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    const filterForm = useForm({
        type: filters.type ?? '',
        status: filters.status ?? '',
        website_id: filters.website_id?.toString() ?? '',
        severity: filters.severity ?? '',
        date_from: filters.date_from ?? '',
        date_to: filters.date_to ?? '',
    });

    const bulkReviewedForm = useForm({ ids: [] as number[] });
    const bulkDismissedForm = useForm({ ids: [] as number[] });

    const submitFilters = (event: React.FormEvent) => {
        event.preventDefault();
        filterForm.get(route('seo.insights.index', { organization: currentOrganization.slug }), {
            preserveScroll: true,
            preserveState: true,
        });
    };

    const toggleSelect = (id: number) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
        );
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === insights.data.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(insights.data.map((i) => i.id));
        }
    };

    const submitBulkReviewed = () => {
        bulkReviewedForm.setData('ids', selectedIds);
        bulkReviewedForm.post(route('seo.insights.bulk-reviewed', { organization: currentOrganization.slug }), {
            preserveScroll: true,
            onSuccess: () => setSelectedIds([]),
        });
    };

    const submitBulkDismissed = () => {
        bulkDismissedForm.setData('ids', selectedIds);
        bulkDismissedForm.post(route('seo.insights.bulk-dismissed', { organization: currentOrganization.slug }), {
            preserveScroll: true,
            onSuccess: () => setSelectedIds([]),
        });
    };

    return (
        <AppLayout title="SEO Insights">
            <Head title="SEO Insights" />

            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <h2 className="text-lg font-semibold text-gray-900">SEO Insights</h2>
                        <p className="mt-1 text-sm text-gray-500">Review and act on SEO insights generated from local analytics data.</p>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submitFilters} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                            <div>
                                <Label htmlFor="filter-status">Status</Label>
                                <select
                                    id="filter-status"
                                    value={filterForm.data.status}
                                    onChange={(e) => filterForm.setData('status', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="reviewed">Reviewed</option>
                                    <option value="approved">Approved</option>
                                    <option value="dismissed">Dismissed</option>
                                </select>
                            </div>
                            <div>
                                <Label htmlFor="filter-type">Type</Label>
                                <select
                                    id="filter-type"
                                    value={filterForm.data.type}
                                    onChange={(e) => filterForm.setData('type', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All types</option>
                                    <option value="declining_page_clicks">Declining clicks</option>
                                    <option value="high_impression_low_ctr_query">High impressions, low CTR</option>
                                    <option value="improving_page_impressions">Improving impressions</option>
                                    <option value="ranking_opportunity">Ranking opportunity</option>
                                    <option value="missing_or_stale_sync">Missing/stale sync</option>
                                </select>
                            </div>
                            <div>
                                <Label htmlFor="filter-severity">Priority</Label>
                                <select
                                    id="filter-severity"
                                    value={filterForm.data.severity}
                                    onChange={(e) => filterForm.setData('severity', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All priorities</option>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            <div>
                                <Label htmlFor="filter-website">Website</Label>
                                <select
                                    id="filter-website"
                                    value={filterForm.data.website_id}
                                    onChange={(e) => filterForm.setData('website_id', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All websites</option>
                                    {websites.map((w) => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                                {errors.website_id && <p className="mt-1 text-xs text-red-600">{errors.website_id}</p>}
                            </div>
                            <div>
                                <Label htmlFor="filter-date-from">From</Label>
                                <Input id="filter-date-from" type="date" value={filterForm.data.date_from} onChange={(e) => filterForm.setData('date_from', e.target.value)} />
                            </div>
                            <div>
                                <Label htmlFor="filter-date-to">To</Label>
                                <Input id="filter-date-to" type="date" value={filterForm.data.date_to} onChange={(e) => filterForm.setData('date_to', e.target.value)} />
                            </div>
                            <div className="flex items-end sm:col-span-2 lg:col-span-4 xl:col-span-6">
                                <Button type="submit" loading={filterForm.processing}>Apply filters</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                {canUpdateStatus && selectedIds.length > 0 && (
                    <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
                        <span className="text-sm font-medium text-indigo-700">{selectedIds.length} selected</span>
                        <Button
                            type="button"
                            variant="secondary"
                            loading={bulkReviewedForm.processing}
                            onClick={submitBulkReviewed}
                        >
                            Mark reviewed
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            loading={bulkDismissedForm.processing}
                            onClick={submitBulkDismissed}
                        >
                            Dismiss
                        </Button>
                    </div>
                )}

                <Card>
                    <CardContent className="p-0">
                        {insights.data.length === 0 ? (
                            <div className="p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No insights match the current filters</p>
                                <p className="mt-1 text-sm text-gray-500">Adjust the filters or generate insights from the SEO dashboard.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            {canUpdateStatus && (
                                                <th className="px-4 py-3 text-left">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.length === insights.data.length && insights.data.length > 0}
                                                        onChange={toggleSelectAll}
                                                        className="rounded border-gray-300"
                                                    />
                                                </th>
                                            )}
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Priority</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Website</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Reviewed by</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Created</th>
                                            <th className="px-4 py-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {insights.data.map((insight) => (
                                            <tr key={insight.id} className="border-t border-gray-100 hover:bg-gray-50">
                                                {canUpdateStatus && (
                                                    <td className="px-4 py-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedIds.includes(insight.id)}
                                                            onChange={() => toggleSelect(insight.id)}
                                                            className="rounded border-gray-300"
                                                        />
                                                    </td>
                                                )}
                                                <td className="max-w-[240px] truncate px-4 py-3 text-sm font-medium text-gray-900">{insight.title}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{insight.type_label}</td>
                                                <td className="px-4 py-3">
                                                    <Badge variant={statusVariant(insight.status)}>{insight.status_label}</Badge>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant={severityVariant(insight.severity)}>{insight.severity}</Badge>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{insight.website_name ?? 'Org-wide'}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{insight.reviewed_by_name ?? '—'}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{insight.created_at ?? '—'}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <Link
                                                        href={route('seo.insights.show', { organization: currentOrganization.slug, insight: insight.id })}
                                                        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                                                    >
                                                        View
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {insights.last_page > 1 && (
                    <div className="flex justify-center gap-1">
                        {insights.links.map((link, index) => (
                            <button
                                key={index}
                                disabled={!link.url}
                                onClick={() => link.url && router.visit(link.url, { preserveScroll: true })}
                                className={`rounded px-3 py-1 text-sm ${link.active ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100 disabled:opacity-40'}`}
                                dangerouslySetInnerHTML={{ __html: link.label }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add resources/js/pages/seo/InsightsIndex.tsx
git commit -m "Add SEO InsightsIndex page with filters, table, and bulk actions"
```

---

## Task 13: Frontend — InsightShow Page + Update seo/Index.tsx

**Files:**
- Create: `resources/js/pages/seo/InsightShow.tsx`
- Modify: `resources/js/pages/seo/Index.tsx`

- [ ] **Step 1: Create `InsightShow.tsx`**

```tsx
import React, { useState } from 'react';
import { Head, Link, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';

interface InsightDetail {
    id: number;
    type: string;
    type_label: string;
    status: string;
    status_label: string;
    severity: string;
    title: string;
    summary: string;
    recommendation: string | null;
    evidence: Record<string, unknown> | null;
    subject_type: string | null;
    subject_value: string | null;
    website_name: string | null;
    generated_by_name: string | null;
    reviewed_by_name: string | null;
    review_notes: string | null;
    date_from: string | null;
    date_to: string | null;
    created_at: string | null;
    reviewed_at: string | null;
}

interface InsightShowProps {
    insight: InsightDetail;
    canUpdateStatus: boolean;
}

interface SharedProps {
    currentOrganization: { slug: string };
    flash?: { success?: string };
}

type ActionKey = 'reviewed' | 'approved' | 'dismissed' | 'reopened' | null;

const statusVariant = (status: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' => {
    if (status === 'approved') return 'green';
    if (status === 'dismissed') return 'gray';
    if (status === 'reviewed') return 'indigo';
    return 'yellow';
};

const severityVariant = (severity: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' => {
    if (severity === 'high') return 'red';
    if (severity === 'medium') return 'yellow';
    return 'blue';
};

const availableActions = (status: string): ActionKey[] => {
    switch (status) {
        case 'pending': return ['reviewed', 'approved', 'dismissed'];
        case 'reviewed': return ['approved', 'dismissed', 'reopened'];
        case 'approved': return ['dismissed', 'reopened'];
        case 'dismissed': return ['reopened'];
        default: return [];
    }
};

const actionLabel: Record<string, string> = {
    reviewed: 'Mark reviewed',
    approved: 'Approve',
    dismissed: 'Dismiss',
    reopened: 'Reopen',
};

export default function InsightShow({ insight, canUpdateStatus }: InsightShowProps) {
    const { currentOrganization, flash } = usePage().props as unknown as SharedProps;
    const [activeAction, setActiveAction] = useState<ActionKey>(null);

    const form = useForm({ review_notes: '' });

    const routeForAction = (action: ActionKey): string => {
        const map: Record<string, string> = {
            reviewed: 'seo.insights.reviewed',
            approved: 'seo.insights.approved',
            dismissed: 'seo.insights.dismissed',
            reopened: 'seo.insights.reopened',
        };
        return route(map[action!], { organization: currentOrganization.slug, insight: insight.id });
    };

    const submitAction = (event: React.FormEvent) => {
        event.preventDefault();
        form.post(routeForAction(activeAction), {
            preserveScroll: true,
            onSuccess: () => setActiveAction(null),
        });
    };

    return (
        <AppLayout title="SEO Insight Detail">
            <Head title={insight.title} />

            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <Link
                        href={route('seo.insights.index', { organization: currentOrganization.slug })}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                    >
                        ← Back to insights
                    </Link>
                </div>

                {flash?.success && (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                        {flash.success}
                    </div>
                )}

                <Card>
                    <CardHeader>
                        <div className="flex flex-wrap items-start gap-2">
                            <h1 className="text-xl font-semibold text-gray-900">{insight.title}</h1>
                            <Badge variant={severityVariant(insight.severity)}>{insight.severity}</Badge>
                            <Badge variant={statusVariant(insight.status)}>{insight.status_label}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">{insight.type_label} · {insight.website_name ?? 'Organization-wide'}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="text-sm font-medium text-gray-700">Summary</h3>
                            <p className="mt-1 text-sm text-gray-600">{insight.summary}</p>
                        </div>

                        {insight.recommendation && (
                            <div>
                                <h3 className="text-sm font-medium text-gray-700">Recommendation</h3>
                                <p className="mt-1 text-sm text-gray-600">{insight.recommendation}</p>
                            </div>
                        )}

                        {insight.evidence && Object.keys(insight.evidence).length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-gray-700">Evidence</h3>
                                <dl className="mt-1 space-y-1">
                                    {Object.entries(insight.evidence).map(([key, value]) => (
                                        <div key={key} className="flex gap-2 text-sm">
                                            <dt className="font-medium text-gray-600 capitalize">{key.replace(/_/g, ' ')}:</dt>
                                            <dd className="text-gray-500">{String(value)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm sm:grid-cols-4">
                            <div>
                                <p className="font-medium text-gray-500">Generated by</p>
                                <p className="mt-1 text-gray-900">{insight.generated_by_name ?? '—'}</p>
                            </div>
                            <div>
                                <p className="font-medium text-gray-500">Created</p>
                                <p className="mt-1 text-gray-900">{insight.created_at ?? '—'}</p>
                            </div>
                            {insight.reviewed_at && (
                                <div>
                                    <p className="font-medium text-gray-500">Reviewed by</p>
                                    <p className="mt-1 text-gray-900">{insight.reviewed_by_name ?? '—'} on {insight.reviewed_at}</p>
                                </div>
                            )}
                            {insight.date_from && (
                                <div>
                                    <p className="font-medium text-gray-500">Data range</p>
                                    <p className="mt-1 text-gray-900">{insight.date_from} – {insight.date_to}</p>
                                </div>
                            )}
                        </div>

                        {insight.review_notes && (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Review notes</p>
                                <p className="mt-1 text-sm text-gray-700">{insight.review_notes}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {canUpdateStatus && availableActions(insight.status).length > 0 && (
                    <Card>
                        <CardHeader>
                            <h2 className="text-base font-semibold text-gray-900">Actions</h2>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                {availableActions(insight.status).map((action) => (
                                    <Button
                                        key={action}
                                        type="button"
                                        variant="secondary"
                                        onClick={() => setActiveAction(activeAction === action ? null : action)}
                                    >
                                        {actionLabel[action!]}
                                    </Button>
                                ))}
                            </div>

                            {activeAction && (
                                <form onSubmit={submitAction} className="space-y-3 rounded-lg border border-gray-200 p-4">
                                    <p className="text-sm font-medium text-gray-700">
                                        {actionLabel[activeAction]}{activeAction !== 'reopened' ? ' — add an optional note' : ''}
                                    </p>
                                    {activeAction !== 'reopened' && (
                                        <div>
                                            <Label htmlFor="review-notes">Review notes (optional)</Label>
                                            <textarea
                                                id="review-notes"
                                                value={form.data.review_notes}
                                                onChange={(e) => form.setData('review_notes', e.target.value)}
                                                maxLength={1000}
                                                rows={3}
                                                placeholder="Add context about this decision..."
                                                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                            {form.errors.review_notes && (
                                                <p className="mt-1 text-xs text-red-600">{form.errors.review_notes}</p>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <Button type="submit" loading={form.processing}>
                                            Confirm
                                        </Button>
                                        <Button type="button" variant="secondary" onClick={() => setActiveAction(null)}>
                                            Cancel
                                        </Button>
                                    </div>
                                </form>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </AppLayout>
    );
}
```

- [ ] **Step 2: Add "View detail →" links to the existing insight cards in `seo/Index.tsx`**

In `resources/js/pages/seo/Index.tsx`, find the insight card `<div>` at line ~216 (the `shrink-0 text-left text-xs text-gray-500` block) and add a link beneath the metadata:

```tsx
<div className="shrink-0 text-left text-xs text-gray-500 md:text-right">
    <p>{insight.type_label}</p>
    <p>{insight.website_name ?? 'Organization-wide'}</p>
    {insight.created_at && <p>{insight.created_at}</p>}
    <Link
        href={route('seo.insights.show', { organization: currentOrganization.slug, insight: insight.id })}
        className="mt-1 inline-block text-indigo-600 hover:text-indigo-700"
    >
        View detail →
    </Link>
</div>
```

- [ ] **Step 3: Run TypeScript check and build**

```bash
npm run typecheck
npm run build
```

Expected: 0 errors, clean build.

- [ ] **Step 4: Commit**

```bash
git add resources/js/pages/seo/InsightShow.tsx resources/js/pages/seo/Index.tsx
git commit -m "Add InsightShow detail page and view-detail links to SEO dashboard"
```

---

## Task 14: Run Pint, Full Test Suite, Build, and Update Sprint Status

**Files:**
- Modify: `docs/sprint-status.md`

- [ ] **Step 1: Run PHP formatter**

```bash
docker compose exec ultron-app ./vendor/bin/pint
```

Expected: files formatted (or "No files changed").

- [ ] **Step 2: Run full test suite**

```bash
docker compose exec ultron-app php artisan test
```

Expected: all tests pass. Count should be ~90+.

- [ ] **Step 3: Run TypeScript check and production build**

```bash
npm run typecheck && npm run build
```

Expected: 0 TypeScript errors, clean Vite build.

- [ ] **Step 4: Update `docs/sprint-status.md`**

Append the Sprint 6 section:

```markdown
---

## Sprint 6 — SEO Insights Review & Action Management

**Status:** Complete
**Date closed:** 2026-06-11
**Branch:** `sprint-6-seo-insights-review-actions`

### Delivered

| Area | Status | Notes |
|------|--------|-------|
| `review_notes` column migration | ✓ Done | Nullable TEXT added to `seo_insights` via new migration |
| AuditLog model + AuditLogger service | ✓ Done | Writes synchronously to existing `audit_logs` table |
| `UpdateSeoInsightStatusAction` | ✓ Done | Handles reviewed/approved/dismissed/reopened + audit log |
| `BulkUpdateSeoInsightStatusAction` | ✓ Done | Batch update scoped to org_id; single bulk audit event |
| `GetSeoInsightListAction` | ✓ Done | Filtered, paginated with `through()` transform |
| `GetSeoInsightDetailAction` | ✓ Done | Full insight with relations mapped to typed array |
| Form Requests (index, status, bulk) | ✓ Done | Auth + validation; `review_notes` max:1000 |
| Named per-transition routes | ✓ Done | reviewed, approved, dismissed, reopened, bulk-reviewed, bulk-dismissed |
| Insight list page with filters | ✓ Done | `seo/InsightsIndex` — type, status, website, priority, date range |
| Bulk actions UI | ✓ Done | Checkboxes + bulk mark reviewed / bulk dismiss for admin/owner only |
| Insight detail page | ✓ Done | `seo/InsightShow` — full fields, evidence, review notes, inline action forms |
| Audit logging | ✓ Done | All 6 events: insight.reviewed/approved/dismissed/reopened/bulk_reviewed/bulk_dismissed |
| Authorization tests | ✓ Done | Viewer/member denied status updates; admin/owner allowed |
| Tenant isolation tests | ✓ Done | Cross-org access denied at URL and direct API level |
| Filter tests | ✓ Done | Type, status, severity, website_id filters; cross-org website_id rejected |
| Bulk action tests | ✓ Done | HTTP + action-level; cross-org IDs silently skipped |
| No external API calls | ✓ Done | All data from local database only |
| No WordPress publishing | ✓ Done | Not applicable to this sprint |
| No automatic emails | ✓ Done | Not applicable to this sprint |

### Deferred / Explicitly Not Built

| Item | Reason |
|------|--------|
| Audit log viewer UI | Out of Sprint 6 scope |
| MFA enforcement | Deferred from Sprint 1 |
| Scheduled insight generation | Out of Sprint 6 scope |
```

- [ ] **Step 5: Final commit**

```bash
git add docs/sprint-status.md
git commit -m "Update sprint-status.md — Sprint 6 complete"
```
