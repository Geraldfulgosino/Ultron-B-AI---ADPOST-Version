# Sprint 15: Client Portal Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `client` role to organization membership so that client users can log in and see only their assigned client's websites, integrations, SEO dashboard data, and SEO insights — while owner/admin users continue seeing all organization data unchanged.

**Architecture:** Add a nullable `client_id` column to `organization_members` (and `organization_invitations`). Introduce `MemberRole::Client` with read-only permissions. `OrganizationContextService` gains `isClientUser()` and `allowedWebsiteIds()` helpers used uniformly in every controller and policy that returns multi-resource data. Existing rows with `client_id = null` are untouched — all current tests continue to pass without modification.

**Tech Stack:** PHP 8.4 / Laravel 13, MySQL 8.4, React 19 / Inertia.js v2 / TypeScript, PHPUnit, `docker compose exec ultron-app php artisan ...`

---

## File Map

| Action | File |
|--------|------|
| Modify | `app/Domains/Organizations/Enums/MemberRole.php` |
| Create | `database/migrations/2026_06_12_000003_add_client_id_to_org_members_and_invitations.php` |
| Modify | `app/Domains/Organizations/Models/OrganizationMember.php` |
| Modify | `app/Domains/Organizations/Services/OrganizationContextService.php` |
| Modify | `app/Domains/Invitations/Models/OrganizationInvitation.php` |
| Modify | `app/Domains/Invitations/Actions/SendInvitationAction.php` |
| Modify | `app/Domains/Invitations/Actions/AcceptInvitationAction.php` |
| Modify | `app/Http/Requests/Invitation/SendInvitationRequest.php` |
| Modify | `app/Http/Controllers/InvitationController.php` |
| Modify | `app/Http/Controllers/ClientController.php` |
| Modify | `app/Domains/Clients/Policies/ClientPolicy.php` |
| Modify | `app/Http/Controllers/WebsiteController.php` |
| Modify | `app/Domains/Clients/Policies/WebsitePolicy.php` |
| Modify | `app/Http/Controllers/IntegrationController.php` |
| Modify | `app/Http/Controllers/DashboardController.php` |
| Modify | `app/Http/Controllers/SeoDashboardController.php` |
| Modify | `app/Domains/Analytics/Actions/GetSeoDashboardDataAction.php` |
| Modify | `app/Http/Requests/Seo/SeoDashboardRequest.php` |
| Modify | `app/Http/Controllers/SeoInsightController.php` |
| Modify | `app/Domains/Seo/Actions/GetSeoInsightListAction.php` |
| Modify | `app/Http/Requests/Seo/SeoInsightIndexRequest.php` |
| Modify | `app/Domains/Seo/Policies/SeoInsightPolicy.php` |
| Modify | `resources/js/layouts/AppLayout.tsx` |
| Modify | `tests/TestCase.php` |
| Create | `tests/Feature/ClientPortal/ClientPortalAccessTest.php` |

---

## Task 1: Add `MemberRole::Client` with read-only permissions

**Files:**
- Modify: `app/Domains/Organizations/Enums/MemberRole.php`

- [ ] **Step 1: Write failing unit test**

Create `tests/Unit/MemberRoleClientTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Domains\Organizations\Enums\MemberRole;
use PHPUnit\Framework\TestCase;

class MemberRoleClientTest extends TestCase
{
    public function test_client_role_can_view_client(): void
    {
        $this->assertTrue(MemberRole::Client->can('client.view'));
    }

    public function test_client_role_can_view_website(): void
    {
        $this->assertTrue(MemberRole::Client->can('website.view'));
    }

    public function test_client_role_can_view_reports(): void
    {
        $this->assertTrue(MemberRole::Client->can('report.view'));
    }

    public function test_client_role_can_view_integrations(): void
    {
        $this->assertTrue(MemberRole::Client->can('integration.view'));
    }

    public function test_client_role_cannot_create_client(): void
    {
        $this->assertFalse(MemberRole::Client->can('client.create'));
    }

    public function test_client_role_cannot_manage_client(): void
    {
        $this->assertFalse(MemberRole::Client->can('client.manage'));
    }

    public function test_client_role_cannot_generate_insights(): void
    {
        $this->assertFalse(MemberRole::Client->can('seo.insights.generate'));
    }

    public function test_client_role_cannot_decide_approval(): void
    {
        $this->assertFalse(MemberRole::Client->can('approval.decide'));
    }

    public function test_client_role_cannot_connect_integration(): void
    {
        $this->assertFalse(MemberRole::Client->can('integration.connect'));
    }

    public function test_client_role_cannot_manage_organization(): void
    {
        $this->assertFalse(MemberRole::Client->can('organization.update'));
    }

    public function test_client_role_label(): void
    {
        $this->assertSame('Client', MemberRole::Client->label());
    }
}
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
docker compose exec ultron-app php artisan test tests/Unit/MemberRoleClientTest.php
```
Expected: FAIL — `MemberRole::Client` does not exist yet.

- [ ] **Step 3: Add `Client` case to `MemberRole`**

Replace the full `MemberRole.php` content:

```php
<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Enums;

enum MemberRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Member = 'member';
    case Viewer = 'viewer';
    case Client = 'client';

    public function label(): string
    {
        return match ($this) {
            self::Owner  => 'Owner',
            self::Admin  => 'Admin',
            self::Member => 'Member',
            self::Viewer => 'Viewer',
            self::Client => 'Client',
        };
    }

    public function can(string $permission): bool
    {
        return match ($this) {
            self::Owner  => true,
            self::Admin  => in_array($permission, self::adminPermissions(), strict: true),
            self::Member => in_array($permission, self::memberPermissions(), strict: true),
            self::Viewer => in_array($permission, self::viewerPermissions(), strict: true),
            self::Client => in_array($permission, self::clientPermissions(), strict: true),
        };
    }

    /** @return list<string> */
    private static function adminPermissions(): array
    {
        return [
            ...self::memberPermissions(),
            'organization.update',
            'organization.manage_users',
            'member.invite',
            'member.remove',
            'member.change_role',
            'department.manage',
            'client.manage',
            'website.manage',
            'integration.connect',
            'integration.disconnect',
            'analytics.sync',
            'seo.insights.generate',
            'approval.decide',
            'report.export',
        ];
    }

    /** @return list<string> */
    private static function memberPermissions(): array
    {
        return [
            ...self::viewerPermissions(),
            'client.create',
            'website.create',
            'integration.view',
            'agent.run',
            'report.create',
        ];
    }

    /** @return list<string> */
    private static function viewerPermissions(): array
    {
        return [
            'organization.view',
            'client.view',
            'website.view',
            'report.view',
        ];
    }

    /** @return list<string> */
    private static function clientPermissions(): array
    {
        return [
            'client.view',
            'website.view',
            'report.view',
            'integration.view',
        ];
    }

    /** @return list<array{value: string, label: string}> */
    public static function assignable(): array
    {
        return array_map(
            fn (self $role) => ['value' => $role->value, 'label' => $role->label()],
            [self::Admin, self::Member, self::Viewer, self::Client]
        );
    }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
docker compose exec ultron-app php artisan test tests/Unit/MemberRoleClientTest.php
```
Expected: 11 tests, 11 assertions, PASS.

- [ ] **Step 5: Confirm all existing tests still pass**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/Domains/Organizations/Enums/MemberRole.php tests/Unit/MemberRoleClientTest.php
git commit -m "feat: add MemberRole::Client with read-only permissions"
```

---

## Task 2: Migration — `client_id` on `organization_members` and `organization_invitations`

**Files:**
- Create: `database/migrations/2026_06_12_000003_add_client_id_to_org_members_and_invitations.php`

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
        Schema::table('organization_members', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable()->after('department_id');
            $table->foreign('client_id')->references('id')->on('clients')->nullOnDelete();
        });

        Schema::table('organization_invitations', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable()->after('role');
            $table->foreign('client_id')->references('id')->on('clients')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('organization_members', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
            $table->dropColumn('client_id');
        });

        Schema::table('organization_invitations', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
            $table->dropColumn('client_id');
        });
    }
};
```

- [ ] **Step 2: Run the migration**

```bash
docker compose exec ultron-app php artisan migrate
```
Expected: Migrates successfully, no errors.

- [ ] **Step 3: Confirm all tests still pass**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass (new nullable column is invisible to existing factories).

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026_06_12_000003_add_client_id_to_org_members_and_invitations.php
git commit -m "feat: add client_id to organization_members and organization_invitations"
```

---

## Task 3: Model + context service helpers

**Files:**
- Modify: `app/Domains/Organizations/Models/OrganizationMember.php`
- Modify: `app/Domains/Organizations/Services/OrganizationContextService.php`

- [ ] **Step 1: Update `OrganizationMember`**

Add `client_id` to `$fillable` and add the `client()` relationship:

```php
<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Models;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use Database\Factories\OrganizationMemberFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationMember extends Model
{
    use HasFactory;

    protected static function newFactory(): OrganizationMemberFactory
    {
        return OrganizationMemberFactory::new();
    }

    protected $fillable = ['organization_id', 'user_id', 'role', 'department_id', 'client_id'];

    protected function casts(): array
    {
        return [
            'role' => MemberRole::class,
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function can(string $permission): bool
    {
        return $this->role->can($permission);
    }

    public function isOwner(): bool
    {
        return $this->role === MemberRole::Owner;
    }

    public function isAdminOrOwner(): bool
    {
        return in_array($this->role, [MemberRole::Owner, MemberRole::Admin], strict: true);
    }

    public function isClientUser(): bool
    {
        return $this->role === MemberRole::Client;
    }
}
```

- [ ] **Step 2: Update `OrganizationContextService`**

Add `isClientUser()`, `currentClientId()`, and `allowedWebsiteIds()`:

```php
<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Services;

use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;

class OrganizationContextService
{
    public function current(): ?Organization
    {
        return app()->has('current.organization')
            ? app('current.organization')
            : null;
    }

    public function currentMember(): ?OrganizationMember
    {
        return app()->has('current.member')
            ? app('current.member')
            : null;
    }

    public function set(Organization $organization, OrganizationMember $member): void
    {
        app()->instance('current.organization', $organization);
        app()->instance('current.member', $member);
    }

    public function memberCan(string $permission): bool
    {
        return $this->currentMember()?->can($permission) ?? false;
    }

    public function isClientUser(): bool
    {
        return $this->currentMember()?->isClientUser() ?? false;
    }

    public function currentClientId(): ?int
    {
        $member = $this->currentMember();

        return ($member?->isClientUser() === true)
            ? $member->client_id
            : null;
    }

    /**
     * Returns an array of allowed website IDs for the current member,
     * or null if there is no restriction (owner/admin/member/viewer).
     *
     * @return list<int>|null
     */
    public function allowedWebsiteIds(): ?array
    {
        $clientId = $this->currentClientId();

        if ($clientId === null) {
            return null;
        }

        return Website::where('client_id', $clientId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
    }

    /** @return list<array{id: int, name: string, slug: string, role: string}> */
    public function userOrganizations(User $user): array
    {
        return $user->memberships()
            ->with('organization')
            ->get()
            ->filter(fn ($m) => $m->organization->isAccessible())
            ->map(fn ($m) => [
                'id' => $m->organization->id,
                'name' => $m->organization->name,
                'slug' => $m->organization->slug,
                'role' => $m->role->value,
            ])
            ->values()
            ->toArray();
    }
}
```

- [ ] **Step 3: Confirm all tests still pass**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add app/Domains/Organizations/Models/OrganizationMember.php \
        app/Domains/Organizations/Services/OrganizationContextService.php
git commit -m "feat: add client_id to OrganizationMember and context service helpers"
```

---

## Task 4: Invitation flow — thread `client_id` through send and accept

**Files:**
- Modify: `app/Domains/Invitations/Models/OrganizationInvitation.php`
- Modify: `app/Domains/Invitations/Actions/SendInvitationAction.php`
- Modify: `app/Domains/Invitations/Actions/AcceptInvitationAction.php`
- Modify: `app/Http/Requests/Invitation/SendInvitationRequest.php`
- Modify: `app/Http/Controllers/InvitationController.php`
- Test: `tests/Feature/Invitations/InvitationTest.php` (add two tests)

- [ ] **Step 1: Write failing tests**

Add to the bottom of `tests/Feature/Invitations/InvitationTest.php`:

```php
public function test_admin_can_invite_client_user_with_client_id(): void
{
    [$organization, $admin] = $this->createOrgWithUser('admin');
    $client = \App\Domains\Clients\Models\Client::factory()->create([
        'organization_id' => $organization->id,
        'created_by' => $admin->id,
    ]);

    $this->actingAs($admin)
        ->post(route('invitations.store', ['organization' => $organization->slug]), [
            'email' => 'portal@example.com',
            'role' => 'client',
            'client_id' => $client->id,
        ])
        ->assertRedirect();

    $this->assertDatabaseHas('organization_invitations', [
        'organization_id' => $organization->id,
        'email' => 'portal@example.com',
        'role' => 'client',
        'client_id' => $client->id,
    ]);
}

public function test_accepting_client_invitation_creates_member_with_client_id(): void
{
    [$organization, $admin] = $this->createOrgWithUser('admin');
    $client = \App\Domains\Clients\Models\Client::factory()->create([
        'organization_id' => $organization->id,
        'created_by' => $admin->id,
    ]);
    $invitation = \App\Domains\Invitations\Models\OrganizationInvitation::factory()->create([
        'organization_id' => $organization->id,
        'invited_by' => $admin->id,
        'email' => 'portal@example.com',
        'role' => 'client',
        'client_id' => $client->id,
        'status' => 'pending',
    ]);

    $portalUser = \App\Domains\Identity\Models\User::factory()->create([
        'email' => 'portal@example.com',
    ]);

    $this->actingAs($portalUser)
        ->post(route('invitations.accept', ['token' => $invitation->token]))
        ->assertRedirect();

    $this->assertDatabaseHas('organization_members', [
        'organization_id' => $organization->id,
        'user_id' => $portalUser->id,
        'role' => 'client',
        'client_id' => $client->id,
    ]);
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Invitations/InvitationTest.php
```
Expected: the 2 new tests FAIL (invitation model doesn't store `client_id`; member creation ignores it).

- [ ] **Step 3: Update `OrganizationInvitation` model**

Add `client_id` to `$fillable`:

```php
protected $fillable = [
    'organization_id',
    'invited_by',
    'email',
    'role',
    'client_id',
    'token',
    'status',
    'accepted_at',
    'expires_at',
];
```

- [ ] **Step 4: Update `SendInvitationAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Invitations\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Invitations\Notifications\InvitationNotification;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;

class SendInvitationAction
{
    public function execute(
        Organization $organization,
        User $invitedBy,
        string $email,
        MemberRole $role,
        ?int $clientId = null,
    ): OrganizationInvitation {
        if ($organization->members()->whereHas('user', fn ($q) => $q->where('email', $email))->exists()) {
            throw ValidationException::withMessages([
                'email' => ['This user is already a member of the organization.'],
            ]);
        }

        $existing = OrganizationInvitation::where('organization_id', $organization->id)
            ->where('email', $email)
            ->where('status', 'pending')
            ->whereDate('expires_at', '>', now())
            ->first();

        if ($existing) {
            throw ValidationException::withMessages([
                'email' => ['An active invitation has already been sent to this address.'],
            ]);
        }

        $invitation = OrganizationInvitation::create([
            'organization_id' => $organization->id,
            'invited_by' => $invitedBy->id,
            'email' => $email,
            'role' => $role,
            'client_id' => $clientId,
        ]);

        Notification::route('mail', $email)->notify(new InvitationNotification($invitation));

        return $invitation;
    }
}
```

- [ ] **Step 5: Update `AcceptInvitationAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Invitations\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Invitations\Enums\InvitationStatus;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcceptInvitationAction
{
    public function execute(OrganizationInvitation $invitation, User $user): OrganizationMember
    {
        if (! $invitation->isPending()) {
            throw ValidationException::withMessages([
                'token' => ['This invitation has expired or has already been used.'],
            ]);
        }

        if (strtolower($user->email) !== strtolower($invitation->email)) {
            throw ValidationException::withMessages([
                'token' => ['This invitation was sent to a different email address.'],
            ]);
        }

        return DB::transaction(function () use ($invitation, $user): OrganizationMember {
            $member = OrganizationMember::firstOrCreate(
                [
                    'organization_id' => $invitation->organization_id,
                    'user_id' => $user->id,
                ],
                [
                    'role' => $invitation->role,
                    'client_id' => $invitation->client_id,
                ]
            );

            $invitation->update([
                'status' => InvitationStatus::Accepted,
                'accepted_at' => now(),
            ]);

            return $member;
        });
    }
}
```

- [ ] **Step 6: Update `SendInvitationRequest`**

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Invitation;

use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

class SendInvitationRequest extends FormRequest
{
    public function rules(): array
    {
        $organization = app(OrganizationContextService::class)->current();

        return [
            'email' => ['required', 'email', 'max:255'],
            'role' => ['required', 'string', new Enum(MemberRole::class), 'not_in:owner'],
            'client_id' => [
                Rule::requiredIf(fn () => $this->input('role') === MemberRole::Client->value),
                'nullable',
                'integer',
                Rule::exists('clients', 'id')->where('organization_id', $organization?->id),
            ],
        ];
    }
}
```

- [ ] **Step 7: Update `InvitationController::store()`**

```php
public function store(
    SendInvitationRequest $request,
    OrganizationContextService $context,
    SendInvitationAction $action,
): RedirectResponse {
    $organization = $context->current();
    $this->authorize('inviteMembers', $organization);

    $validated = $request->validated();

    $action->execute(
        $organization,
        $request->user(),
        $validated['email'],
        MemberRole::from($validated['role']),
        isset($validated['client_id']) ? (int) $validated['client_id'] : null,
    );

    return back()->with('success', 'Invitation sent.');
}
```

- [ ] **Step 8: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Invitations/InvitationTest.php
```
Expected: all invitation tests pass including the 2 new ones.

- [ ] **Step 9: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 10: Commit**

```bash
git add app/Domains/Invitations/Models/OrganizationInvitation.php \
        app/Domains/Invitations/Actions/SendInvitationAction.php \
        app/Domains/Invitations/Actions/AcceptInvitationAction.php \
        app/Http/Requests/Invitation/SendInvitationRequest.php \
        app/Http/Controllers/InvitationController.php \
        tests/Feature/Invitations/InvitationTest.php
git commit -m "feat: thread client_id through invitation send and accept flow"
```

---

## Task 5: Add `createClientUser()` test helper to `TestCase`

**Files:**
- Modify: `tests/TestCase.php`

This helper is needed by all subsequent tasks.

- [ ] **Step 1: Add the helper method**

```php
/**
 * Create a client user member scoped to the given client.
 *
 * @return array{0: \App\Domains\Identity\Models\User, 1: \App\Domains\Organizations\Models\OrganizationMember}
 */
protected function createClientUser(
    \App\Domains\Organizations\Models\Organization $organization,
    \App\Domains\Clients\Models\Client $client,
): array {
    $user = \App\Domains\Identity\Models\User::factory()->create();

    $member = \App\Domains\Organizations\Models\OrganizationMember::factory()->create([
        'organization_id' => $organization->id,
        'user_id' => $user->id,
        'role' => 'client',
        'client_id' => $client->id,
    ]);

    return [$user, $member];
}
```

Add this method to the `TestCase` class after the existing `createOrgWithUser()` method.

- [ ] **Step 2: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/TestCase.php
git commit -m "test: add createClientUser() helper to TestCase"
```

---

## Task 6: Client scoping — `ClientController` + `ClientPolicy`

**Files:**
- Modify: `app/Http/Controllers/ClientController.php`
- Modify: `app/Domains/Clients/Policies/ClientPolicy.php`
- Create: `tests/Feature/ClientPortal/ClientPortalAccessTest.php` (first batch of tests)

- [ ] **Step 1: Write failing tests**

Create `tests/Feature/ClientPortal/ClientPortalAccessTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\ClientPortal;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientPortalAccessTest extends TestCase
{
    use RefreshDatabase;

    // ── Client list scoping ───────────────────────────────────────────

    public function test_client_user_only_sees_their_assigned_client_in_index(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
        [$clientUser] = $this->createClientUser($org, $myClient);

        $response = $this->actingAs($clientUser)
            ->get(route('clients.index', ['organization' => $org->slug]));

        $response->assertOk();
        $clients = collect($response->original->getData()['page']['props']['clients']);
        $this->assertCount(1, $clients);
        $this->assertEquals($myClient->id, $clients->first()['id']);
    }

    public function test_client_user_cannot_create_client(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->post(route('clients.store', ['organization' => $org->slug]), [
                'name' => 'Forbidden Client',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
            ])
            ->assertForbidden();
    }

    public function test_client_user_cannot_update_their_own_client(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->patch(route('clients.update', ['organization' => $org->slug, 'client' => $myClient->id]), [
                'name' => 'Hacked Name',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
            ])
            ->assertForbidden();
    }

    public function test_client_user_cannot_delete_their_own_client(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->delete(route('clients.destroy', ['organization' => $org->slug, 'client' => $myClient->id]))
            ->assertForbidden();
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: FAIL — index returns all clients, not just the assigned one.

- [ ] **Step 3: Update `ClientController::index()`**

```php
public function index(OrganizationContextService $context): Response
{
    $organization = $context->current();
    $clientId = $context->currentClientId();

    return Inertia::render('clients/Index', [
        'clients' => $organization->clients()
            ->when($clientId !== null, fn ($q) => $q->where('id', $clientId))
            ->withCount('websites')
            ->latest()
            ->get()
            ->map(fn (Client $client) => [
                'id' => $client->id,
                'name' => $client->name,
                'slug' => $client->slug,
                'status' => $client->status,
                'timezone' => $client->timezone,
                'currency' => $client->currency,
                'business_goals' => $client->business_goals,
                'websites_count' => $client->websites_count,
            ]),
        'canCreate' => $context->memberCan('client.create'),
        'canManage' => $context->memberCan('client.manage'),
        'defaults' => [
            'timezone' => $organization->timezone,
            'currency' => $organization->currency,
        ],
    ]);
}
```

- [ ] **Step 4: Update `ClientPolicy`**

`ClientPolicy::view()` already calls `$this->memberCan($user, $client, 'client.view')`. Client role has `client.view`, so view is already permitted. However, a client user could theoretically call the URL for a different client's update/delete since policies only check the permission string.

The `update` and `delete` methods check `client.manage`, which client role doesn't have — so those are already blocked. The view permission check is sufficient for `view`. No change needed to `ClientPolicy` — the permission system already protects write operations. Verify:

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: 4 tests, all PASS.

- [ ] **Step 5: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/ClientController.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: scope ClientController index to assigned client for client users"
```

---

## Task 7: Website scoping — `WebsiteController` + `WebsitePolicy`

**Files:**
- Modify: `app/Http/Controllers/WebsiteController.php`
- Modify: `app/Domains/Clients/Policies/WebsitePolicy.php`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php` (add website tests)

- [ ] **Step 1: Add failing tests**

Append to `ClientPortalAccessTest.php`:

```php
// ── Website list scoping ──────────────────────────────────────────────

public function test_client_user_only_sees_websites_for_their_client(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('websites.index', ['organization' => $org->slug]));

    $response->assertOk();
    $websites = collect($response->original->getData()['page']['props']['websites']);
    $this->assertCount(1, $websites);
    $this->assertEquals($myWebsite->id, $websites->first()['id']);
}

public function test_client_user_cannot_create_website(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->post(route('websites.store', ['organization' => $org->slug]), [
            'name' => 'Forbidden Site',
            'domain' => 'forbidden.com',
            'client_id' => $myClient->id,
            'platform' => 'custom',
            'status' => 'active',
            'timezone' => 'UTC',
            'currency' => 'USD',
        ])
        ->assertForbidden();
}

public function test_client_user_cannot_update_website(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->patch(route('websites.update', ['organization' => $org->slug, 'website' => $myWebsite->id]), [
            'name' => 'Hacked',
            'domain' => 'hacked.com',
            'client_id' => $myClient->id,
            'platform' => 'custom',
            'status' => 'active',
            'timezone' => 'UTC',
            'currency' => 'USD',
        ])
        ->assertForbidden();
}

public function test_client_user_cannot_see_other_clients_website_in_list(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('websites.index', ['organization' => $org->slug]));

    $response->assertOk();
    $websiteIds = collect($response->original->getData()['page']['props']['websites'])->pluck('id');
    $this->assertNotContains($otherWebsite->id, $websiteIds->toArray());
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --filter=website
```
Expected: FAIL — index returns all websites.

- [ ] **Step 3: Update `WebsiteController::index()`**

```php
public function index(OrganizationContextService $context): Response
{
    $organization = $context->current();
    $allowedWebsiteIds = $context->allowedWebsiteIds();

    return Inertia::render('websites/Index', [
        'websites' => Website::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
            ->with('client')
            ->latest()
            ->get()
            ->map(fn (Website $website) => [
                'id' => $website->id,
                'client_id' => $website->client_id,
                'client_name' => $website->client->name,
                'name' => $website->name,
                'domain' => $website->domain,
                'platform' => $website->platform,
                'status' => $website->status->value,
                'status_label' => $website->status->label(),
                'timezone' => $website->timezone,
                'currency' => $website->currency,
                'primary_conversion' => $website->primary_conversion,
                'ga4_property_id' => $website->ga4_property_id,
                'gsc_site_url' => $website->gsc_site_url,
            ]),
        'clients' => $organization->clients()
            ->when($context->currentClientId() !== null, fn ($q) => $q->where('id', $context->currentClientId()))
            ->where('status', 'active')
            ->orderBy('name')
            ->get()
            ->map(fn (Client $client) => [
                'id' => $client->id,
                'name' => $client->name,
                'timezone' => $client->timezone,
                'currency' => $client->currency,
            ]),
        'canCreate' => $context->memberCan('website.create'),
        'canManage' => $context->memberCan('website.manage'),
        'defaults' => [
            'timezone' => $organization->timezone,
            'currency' => $organization->currency,
        ],
    ]);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: all tests in the file PASS.

- [ ] **Step 5: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/WebsiteController.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: scope WebsiteController index to client's websites for client users"
```

---

## Task 8: Integration scoping — `IntegrationController`

**Files:**
- Modify: `app/Http/Controllers/IntegrationController.php`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php` (add integration tests)

- [ ] **Step 1: Add failing tests**

Append to `ClientPortalAccessTest.php`:

```php
// ── Integration list scoping ───────────────────────────────────────────

public function test_client_user_only_sees_integrations_for_their_websites(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    $myIntegration = \App\Domains\Integrations\Models\Integration::factory()->create([
        'organization_id' => $org->id,
        'website_id' => $myWebsite->id,
        'created_by' => $owner->id,
    ]);
    $otherIntegration = \App\Domains\Integrations\Models\Integration::factory()->create([
        'organization_id' => $org->id,
        'website_id' => $otherWebsite->id,
        'created_by' => $owner->id,
    ]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('integrations.index', ['organization' => $org->slug]));

    $response->assertOk();
    $integrationIds = collect($response->original->getData()['page']['props']['integrations'])->pluck('id');
    $this->assertContains($myIntegration->id, $integrationIds->toArray());
    $this->assertNotContains($otherIntegration->id, $integrationIds->toArray());
}

public function test_client_user_cannot_connect_integration(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('integrations.index', ['organization' => $org->slug]));

    $response->assertOk();
    $this->assertFalse($response->original->getData()['page']['props']['canConnect']);
    $this->assertFalse($response->original->getData()['page']['props']['canDisconnect']);
}

public function test_client_user_website_dropdown_in_integrations_is_scoped_to_their_client(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('integrations.index', ['organization' => $org->slug]));

    $response->assertOk();
    $websiteIds = collect($response->original->getData()['page']['props']['websites'])->pluck('id');
    $this->assertContains($myWebsite->id, $websiteIds->toArray());
    $this->assertNotContains($otherWebsite->id, $websiteIds->toArray());
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --filter=integration
```
Expected: FAIL — all integrations returned, not scoped to client's websites.

- [ ] **Step 3: Update `IntegrationController::index()`**

```php
public function index(OrganizationContextService $context): Response
{
    $organization = $context->current();
    $allowedWebsiteIds = $context->allowedWebsiteIds();

    return Inertia::render('integrations/Index', [
        'integrations' => Integration::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->with('website')
            ->latest()
            ->get()
            ->map(fn (Integration $integration) => [
                'id' => $integration->id,
                'website_id' => $integration->website_id,
                'website_name' => $integration->website?->name,
                'provider' => $integration->provider->value,
                'provider_label' => $integration->provider->label(),
                'status' => $integration->status->value,
                'status_label' => $integration->status->label(),
                'external_account_name' => $integration->external_account_name,
                'external_property_name' => $integration->external_property_name,
                'last_synced_at' => $integration->last_synced_at?->toDateTimeString(),
                'last_error_message' => $integration->last_error_message,
                'can_sync' => $context->memberCan('analytics.sync'),
            ]),
        'websites' => $organization->websites()
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
            ->orderBy('name')
            ->get(['id', 'name', 'domain']),
        'providers' => array_map(
            fn (IntegrationProvider $provider) => ['value' => $provider->value, 'label' => $provider->label()],
            IntegrationProvider::cases(),
        ),
        'canConnect' => $context->memberCan('integration.connect'),
        'canDisconnect' => $context->memberCan('integration.disconnect'),
        'canSync' => $context->memberCan('analytics.sync'),
        'googleConfigured' => filled(config('services.google.client_id'))
            && filled(config('services.google.client_secret'))
            && filled(config('services.google.redirect')),
    ]);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/IntegrationController.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: scope IntegrationController to client's websites for client users"
```

---

## Task 9: SEO Dashboard scoping

**Files:**
- Modify: `app/Domains/Analytics/Actions/GetSeoDashboardDataAction.php`
- Modify: `app/Http/Controllers/SeoDashboardController.php`
- Modify: `app/Http/Requests/Seo/SeoDashboardRequest.php`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php` (add SEO dashboard tests)

- [ ] **Step 1: Add failing tests**

Append to `ClientPortalAccessTest.php`:

```php
// ── SEO Dashboard scoping ─────────────────────────────────────────────

public function test_client_user_seo_dashboard_website_list_scoped_to_their_client(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('seo.index', ['organization' => $org->slug]));

    $response->assertOk();
    $websiteIds = collect($response->original->getData()['page']['props']['websites'])->pluck('id');
    $this->assertContains($myWebsite->id, $websiteIds->toArray());
    $this->assertNotContains($otherWebsite->id, $websiteIds->toArray());
}

public function test_client_user_cannot_filter_seo_dashboard_by_other_clients_website(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->get(route('seo.index', ['organization' => $org->slug, 'website_id' => $otherWebsite->id]))
        ->assertUnprocessable();
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --filter=seo_dashboard
```
Expected: FAIL.

- [ ] **Step 3: Update `GetSeoDashboardDataAction::execute()` to accept `allowedWebsiteIds`**

Replace the `execute()` signature and all helper method signatures. Add `?array $allowedWebsiteIds = null` and thread it through every private query method:

```php
/**
 * @param  array{website_id: int|null, date_from: string, date_to: string, source: string}  $filters
 * @param  list<int>|null  $allowedWebsiteIds  null = no restriction; array = restrict to these IDs
 * @return array<string, mixed>
 */
public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): array
{
    $dailyQuery = $this->dailyQuery($organization, $filters, $allowedWebsiteIds);
    $dailyTotals = (clone $dailyQuery)
        ->selectRaw('COALESCE(SUM(sessions), 0) as sessions, COALESCE(SUM(conversions), 0) as conversions, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions')
        ->first();
    $averagePosition = (clone $dailyQuery)
        ->where('average_position', '>', 0)
        ->avg('average_position');
    $clicks = (int) ($dailyTotals?->clicks ?? 0);
    $impressions = (int) ($dailyTotals?->impressions ?? 0);
    $latestSync = $this->syncQuery($organization, $filters, $allowedWebsiteIds)
        ->latest()
        ->first();

    return [
        'filters' => $filters,
        'stats' => [
            'websites' => $allowedWebsiteIds !== null
                ? count($allowedWebsiteIds)
                : $organization->websites()->count(),
            'connected_integrations' => $organization->integrations()
                ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
                ->where('status', IntegrationStatus::Connected->value)
                ->count(),
            'keywords_tracked' => $this->searchQuery($organization, $filters, $allowedWebsiteIds)->distinct()->count('query'),
            'clicks' => $clicks,
            'impressions' => $impressions,
            'ctr' => $this->ratio($clicks, $impressions) * 100,
            'average_position' => $averagePosition !== null ? round((float) $averagePosition, 2) : null,
            'organic_sessions' => (int) ($dailyTotals?->sessions ?? 0),
            'conversions' => (int) ($dailyTotals?->conversions ?? 0),
            'has_synced_data' => (clone $dailyQuery)->exists(),
            'last_sync_status' => $latestSync?->status->label(),
            'last_sync_at' => $latestSync?->finished_at?->toDateTimeString()
                ?? $latestSync?->created_at?->toDateTimeString(),
        ],
        'websites' => $this->websites($organization, $allowedWebsiteIds),
        'landingPages' => $this->landingPages($organization, $filters, $allowedWebsiteIds),
        'searchQueries' => $this->searchQueries($organization, $filters, $allowedWebsiteIds),
        'latestSync' => $latestSync ? [
            'provider' => $latestSync->provider->label(),
            'status' => $latestSync->status->label(),
            'records_synced' => $latestSync->records_synced,
            'finished_at' => $latestSync->finished_at?->toDateTimeString(),
            'error_message' => $latestSync->error_message,
        ] : null,
    ];
}
```

Update the four private methods to accept and use `?array $allowedWebsiteIds`:

```php
/**
 * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
 * @param  list<int>|null  $allowedWebsiteIds
 * @return Builder<AnalyticsDailyMetric>
 */
private function dailyQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds): Builder
{
    return AnalyticsDailyMetric::query()
        ->where('organization_id', $organization->id)
        ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
        ->whereDate('metric_date', '>=', $filters['date_from'])
        ->whereDate('metric_date', '<=', $filters['date_to'])
        ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('website_id', $filters['website_id']));
}

/**
 * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
 * @param  list<int>|null  $allowedWebsiteIds
 * @return Builder<AnalyticsSearchQuery>
 */
private function searchQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds): Builder
{
    return AnalyticsSearchQuery::query()
        ->where('organization_id', $organization->id)
        ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
        ->whereDate('metric_date', '>=', $filters['date_from'])
        ->whereDate('metric_date', '<=', $filters['date_to'])
        ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('website_id', $filters['website_id']));
}

/**
 * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
 * @param  list<int>|null  $allowedWebsiteIds
 * @return Builder<AnalyticsSyncHistory>
 */
private function syncQuery(Organization $organization, array $filters, ?array $allowedWebsiteIds): Builder
{
    return AnalyticsSyncHistory::query()
        ->where('organization_id', $organization->id)
        ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
        ->where(function (Builder $query) use ($filters): void {
            $query->whereNull('date_from')
                ->orWhere('date_from', '<=', $filters['date_to']);
        })
        ->where(function (Builder $query) use ($filters): void {
            $query->whereNull('date_to')
                ->orWhere('date_to', '>=', $filters['date_from']);
        })
        ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('website_id', $filters['website_id']));
}

/** @param  list<int>|null  $allowedWebsiteIds */
private function websites(Organization $organization, ?array $allowedWebsiteIds = null): Collection
{
    return $organization->websites()
        ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
        ->with('client')
        ->latest()
        ->get()
        ->map(fn ($website) => [
            'id' => $website->id,
            'name' => $website->name,
            'domain' => $website->domain,
            'client_name' => $website->client->name,
            'status' => $website->status->value,
            'last_synced_at' => AnalyticsSyncHistory::query()
                ->where('organization_id', $organization->id)
                ->where('website_id', $website->id)
                ->latest()
                ->first()?->created_at?->toDateTimeString(),
        ]);
}
```

Update `landingPages()` and `searchQueries()` to accept and pass `?array $allowedWebsiteIds`:

```php
/**
 * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
 * @param  list<int>|null  $allowedWebsiteIds
 */
private function landingPages(Organization $organization, array $filters, ?array $allowedWebsiteIds): Collection
{
    return AnalyticsLandingPage::query()
        ->where('analytics_landing_pages.organization_id', $organization->id)
        ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('analytics_landing_pages.website_id', $allowedWebsiteIds))
        ->whereDate('analytics_landing_pages.metric_date', '>=', $filters['date_from'])
        ->whereDate('analytics_landing_pages.metric_date', '<=', $filters['date_to'])
        ->when($filters['website_id'] !== null, fn (Builder $query) => $query->where('analytics_landing_pages.website_id', $filters['website_id']))
        ->leftJoin('analytics_search_pages', function ($join) use ($organization, $filters): void {
            $join->on('analytics_landing_pages.organization_id', '=', 'analytics_search_pages.organization_id')
                ->on('analytics_landing_pages.website_id', '=', 'analytics_search_pages.website_id')
                ->on('analytics_landing_pages.metric_date', '=', 'analytics_search_pages.metric_date')
                ->on('analytics_landing_pages.page_path_hash', '=', 'analytics_search_pages.page_url_hash')
                ->where('analytics_search_pages.organization_id', $organization->id)
                ->whereDate('analytics_search_pages.metric_date', '>=', $filters['date_from'])
                ->whereDate('analytics_search_pages.metric_date', '<=', $filters['date_to']);
        })
        ->selectRaw('analytics_landing_pages.page_path as page_path, COALESCE(SUM(analytics_landing_pages.sessions), 0) as sessions, COALESCE(SUM(analytics_landing_pages.conversions), 0) as conversions, COALESCE(SUM(analytics_search_pages.clicks), 0) as clicks, COALESCE(SUM(analytics_search_pages.impressions), 0) as impressions')
        ->groupBy('analytics_landing_pages.page_path')
        ->orderByDesc('sessions')
        ->limit(10)
        ->get()
        ->map(fn ($row) => [
            'page_path' => (string) $row->page_path,
            'sessions' => (int) $row->sessions,
            'conversions' => (int) $row->conversions,
            'clicks' => (int) $row->clicks,
            'impressions' => (int) $row->impressions,
            'ctr' => $this->ratio((int) $row->clicks, (int) $row->impressions) * 100,
        ]);
}

/**
 * @param  array{website_id: int|null, date_from: string, date_to: string}  $filters
 * @param  list<int>|null  $allowedWebsiteIds
 */
private function searchQueries(Organization $organization, array $filters, ?array $allowedWebsiteIds): Collection
{
    return $this->searchQuery($organization, $filters, $allowedWebsiteIds)
        ->selectRaw('query, COALESCE(SUM(clicks), 0) as clicks, COALESCE(SUM(impressions), 0) as impressions, AVG(NULLIF(average_position, 0)) as average_position')
        ->groupBy('query')
        ->orderByDesc('clicks')
        ->limit(10)
        ->get()
        ->map(fn ($row) => [
            'query' => (string) $row->query,
            'clicks' => (int) $row->clicks,
            'impressions' => (int) $row->impressions,
            'ctr' => $this->ratio((int) $row->clicks, (int) $row->impressions) * 100,
            'average_position' => $row->average_position !== null ? round((float) $row->average_position, 2) : null,
        ]);
}
```

- [ ] **Step 4: Update `SeoDashboardController`**

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Analytics\Actions\GetSeoDashboardDataAction;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Actions\GetSeoInsightsForDashboardAction;
use App\Http\Requests\Seo\SeoDashboardRequest;
use Inertia\Inertia;
use Inertia\Response;

class SeoDashboardController extends Controller
{
    public function __invoke(
        SeoDashboardRequest $request,
        OrganizationContextService $context,
        GetSeoDashboardDataAction $action,
        GetSeoInsightsForDashboardAction $insights,
    ): Response {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        return Inertia::render('seo/Index', [
            ...$action->execute($organization, $request->filters(), $allowedWebsiteIds),
            'insights' => $insights->execute($organization),
            'canGenerateInsights' => $context->memberCan('seo.insights.generate'),
        ]);
    }
}
```

- [ ] **Step 5: Update `SeoDashboardRequest::rules()` to scope `website_id` validation for client users**

```php
public function rules(): array
{
    $context = app(OrganizationContextService::class);
    $organization = $context->current();
    $allowedWebsiteIds = $context->allowedWebsiteIds();

    return [
        'website_id' => [
            'nullable',
            'integer',
            \Illuminate\Validation\Rule::exists('websites', 'id')->where(function ($query) use ($organization, $allowedWebsiteIds) {
                $query->where('organization_id', $organization?->id);
                if ($allowedWebsiteIds !== null) {
                    $query->whereIn('id', $allowedWebsiteIds);
                }
            }),
        ],
        'date_from' => ['nullable', 'date'],
        'date_to'   => ['nullable', 'date', 'after_or_equal:date_from'],
        'source'    => ['nullable', \Illuminate\Validation\Rule::in(['all', 'ga4', 'gsc'])],
    ];
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: all tests PASS.

- [ ] **Step 7: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add app/Domains/Analytics/Actions/GetSeoDashboardDataAction.php \
        app/Http/Controllers/SeoDashboardController.php \
        app/Http/Requests/Seo/SeoDashboardRequest.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: scope SEO dashboard data and website filter to client's websites for client users"
```

---

## Task 10: SEO Insight scoping

**Files:**
- Modify: `app/Domains/Seo/Actions/GetSeoInsightListAction.php`
- Modify: `app/Http/Controllers/SeoInsightController.php`
- Modify: `app/Domains/Seo/Policies/SeoInsightPolicy.php`
- Modify: `app/Http/Requests/Seo/SeoInsightIndexRequest.php`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php` (add SEO insight tests)

- [ ] **Step 1: Add failing tests**

Append to `ClientPortalAccessTest.php`:

```php
// ── SEO Insight scoping ───────────────────────────────────────────────

public function test_client_user_seo_insights_list_scoped_to_their_websites(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    $myInsight = \App\Domains\Seo\Models\SeoInsight::factory()->create([
        'organization_id' => $org->id,
        'website_id' => $myWebsite->id,
    ]);
    $otherInsight = \App\Domains\Seo\Models\SeoInsight::factory()->create([
        'organization_id' => $org->id,
        'website_id' => $otherWebsite->id,
    ]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('seo.insights.index', ['organization' => $org->slug]));

    $response->assertOk();
    $insightIds = collect($response->original->getData()['page']['props']['insights']['data'])->pluck('id');
    $this->assertContains($myInsight->id, $insightIds->toArray());
    $this->assertNotContains($otherInsight->id, $insightIds->toArray());
}

public function test_client_user_cannot_view_insight_for_other_clients_website(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    $otherInsight = \App\Domains\Seo\Models\SeoInsight::factory()->create([
        'organization_id' => $org->id,
        'website_id' => $otherWebsite->id,
    ]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->get(route('seo.insights.show', ['organization' => $org->slug, 'insight' => $otherInsight->id]))
        ->assertForbidden();
}

public function test_client_user_cannot_generate_seo_insights(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->post(route('seo.insights.generate', ['organization' => $org->slug]))
        ->assertForbidden();
}

public function test_client_user_cannot_update_insight_status(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $myInsight = \App\Domains\Seo\Models\SeoInsight::factory()->create([
        'organization_id' => $org->id,
        'website_id' => $myWebsite->id,
        'status' => 'pending',
    ]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->post(route('seo.insights.reviewed', ['organization' => $org->slug, 'insight' => $myInsight->id]))
        ->assertForbidden();
}

public function test_client_user_insight_website_filter_dropdown_scoped_to_their_client(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('seo.insights.index', ['organization' => $org->slug]));

    $response->assertOk();
    $websiteIds = collect($response->original->getData()['page']['props']['websites'])->pluck('id');
    $this->assertContains($myWebsite->id, $websiteIds->toArray());
    $this->assertNotContains($otherWebsite->id, $websiteIds->toArray());
}

public function test_client_user_cannot_filter_insights_by_other_clients_website(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $this->actingAs($clientUser)
        ->get(route('seo.insights.index', ['organization' => $org->slug, 'website_id' => $otherWebsite->id]))
        ->assertUnprocessable();
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --filter=insight
```
Expected: multiple FAIL — insights not scoped, no policy on individual insight view.

- [ ] **Step 3: Update `GetSeoInsightListAction`**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Pagination\LengthAwarePaginator;

class GetSeoInsightListAction
{
    /**
     * @param  list<int>|null  $allowedWebsiteIds  null = no restriction
     */
    public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): LengthAwarePaginator
    {
        $query = SeoInsight::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->with(['website', 'reviewedBy'])
            ->latest();

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['website_id'])) {
            $query->where('website_id', (int) $filters['website_id']);
        }
        if (! empty($filters['severity'])) {
            $query->where('severity', $filters['severity']);
        }
        if (! empty($filters['date_from'])) {
            $query->where('date_from', '>=', $filters['date_from']);
        }
        if (! empty($filters['date_to'])) {
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

- [ ] **Step 4: Update `SeoInsightController::index()` to scope website dropdown and pass `allowedWebsiteIds`**

```php
public function index(
    SeoInsightIndexRequest $request,
    OrganizationContextService $context,
    GetSeoInsightListAction $action,
): Response {
    $organization = $context->current();
    $allowedWebsiteIds = $context->allowedWebsiteIds();

    return Inertia::render('seo/InsightsIndex', [
        'insights' => $action->execute($organization, $request->filters(), $allowedWebsiteIds),
        'filters' => $request->filters(),
        'websites' => Website::where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
            ->select('id', 'name', 'domain')
            ->orderBy('name')
            ->get(),
        'canUpdateStatus' => $context->memberCan('approval.decide'),
    ]);
}
```

- [ ] **Step 5: Update `SeoInsightPolicy::view()` to enforce client_id ownership**

```php
<?php

declare(strict_types=1);

namespace App\Domains\Seo\Policies;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Auth\Access\HandlesAuthorization;

class SeoInsightPolicy
{
    use HandlesAuthorization;

    public function view(User $user, SeoInsight $insight): bool
    {
        $member = $user->memberships()
            ->where('organization_id', $insight->organization_id)
            ->first();

        if ($member === null || ! $member->can('report.view')) {
            return false;
        }

        if ($member->role === MemberRole::Client) {
            $insight->loadMissing('website');

            return $insight->website?->client_id === $member->client_id;
        }

        return true;
    }

    public function viewList(User $user, int $organizationId): bool
    {
        return $this->memberCan($user, $organizationId, 'report.view');
    }

    public function generate(User $user, int $organizationId): bool
    {
        return $this->memberCan($user, $organizationId, 'seo.insights.generate');
    }

    public function updateStatus(User $user, SeoInsight $insight): bool
    {
        return $this->memberCan($user, $insight->organization_id, 'approval.decide');
    }

    private function memberCan(User $user, int $organizationId, string $permission): bool
    {
        $member = $user->memberships()
            ->where('organization_id', $organizationId)
            ->first();

        return $member?->can($permission) ?? false;
    }
}
```

- [ ] **Step 6: Update `SeoInsightIndexRequest` to scope `website_id` validation for client users**

```php
public function rules(): array
{
    $context = app(OrganizationContextService::class);
    $organization = $context->current();
    $allowedWebsiteIds = $context->allowedWebsiteIds();
    $typeValues = array_column(SeoInsightType::cases(), 'value');
    $statusValues = array_column(SeoInsightStatus::cases(), 'value');

    return [
        'type' => ['nullable', 'string', Rule::in($typeValues)],
        'status' => ['nullable', 'string', Rule::in($statusValues)],
        'website_id' => [
            'nullable',
            'integer',
            Rule::exists('websites', 'id')->where(function ($query) use ($organization, $allowedWebsiteIds) {
                $query->where('organization_id', $organization?->id);
                if ($allowedWebsiteIds !== null) {
                    $query->whereIn('id', $allowedWebsiteIds);
                }
            }),
        ],
        'severity' => ['nullable', 'string', Rule::in(['low', 'medium', 'high'])],
        'date_from' => ['nullable', 'date'],
        'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],
    ];
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: all tests PASS.

- [ ] **Step 8: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 9: Commit**

```bash
git add app/Domains/Seo/Actions/GetSeoInsightListAction.php \
        app/Http/Controllers/SeoInsightController.php \
        app/Domains/Seo/Policies/SeoInsightPolicy.php \
        app/Http/Requests/Seo/SeoInsightIndexRequest.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: scope SEO insights list, policy, and website filter to client's websites for client users"
```

---

## Task 11: Dashboard stats scoping — `DashboardController`

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php` (add dashboard test)

- [ ] **Step 1: Add failing test**

Append to `ClientPortalAccessTest.php`:

```php
// ── Dashboard stats scoping ───────────────────────────────────────────

public function test_client_user_dashboard_stats_reflect_their_client_only(): void
{
    [$org, $owner] = $this->createOrgWithOwner();
    $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $owner->id]);
    Website::factory()->count(2)->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $owner->id]);
    Website::factory()->count(3)->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $owner->id]);
    [$clientUser] = $this->createClientUser($org, $myClient);

    $response = $this->actingAs($clientUser)
        ->get(route('dashboard', ['organization' => $org->slug]));

    $response->assertOk();
    $stats = $response->original->getData()['page']['props']['stats'];
    $this->assertEquals(1, $stats['clients']);
    $this->assertEquals(2, $stats['websites']);
}
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --filter=dashboard_stats
```
Expected: FAIL — stats show all org data.

- [ ] **Step 3: Update `DashboardController`**

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Clients\Models\Website;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __invoke(Request $request, OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $member = $context->currentMember();
        $clientId = $context->currentClientId();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        return Inertia::render('Dashboard', [
            'organization' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'slug' => $organization->slug,
                'timezone' => $organization->timezone,
            ],
            'member' => [
                'role' => $member->role->value,
                'label' => $member->role->label(),
            ],
            'stats' => [
                'clients' => $clientId !== null
                    ? 1
                    : $organization->clients()->count(),
                'websites' => $allowedWebsiteIds !== null
                    ? count($allowedWebsiteIds)
                    : Website::where('organization_id', $organization->id)->count(),
            ],
        ]);
    }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php
```
Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/DashboardController.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: scope dashboard stats to client's data for client users"
```

---

## Task 12: AppLayout.tsx sidebar — hide Members and Settings for client role

**Files:**
- Modify: `resources/js/layouts/AppLayout.tsx`

- [ ] **Step 1: Update `AppLayout.tsx`**

Replace the `navItems` block:

```tsx
const isClientUser = currentOrganization?.role === 'client';

const navItems = slug
    ? [
        { label: 'Dashboard',    href: safeRoute('dashboard',             { organization: slug }) },
        { label: 'Clients',      href: safeRoute('clients.index',         { organization: slug }) },
        { label: 'Websites',     href: safeRoute('websites.index',        { organization: slug }) },
        { label: 'Integrations', href: safeRoute('integrations.index',    { organization: slug }) },
        { label: 'SEO',          href: safeRoute('seo.index',             { organization: slug }) },
        { label: 'SEO Insights', href: safeRoute('seo.insights.index',    { organization: slug }) },
        ...(!isClientUser
            ? [
                { label: 'Members',  href: safeRoute('organization.members',  { organization: slug }) },
                { label: 'Settings', href: safeRoute('organization.settings', { organization: slug }) },
              ]
            : []),
      ]
    : [];
```

The full `AppLayout.tsx` becomes:

```tsx
import React from 'react';
import { Link, usePage } from '@inertiajs/react';
import type { User, Organization } from '@/types/models';

interface SharedProps {
    auth: {
        user: User;
    };
    currentOrganization?: Organization & { role: string };
    userOrganizations?: Array<{ id: number; name: string; slug: string; role: string }>;
    flash?: {
        success?: string;
        error?: string;
    };
}

interface AppLayoutProps {
    children: React.ReactNode;
    title?: string;
}

function safeRoute(name: string, params: Record<string, string | number>): string {
    try {
        return route(name, params);
    } catch {
        return '#';
    }
}

export default function AppLayout({ children, title }: AppLayoutProps) {
    const page = usePage();
    const { auth, currentOrganization, flash } =
        page.props as unknown as SharedProps;
    const currentUrl = page.url;

    const urlSlug = currentUrl.split('/').filter(Boolean)[0] ?? '';
    const isOrgUrl = urlSlug !== '' && urlSlug !== 'organizations' && urlSlug !== 'invitations' && urlSlug !== 'health';
    const slug = currentOrganization?.slug ?? (isOrgUrl ? urlSlug : '');
    const isClientUser = currentOrganization?.role === 'client';

    const navItems = slug
        ? [
            { label: 'Dashboard',    href: safeRoute('dashboard',             { organization: slug }) },
            { label: 'Clients',      href: safeRoute('clients.index',         { organization: slug }) },
            { label: 'Websites',     href: safeRoute('websites.index',        { organization: slug }) },
            { label: 'Integrations', href: safeRoute('integrations.index',    { organization: slug }) },
            { label: 'SEO',          href: safeRoute('seo.index',             { organization: slug }) },
            { label: 'SEO Insights', href: safeRoute('seo.insights.index',    { organization: slug }) },
            ...(!isClientUser
                ? [
                    { label: 'Members',  href: safeRoute('organization.members',  { organization: slug }) },
                    { label: 'Settings', href: safeRoute('organization.settings', { organization: slug }) },
                  ]
                : []),
          ]
        : [];

    return (
        <div className="min-h-screen bg-gray-50 flex">
            <aside className="w-64 bg-slate-900 text-white flex flex-col">
                <div className="px-6 py-5 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <span className="font-bold text-sm">ULTRON-B AI</span>
                    </div>
                </div>

                {currentOrganization && (
                    <div className="px-4 py-3 border-b border-slate-800">
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Organization</p>
                        <p className="text-sm font-medium text-white truncate">{currentOrganization.name}</p>
                        <p className="text-xs text-slate-400 capitalize">{currentOrganization.role}</p>
                    </div>
                )}

                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = item.href !== '#' && currentUrl.startsWith(item.href);
                        return (
                            <Link
                                key={item.label}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    isActive
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                                }`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="px-4 py-4 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{auth?.user?.name}</p>
                            <p className="text-xs text-slate-400 truncate">{auth?.user?.email}</p>
                        </div>
                        <Link
                            href={route('logout')}
                            method="post"
                            as="button"
                            className="ml-2 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                            Sign out
                        </Link>
                    </div>
                </div>
            </aside>

            <div className="flex-1 flex flex-col min-w-0">
                <header className="bg-white border-b border-gray-200 px-8 py-4">
                    <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
                </header>

                {flash?.success && (
                    <div className="mx-8 mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                        {flash.success}
                    </div>
                )}
                {flash?.error && (
                    <div className="mx-8 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                        {flash.error}
                    </div>
                )}

                <main className="flex-1 p-8">{children}</main>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add resources/js/layouts/AppLayout.tsx
git commit -m "feat: hide Members and Settings nav for client role users"
```

---

## Task 13: Final verification and sprint docs

- [ ] **Step 1: Run full test suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected: all tests pass including all new `ClientPortalAccessTest` tests.

- [ ] **Step 2: Run Pint formatter check**

```bash
docker compose exec ultron-app ./vendor/bin/pint --test
```
If any violations, run `./vendor/bin/pint` without `--test` to fix them, then commit.

- [ ] **Step 3: TypeScript check**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Build**

```bash
npm run build
```
Expected: success.

- [ ] **Step 5: Update `docs/sprint-status.md` and `docs/AI_HANDOFF.md`**

Add Sprint 15 entry to `docs/sprint-status.md`.
Update `docs/AI_HANDOFF.md` header, Completed Modules, and Handoff sections.

- [ ] **Step 6: Commit docs**

```bash
git add docs/sprint-status.md docs/AI_HANDOFF.md
git commit -m "docs: update handoff and sprint status for Sprint 15 completion"
```

---

## Spec Coverage Self-Review

| Requirement | Covered by |
|-------------|------------|
| Owner/admin behavior unchanged | Tested implicitly — all existing tests unmodified and still pass |
| Client user only sees their assigned client | Task 6 (`test_client_user_only_sees_their_assigned_client_in_index`) |
| Client user only sees their websites | Task 7 (`test_client_user_only_sees_websites_for_their_client`) |
| Client user only sees their integrations | Task 8 (`test_client_user_only_sees_integrations_for_their_websites`) |
| Client user cannot connect/disconnect integrations | Task 8 (`test_client_user_cannot_connect_integration`) |
| Client user SEO dashboard scoped to their websites | Task 9 (`test_client_user_seo_dashboard_website_list_scoped_to_their_client`) |
| Client user cannot filter SEO by another client's website | Task 9 (`test_client_user_cannot_filter_seo_dashboard_by_other_clients_website`) |
| Client user SEO insights scoped to their websites | Task 10 (`test_client_user_seo_insights_list_scoped_to_their_websites`) |
| Client user cannot view another client's insight | Task 10 (`test_client_user_cannot_view_insight_for_other_clients_website`) |
| Client user cannot generate insights | Task 10 (`test_client_user_cannot_generate_seo_insights`) |
| Client user cannot update insight status | Task 10 (`test_client_user_cannot_update_insight_status`) |
| Client user cannot create/update/delete clients | Task 6 (`test_client_user_cannot_create_client`, etc.) |
| Client user cannot create/update websites | Task 7 (`test_client_user_cannot_create_website`, etc.) |
| Dashboard stats scoped to client | Task 11 (`test_client_user_dashboard_stats_reflect_their_client_only`) |
| Sidebar hides Members and Settings | Task 12 (TypeScript / AppLayout) |
| Invitation flow supports client role + client_id | Task 4 (invitation tests) |
| No deployment / .env / GA4 / GSC / push changes | Not in any task ✓ |
