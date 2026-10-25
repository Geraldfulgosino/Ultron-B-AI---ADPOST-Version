# Phase F — Production Readiness + Client Portal UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ULTRON-B AI safer to operate and friendlier for client-role users without touching report/export data logic — add a consolidated production readiness checklist, close a real data-exposure gap in the organization members page, render friendly Inertia error pages instead of raw Laravel error pages, fix a sidebar active-state bug, hide non-actionable admin forms from read-only roles, and polish Reports export/empty-state copy.

**Architecture:** Backend changes are small, additive policy/controller guards and a single `Exceptions::respond()` interceptor in `bootstrap/app.php` that swaps matching HTTP error responses for an Inertia-rendered `errors/Error` page. Frontend changes are presentational only (conditional rendering, copy, one active-state calculation) inside existing pages — no new dependencies, no new page architecture, no change to `GetReportPreviewAction`, `BuildReportCsvAction`, or `BuildReportPdfAction`.

**Tech Stack:** PHP 8.4 / Laravel 13, Inertia.js v2, React 19 + TypeScript, Tailwind CSS v4, PHPUnit (`php artisan test`). No new Composer or npm packages.

---

## Pre-flight findings (from inspection)

- Client Portal Access Control (Sprint 15's recommendation) is **already built**: `MemberRole::Client`, `OrganizationContextService::allowedWebsiteIds()`, and `tests/Feature/ClientPortal/ClientPortalAccessTest.php` scope clients/websites/integrations/reports correctly. `docs/sprint-status.md`'s "Sprint 15 Recommendations" section is stale and will need a follow-up note (not part of this plan — flagged for the next docs pass).
- **Real gap found:** `OrganizationController::members()` authorizes with `$this->authorize('view', $organization)`, which only requires being *any* member — including `client` role. A client-portal user can navigate directly to `/{organization}/members` and see every internal staff member's name, email, and role. `Settings` is already safe (`update` ability, admin/owner only). This plan fixes `members()` only; behavior for owner/admin/member/viewer is unchanged.
- **Real bug found:** `AppLayout.tsx`'s active-link check is `currentUrl.startsWith(item.href)`. Because `/{slug}/seo` is a string-prefix of `/{slug}/seo/insights`, visiting any SEO Insights page highlights **both** "SEO" and "SEO Insights" in the sidebar simultaneously.
- No frontend test runner exists (`package.json` has no Jest/Vitest/RTL) — frontend-only changes are verified via `npm run typecheck`, `npm run build`, and manual browser QA, consistent with how Sprint 14's slug-fallback changes were verified.
- `clients/Index.tsx`, `websites/Index.tsx`, and `integrations/Index.tsx` already compute `canCreate`/`canManage`/`canConnect` server-side and disable form fields when false, but they still render the **entire** admin form (all fields, "Continue with Google", etc.) to read-only roles (client and viewer both get `false` for all three flags). This plan replaces the disabled form with a short read-only notice for those roles.
- `bootstrap/app.php` has no `Exceptions::respond()` handler, so 403/404/etc. abort the Inertia SPA into a raw, unstyled Laravel error response (Inertia does a full browser navigation to display it).

---

## File Map

| Action | Path |
|--------|------|
| Create | `docs/production-readiness-checklist.md` |
| Modify | `app/Domains/Organizations/Policies/OrganizationPolicy.php` |
| Modify | `app/Http/Controllers/OrganizationController.php` |
| Modify | `tests/Feature/ClientPortal/ClientPortalAccessTest.php` |
| Modify | `bootstrap/app.php` |
| Create | `resources/js/pages/errors/Error.tsx` |
| Create | `tests/Feature/ErrorPages/FriendlyErrorPageTest.php` |
| Modify | `resources/js/layouts/AppLayout.tsx` |
| Modify | `resources/js/pages/clients/Index.tsx` |
| Modify | `resources/js/pages/websites/Index.tsx` |
| Modify | `resources/js/pages/integrations/Index.tsx` |
| Modify | `resources/js/pages/Dashboard.tsx` |
| Modify | `resources/js/pages/reports/Index.tsx` |
| Modify | `docs/sprint-status.md` |
| Modify | `docs/AI_HANDOFF.md` |

---

## Phase F.1 — Production Readiness Documentation

### Task 1: Create consolidated production readiness checklist

**Files:**
- Create: `docs/production-readiness-checklist.md`

- [ ] **Step 1: Create the doc**

```markdown
# Production Readiness Checklist

A single-page pre-launch reference for ULTRON-B AI. This consolidates the
required `.env` variables, Google OAuth, mail, queue, scheduler, storage,
and Docker requirements already documented in detail elsewhere — use this
page to confirm nothing is missing, then follow the linked docs for exact
commands.

## 1. Required Environment Variables

Copy `.env.example` to `.env` and set `APP_KEY` via `php artisan key:generate`.
Every variable below is annotated with a `# PRODUCTION:` comment in
`.env.example` — search for that string to find every value that must change
before launch.

| Variable | Local default | Production requirement |
|----------|---------------|-------------------------|
| `APP_ENV` | `local` | `production` |
| `APP_DEBUG` | `true` | `false` |
| `APP_URL` | `http://localhost` | Your HTTPS domain |
| `LOG_LEVEL` | `debug` | `error` or `warning` |
| `DB_PASSWORD` / `DB_ROOT_PASSWORD` | weak defaults | strong, unique passwords |
| `DB_EXTERNAL_PORT` | `3306` | bind to `127.0.0.1` or remove — never expose publicly |
| `SESSION_SECURE_COOKIE` | `false` | `true` (HTTPS only) |
| `REDIS_PASSWORD` | `null` | strong password, `requirepass` enabled |
| `REDIS_EXTERNAL_PORT` | `6379` | bind to `127.0.0.1` or remove |
| `MAIL_MAILER` | `log` | a real mailer (`smtp`, `mailgun`, `ses`, `postmark`) |
| `N8N_ENCRYPTION_KEY` | placeholder | securely generated 32+ char key |
| `N8N_DB_PASSWORD` | weak default | strong, unique password |

Run `php artisan ultron:env:validate` after setting production values — it
fails (exit 1) if `APP_DEBUG`, `APP_URL`, `QUEUE_CONNECTION`, `SESSION_DRIVER`,
`SESSION_SECURE_COOKIE`, or `REDIS_PASSWORD` are not production-safe.

## 2. Google OAuth Setup

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in
`.env`. Without these, the Integrations page still works but only creates a
"pending placeholder" connection — no real GA4/Search Console data will sync.
`GOOGLE_REDIRECT_URI` must exactly match an authorized redirect URI configured
in the Google Cloud Console OAuth client (`{APP_URL}/auth/google/callback` by
default).

## 3. Mail Configuration

`MAIL_MAILER=log` (the local default) writes emails to the log file instead
of sending them — invitations and password resets will not be delivered.
Set a real mailer and `MAIL_FROM_ADDRESS`/`MAIL_FROM_NAME` before inviting
real users in production.

## 4. Queue Worker Requirement

`QUEUE_CONNECTION=redis` is required — analytics sync jobs, invitation
emails, and other queued work never run without a queue worker. The
`ultron-queue` Docker service runs `php artisan queue:work --sleep=3 --tries=3
--max-time=3600` with `restart: unless-stopped`. Confirm it is processing
jobs after deploy:

```bash
docker compose exec ultron-app php artisan queue:monitor redis
docker compose logs ultron-queue --tail=50
```

Note: `ultron-queue` can briefly crash-loop immediately after `docker compose
up -d` if Redis's container DNS hasn't propagated yet. `restart:
unless-stopped` recovers it automatically within about a minute — this is
expected, not a deployment failure (observed during Sprint 16 Phase E QA).

## 5. Scheduler Requirement

The `ultron-scheduler` Docker service runs `php artisan schedule:run
--verbose --no-interaction` every 60 seconds via a shell loop. No automatic
analytics sync cadence is currently registered in `routes/console.php` —
this is a known gap (see `docs/AI_HANDOFF.md` Known Issues). Confirm the
scheduler container is up:

```bash
docker compose ps ultron-scheduler
```

## 6. Storage Link Requirement

Run once per environment (idempotent — safe to re-run):

```bash
docker compose exec ultron-app php artisan storage:link
```

Required for any user-uploaded/public files served from `storage/app/public`.
Reports PDF/CSV exports are streamed directly in the HTTP response and do
**not** depend on the storage symlink.

## 7. Docker Deployment Notes

- Build the frontend (`npm run build`) **before** building the production
  image — `public/build` is git-ignored and the production Docker target
  does not run Vite.
- Use `docker-compose.production.yml` as an override
  (`docker compose -f docker-compose.yml -f docker-compose.production.yml
  up -d`) — it resets development bind mounts, mounts `./public` read-only
  into Caddy, enables Redis auth, and keeps MySQL/Redis/n8n off public ports.
- Run migrations, then warm caches:

```bash
docker compose exec ultron-app php artisan migrate --force
docker compose exec ultron-app php artisan config:cache
docker compose exec ultron-app php artisan route:cache
docker compose exec ultron-app php artisan view:cache
```

## Related Documents

| Doc | Purpose |
|-----|---------|
| `docs/production-deployment.md` | Full VPS deployment guide |
| `docs/security-checklist.md` | Pre-launch security checklist |
| `docs/backup-strategy.md` | Database/storage backup strategy |
| `docs/deployment-dry-run.md` | Pre-deployment dry-run checklist |
| `docs/vps-preflight.md` | Server-level VPS preflight checklist |
| `docs/vps-launch-commands.md` | Ordered launch commands with expected output |
| `docs/smoke-tests.md` | Post-deployment smoke tests |
| `docs/first-admin-setup.md` | Creating the first admin user |
| `docs/deployment-rollback.md` | Rollback procedure |
```

- [ ] **Step 2: Commit**

```bash
git add docs/production-readiness-checklist.md
git commit -m "docs: add production readiness checklist (Phase F.1)"
```

---

## Phase F.2 — Safety & Error Handling

### Task 2: Stop client-role users from viewing the organization members page

**Files:**
- Modify: `app/Domains/Organizations/Policies/OrganizationPolicy.php`
- Modify: `app/Http/Controllers/OrganizationController.php`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php`

- [ ] **Step 1: Write the failing tests**

Add to `tests/Feature/ClientPortal/ClientPortalAccessTest.php`, inside the
class, after the existing "Integration list" section:

```php
    // ── Organization members page ───────────────────────────────────────────

    public function test_client_user_cannot_view_organization_members_page(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertForbidden();
    }

    public function test_admin_can_still_view_organization_members_page(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertOk();
    }
```

- [ ] **Step 2: Run tests to confirm the first one fails**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --no-coverage
```

Expected: `test_client_user_cannot_view_organization_members_page` FAILS
(currently returns 200, not 403); `test_admin_can_still_view_organization_members_page`
already passes.

- [ ] **Step 3: Add the `viewMembers` policy method**

In `app/Domains/Organizations/Policies/OrganizationPolicy.php`, add a new
method after `view()`:

```php
    public function viewMembers(User $user, Organization $organization): bool
    {
        $member = $organization->members()->where('user_id', $user->id)->first();

        return $member !== null && ! $member->isClientUser();
    }
```

- [ ] **Step 4: Use the new ability in the controller**

In `app/Http/Controllers/OrganizationController.php`, change the `members()`
method's authorization line:

```php
    public function members(Request $request, OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $this->authorize('viewMembers', $organization);
```

(replacing `$this->authorize('view', $organization);`)

- [ ] **Step 5: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --no-coverage
```

Expected: all tests in the file pass.

- [ ] **Step 6: Run the full suite to confirm no regression**

```bash
docker compose exec ultron-app php artisan test --no-coverage
```

Expected: all tests pass (237 + 2 new = 239).

- [ ] **Step 7: Commit**

```bash
git add app/Domains/Organizations/Policies/OrganizationPolicy.php \
        app/Http/Controllers/OrganizationController.php \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "fix: deny client-role users access to organization members page"
```

### Task 3: Friendly Inertia error pages for 403/404/429/500/503

**Files:**
- Modify: `bootstrap/app.php`
- Create: `resources/js/pages/errors/Error.tsx`
- Create: `tests/Feature/ErrorPages/FriendlyErrorPageTest.php`

- [ ] **Step 1: Write the failing tests**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\ErrorPages;

use App\Domains\Clients\Models\Client;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FriendlyErrorPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_client_access_violation_renders_friendly_403_page(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertForbidden()
            ->assertInertia(fn ($page) => $page
                ->component('errors/Error')
                ->where('status', 403)
            );
    }

    public function test_nonexistent_organization_renders_friendly_404_page(): void
    {
        [, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get('/this-org-does-not-exist/dashboard')
            ->assertNotFound()
            ->assertInertia(fn ($page) => $page
                ->component('errors/Error')
                ->where('status', 404)
            );
    }

    public function test_health_endpoint_is_unaffected_by_error_page_handling(): void
    {
        $this->get('/health')
            ->assertOk()
            ->assertJson(['status' => 'ok']);
    }
}
```

- [ ] **Step 2: Run tests to confirm the first two fail**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ErrorPages/FriendlyErrorPageTest.php --no-coverage
```

Expected: `test_client_access_violation_renders_friendly_403_page` and
`test_nonexistent_organization_renders_friendly_404_page` FAIL (no
`errors/Error` component is rendered today — Inertia gets a raw Laravel
error response). `test_health_endpoint_is_unaffected_by_error_page_handling`
already passes.

- [ ] **Step 3: Add the `respond()` exception handler**

Replace the `->withExceptions(...)` block in `bootstrap/app.php`:

```php
<?php

use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\RedirectIfAuthenticated;
use App\Http\Middleware\SetActiveOrganization;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);

        $middleware->alias([
            'org' => SetActiveOrganization::class,
            'guest' => RedirectIfAuthenticated::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );

        // Render a friendly Inertia error page instead of a raw Laravel/Symfony
        // error response for 403/404/429/500/503, so client-portal access
        // violations and other errors stay inside the app shell instead of
        // forcing a jarring full-page navigation to an unstyled error page.
        $exceptions->respond(function (Response $response, Throwable $exception, Request $request) {
            if ($request->is('api/*')) {
                return $response;
            }

            $status = $response->getStatusCode();

            if ($status === 419) {
                return back()->with('error', 'The page expired. Please try again.');
            }

            if (! in_array($status, [403, 404, 429, 500, 503], true)) {
                return $response;
            }

            return Inertia::render('errors/Error', ['status' => $status])
                ->toResponse($request)
                ->setStatusCode($status);
        });
    })->create();
```

- [ ] **Step 4: Create the React error page**

```tsx
import React from 'react';
import { Head, Link, usePage } from '@inertiajs/react';

interface ErrorProps {
    status: number;
}

interface SharedProps {
    currentOrganization?: { slug: string } | null;
    userOrganizations?: Array<{ slug: string }>;
}

const TITLES: Record<number, string> = {
    403: 'Access denied',
    404: 'Page not found',
    429: 'Too many requests',
    500: 'Something went wrong',
    503: 'Service unavailable',
};

const MESSAGES: Record<number, string> = {
    403: "You don't have permission to view this page or resource.",
    404: "We couldn't find what you were looking for.",
    429: 'Please wait a moment before trying again.',
    500: 'We hit an unexpected error on our end. Please try again shortly.',
    503: "We're temporarily down for maintenance. Please try again shortly.",
};

export default function ErrorPage({ status }: ErrorProps) {
    const { currentOrganization, userOrganizations = [] } = usePage().props as unknown as SharedProps;
    const homeSlug = currentOrganization?.slug ?? userOrganizations[0]?.slug ?? null;
    const title = TITLES[status] ?? 'Unexpected error';
    const message = MESSAGES[status] ?? 'Something unexpected happened. Please try again.';

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
            <Head title={title} />
            <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                <p className="text-sm font-semibold text-indigo-600">Error {status}</p>
                <h1 className="mt-2 text-xl font-bold text-gray-900">{title}</h1>
                <p className="mt-2 text-sm text-gray-500">{message}</p>
                <div className="mt-6">
                    {homeSlug ? (
                        <Link
                            href={route('dashboard', { organization: homeSlug })}
                            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                        >
                            Back to dashboard
                        </Link>
                    ) : (
                        <Link
                            href={route('login')}
                            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                        >
                            Back to login
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ErrorPages/FriendlyErrorPageTest.php --no-coverage
```

Expected: all 3 tests pass.

- [ ] **Step 6: Run the full suite, typecheck, and build**

```bash
docker compose exec ultron-app php artisan test --no-coverage
npm run typecheck
npm run build
```

Expected: all pass; 0 TypeScript errors; build succeeds.

- [ ] **Step 7: Manual browser QA**

As a client-role user, visit `/{organization}/members` directly — confirm
the styled "Access denied" card renders inside the page (not a raw Laravel
error page), and "Back to dashboard" returns to the client's dashboard.

- [ ] **Step 8: Commit**

```bash
git add bootstrap/app.php resources/js/pages/errors/Error.tsx tests/Feature/ErrorPages/FriendlyErrorPageTest.php
git commit -m "feat: render friendly Inertia error pages for 403/404/429/500/503"
```

---

## Phase F.3 — Client Portal & Navigation UX Polish

### Task 4: Fix sidebar active-state collision between SEO and SEO Insights

**Files:**
- Modify: `resources/js/layouts/AppLayout.tsx`

- [ ] **Step 1: Replace the per-item active check with a longest-match calculation**

In `resources/js/layouts/AppLayout.tsx`, replace:

```ts
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = item.href !== '#' && currentUrl.startsWith(item.href);
                        return (
```

with:

```ts
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {(() => {
                        // Pick the longest matching href so nested routes (e.g. "/seo" vs
                        // "/seo/insights") only highlight their own, most specific nav item.
                        const activeHref = navItems.reduce<string | null>((best, item) => {
                            if (item.href === '#') return best;
                            const matches = currentUrl === item.href || currentUrl.startsWith(`${item.href}/`);
                            if (!matches) return best;
                            return best === null || item.href.length > best.length ? item.href : best;
                        }, null);

                        return navItems.map((item) => {
                            const isActive = item.href === activeHref;
                            return (
```

Then close the new IIFE after the existing `.map()` closing — find:

```ts
                            </Link>
                        );
                    })}
                </nav>
```

and replace with:

```ts
                            </Link>
                            );
                        });
                    })()}
                </nav>
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: 0 errors; build succeeds.

- [ ] **Step 3: Manual browser QA**

Visit `/{organization}/seo`, confirm only "SEO" is highlighted. Visit
`/{organization}/seo/insights`, confirm only "SEO Insights" is highlighted
(not also "SEO"). Visit `/{organization}/seo/insights/{id}`, confirm "SEO
Insights" stays the only highlighted item.

- [ ] **Step 4: Commit**

```bash
git add resources/js/layouts/AppLayout.tsx
git commit -m "fix: highlight only the most specific sidebar nav item"
```

### Task 5: Hide non-actionable admin forms from read-only roles

**Files:**
- Modify: `resources/js/pages/clients/Index.tsx`
- Modify: `resources/js/pages/websites/Index.tsx`
- Modify: `resources/js/pages/integrations/Index.tsx`
- Modify: `tests/Feature/ClientPortal/ClientPortalAccessTest.php`

`canCreate`/`canManage`/`canConnect` are already `false` for both `viewer`
and `client` roles (`client.create`, `client.manage`, `website.create`,
`website.manage`, `integration.connect` are all admin/member-only
permissions). Today the full form still renders, fully disabled, with all
fields and admin-oriented labels ("Continue with Google", "Save client").
This task replaces the disabled form with a short read-only notice for
those roles — pure presentation change, no permission logic changes.

- [ ] **Step 1: Write the failing tests**

Add to `tests/Feature/ClientPortal/ClientPortalAccessTest.php`, after the
members-page tests added in Task 2:

```php
    // ── Read-only permission flags ──────────────────────────────────────────

    public function test_client_user_cannot_create_or_manage_clients(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', false)
                ->where('canManage', false)
            );
    }

    public function test_admin_can_create_and_manage_clients(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', true)
                ->where('canManage', true)
            );
    }

    public function test_client_user_cannot_connect_integrations(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('canConnect', false));
    }
```

- [ ] **Step 2: Run tests**

```bash
docker compose exec ultron-app php artisan test tests/Feature/ClientPortal/ClientPortalAccessTest.php --no-coverage
```

Expected: all pass already (these document existing backend behavior the
frontend change below relies on — no backend code changes in this task).

- [ ] **Step 3: Update `clients/Index.tsx`**

Replace the right-hand form `Card` (currently always rendering `ClientForm`)
with a conditional. Replace:

```tsx
                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">{editing ? 'Edit client' : 'New client'}</h3>
                    </CardHeader>
                    <CardContent>
                        {editing ? (
                            <ClientForm
                                data={editForm.data}
                                errors={editForm.errors}
                                processing={editForm.processing}
                                canSubmit={canManage}
                                onSubmit={update}
                                onCancel={() => setEditing(null)}
                                setData={editForm.setData}
                            />
                        ) : (
                            <ClientForm
                                data={createForm.data}
                                errors={createForm.errors}
                                processing={createForm.processing}
                                canSubmit={canCreate}
                                onSubmit={store}
                                setData={createForm.setData}
                            />
                        )}
                    </CardContent>
                </Card>
```

with:

```tsx
                {canCreate || canManage ? (
                    <Card>
                        <CardHeader>
                            <h3 className="text-base font-semibold text-gray-900">{editing ? 'Edit client' : 'New client'}</h3>
                        </CardHeader>
                        <CardContent>
                            {editing ? (
                                <ClientForm
                                    data={editForm.data}
                                    errors={editForm.errors}
                                    processing={editForm.processing}
                                    canSubmit={canManage}
                                    onSubmit={update}
                                    onCancel={() => setEditing(null)}
                                    setData={editForm.setData}
                                />
                            ) : (
                                <ClientForm
                                    data={createForm.data}
                                    errors={createForm.errors}
                                    processing={createForm.processing}
                                    canSubmit={canCreate}
                                    onSubmit={store}
                                    setData={createForm.setData}
                                />
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-sm font-medium text-gray-900">Read-only access</p>
                            <p className="mt-1 text-sm text-gray-500">Your role can view clients but cannot create or edit them.</p>
                        </CardContent>
                    </Card>
                )}
```

- [ ] **Step 4: Update `websites/Index.tsx`**

Replace the right-hand form `Card`:

```tsx
                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">{editing ? 'Edit website' : 'New website'}</h3>
                    </CardHeader>
                    <CardContent>
                        <WebsiteForm
                            data={editing ? editForm.data : createForm.data}
                            errors={editing ? editForm.errors : createForm.errors}
                            processing={editing ? editForm.processing : createForm.processing}
                            clients={clients}
                            canSubmit={editing ? canManage : canCreate}
                            onSubmit={editing ? update : store}
                            onCancel={editing ? () => setEditing(null) : undefined}
                            setData={editing ? editForm.setData : createForm.setData}
                        />
                    </CardContent>
                </Card>
```

with:

```tsx
                {canCreate || canManage ? (
                    <Card>
                        <CardHeader>
                            <h3 className="text-base font-semibold text-gray-900">{editing ? 'Edit website' : 'New website'}</h3>
                        </CardHeader>
                        <CardContent>
                            <WebsiteForm
                                data={editing ? editForm.data : createForm.data}
                                errors={editing ? editForm.errors : createForm.errors}
                                processing={editing ? editForm.processing : createForm.processing}
                                clients={clients}
                                canSubmit={editing ? canManage : canCreate}
                                onSubmit={editing ? update : store}
                                onCancel={editing ? () => setEditing(null) : undefined}
                                setData={editing ? editForm.setData : createForm.setData}
                            />
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-sm font-medium text-gray-900">Read-only access</p>
                            <p className="mt-1 text-sm text-gray-500">Your role can view websites but cannot create or edit them.</p>
                        </CardContent>
                    </Card>
                )}
```

- [ ] **Step 5: Update `integrations/Index.tsx`**

Replace the "Connect Google" `Card` (the whole card, including its header):

```tsx
                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">Connect Google</h3>
                        <p className="mt-1 text-sm text-gray-500">Choose the provider and the scope this connection should serve.</p>
                    </CardHeader>
                    <CardContent>
                        {!googleConfigured && (
                            <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                                Google OAuth credentials are not configured. Submitting creates a pending placeholder only.
                            </div>
                        )}
                        {!canConnect && (
                            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                                Your role can view integrations but cannot connect new data sources.
                            </div>
                        )}
                        <form onSubmit={submit} className="space-y-4">
```

with (note `{!canConnect && (...)}` block is removed since that case is now
handled by the `: (` branch entirely):

```tsx
                {canConnect ? (
                    <Card>
                        <CardHeader>
                            <h3 className="text-base font-semibold text-gray-900">Connect Google</h3>
                            <p className="mt-1 text-sm text-gray-500">Choose the provider and the scope this connection should serve.</p>
                        </CardHeader>
                        <CardContent>
                            {!googleConfigured && (
                                <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                                    Google OAuth credentials are not configured. Submitting creates a pending placeholder only.
                                </div>
                            )}
                            <form onSubmit={submit} className="space-y-4">
```

...and at the end of that same card, replace the closing tags:

```tsx
                            <Button type="submit" loading={form.processing} disabled={!canConnect}>
                                Continue with Google
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
```

with:

```tsx
                            <Button type="submit" loading={form.processing}>
                                Continue with Google
                            </Button>
                        </form>
                    </CardContent>
                </Card>
                ) : (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-sm font-medium text-gray-900">Read-only access</p>
                            <p className="mt-1 text-sm text-gray-500">Your role can view integrations but cannot connect new data sources.</p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </AppLayout>
    );
}
```

Also remove the now-unreachable `disabled={!canConnect}` props from the
`<select>` elements inside the form (they are only rendered when
`canConnect` is `true` now), and drop `canConnect` from the `Button`'s
`disabled` prop as shown above.

- [ ] **Step 6: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: 0 errors; build succeeds.

- [ ] **Step 7: Run full backend suite**

```bash
docker compose exec ultron-app php artisan test --no-coverage
```

Expected: all pass.

- [ ] **Step 8: Manual browser QA**

As a client-role user: visit Clients, Websites, and Integrations pages —
confirm each shows a short "Read-only access" notice instead of a disabled
form. As an admin: confirm all three pages render their forms exactly as
before (no behavior change).

- [ ] **Step 9: Commit**

```bash
git add resources/js/pages/clients/Index.tsx \
        resources/js/pages/websites/Index.tsx \
        resources/js/pages/integrations/Index.tsx \
        tests/Feature/ClientPortal/ClientPortalAccessTest.php
git commit -m "feat: replace disabled admin forms with read-only notices for client/viewer roles"
```

### Task 6: Clarify Dashboard "Getting started" wording for client role

**Files:**
- Modify: `resources/js/pages/Dashboard.tsx`

- [ ] **Step 1: Update the getting-started step 3 label**

In `resources/js/pages/Dashboard.tsx`, replace:

```tsx
                                { step: 3, label: 'Connect Google data sources', done: connectedIntegrationsCount > 0 },
```

with:

```tsx
                                { step: 3, label: isClient ? 'Your agency connects data sources' : 'Connect Google data sources', done: connectedIntegrationsCount > 0 },
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: 0 errors; build succeeds.

- [ ] **Step 3: Manual browser QA**

As a client-role user, confirm the Dashboard "Getting started" card reads
"Your agency connects data sources" instead of an action the client cannot
take.

- [ ] **Step 4: Commit**

```bash
git add resources/js/pages/Dashboard.tsx
git commit -m "fix: clarify dashboard getting-started copy for client role"
```

---

## Phase F.4 — Reports UX Polish

### Task 7: Clearer export labels, CSV-vs-PDF help text, friendlier empty state

**Files:**
- Modify: `resources/js/pages/reports/Index.tsx`

No changes to `filters`, `route()` calls, query params, or any data prop —
only button labels, `title` tooltips, a caption, and empty-state copy.

- [ ] **Step 1: Update the export buttons**

Replace:

```tsx
                        <div className="flex items-center gap-2 self-end">
                            <a
                                href={route('reports.export', {
                                    organization: orgSlug,
                                    ...(filters.website_id !== null ? { website_id: filters.website_id } : {}),
                                    date_from: filters.date_from,
                                    date_to: filters.date_to,
                                    source: filters.source,
                                })}
                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                Export CSV
                            </a>
                            <a
                                href={exportPdfUrl(orgSlug, filters)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 transition-colors"
                            >
                                Export PDF
                            </a>
                        </div>
```

with:

```tsx
                        <div className="flex flex-col items-end gap-1 self-end">
                            <div className="flex items-center gap-2">
                                <a
                                    href={route('reports.export', {
                                        organization: orgSlug,
                                        ...(filters.website_id !== null ? { website_id: filters.website_id } : {}),
                                        date_from: filters.date_from,
                                        date_to: filters.date_to,
                                        source: filters.source,
                                    })}
                                    title="Download a CSV spreadsheet of this report for further analysis"
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    Download CSV (spreadsheet)
                                </a>
                                <a
                                    href={exportPdfUrl(orgSlug, filters)}
                                    title="Download a formatted PDF version of this report for sharing or printing"
                                    className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 transition-colors"
                                >
                                    Download PDF (formatted report)
                                </a>
                            </div>
                            <p className="text-xs text-gray-400">CSV for spreadsheets and data analysis &middot; PDF for sharing or printing</p>
                        </div>
```

- [ ] **Step 2: Update the empty state copy**

Replace:

```tsx
                {!has_report_data ? (
                    <Card>
                        <CardContent>
                            <p className="py-8 text-center text-sm text-gray-500">
                                No report data for selected range.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
```

with:

```tsx
                {!has_report_data ? (
                    <Card>
                        <CardContent>
                            <div className="py-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No report data for this range yet</p>
                                <p className="mt-1 text-sm text-gray-500">
                                    Try a wider date range, choose a different website, or ask your agency to sync the connected integration.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: 0 errors; build succeeds.

- [ ] **Step 4: Run the Reports backend tests to confirm export behavior is unchanged**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Reports --no-coverage
```

Expected: all 33 Reports tests (`ReportsTest` 17, `ReportExportTest` 7,
`ReportPdfExportTest` 9) still pass unchanged — confirms no export
behavior regressed from a presentation-only change.

- [ ] **Step 5: Manual browser QA**

Confirm both export links still download the correct CSV/PDF files with
the new labels, hovering shows the tooltip text, and the empty state shows
the new friendlier copy when no data matches the filters.

- [ ] **Step 6: Commit**

```bash
git add resources/js/pages/reports/Index.tsx
git commit -m "feat: clarify reports export labels and empty-state copy"
```

---

## Phase F.5 — Full Verification & Docs

### Task 8: Full verification and Phase F handoff docs

**Files:**
- Modify: `docs/sprint-status.md`
- Modify: `docs/AI_HANDOFF.md`

- [ ] **Step 1: Run the full verification suite**

```bash
docker compose exec ultron-app php artisan test --no-coverage
npm run typecheck
npm run build
```

Expected: all backend tests pass (237 + 5 new from Tasks 2/3/5 = 242);
0 TypeScript errors; build succeeds.

- [ ] **Step 2: Update `docs/sprint-status.md`**

Add a "Sprint 16 Phase F" subsection (after the Phase E section added in the
previous docs commit) summarizing: production readiness checklist added,
members-page client data-exposure fix, friendly error pages, sidebar
active-state fix, read-only-role form hiding, dashboard wording fix,
reports export/empty-state copy polish, and updated test count. Also add a
one-line correction noting Sprint 15's "Client Portal Access Control"
recommendation was already implemented prior to this phase (discovered
during Phase F inspection), so the recommendation list does not mislead a
future reader.

- [ ] **Step 3: Update `docs/AI_HANDOFF.md`**

Update the header (latest commit), add `docs/production-readiness-checklist.md`
and `resources/js/pages/errors/Error.tsx` to the relevant tables, update the
Test Status table/count, and append a "Sprint 16 Handoff — Phase F" section
mirroring the existing Phase E handoff section format.

- [ ] **Step 4: Commit**

```bash
git add docs/sprint-status.md docs/AI_HANDOFF.md
git commit -m "docs: update sprint 16 phase F production readiness and client portal UX handoff"
```

- [ ] **Step 5: Report final status to the user**

Report: working tree clean, latest commit hash, full test count, and that
no stable tag was created (tagging is a separate, explicit step the user
has requested individually after each phase in this project so far).

---

## Self-Review Notes

- **Spec coverage:** Production readiness doc (F.1/Task 1) ✓. Client portal
  UX — dashboard labels (Task 6), empty states (Task 7 covers Reports;
  Dashboard/Clients/Websites/Integrations already have empty states that
  were inspected and found adequate), hide admin-only language (Task 5),
  Members/Settings hidden (Task 2 fixes the one real gap; Settings was
  already safe), sidebar active states (Task 4) ✓. Reports UX — labels,
  help text, empty states (Task 7); CSV/PDF behavior explicitly
  unchanged and re-verified by the existing export test suite ✓.
  Safety/error handling — friendly 403 (Task 3), validation errors already
  redirect-with-session-errors via existing `ReportsIndexRequest` (no
  change needed), no data leakage (Task 2 closes the only leak found) ✓.
  Tests — nav-relevant role flags (Task 5's new tests), reports still
  renders (existing + Task 7 re-run), exports still render links (Task 7
  Step 4), client cannot access restricted areas (Task 2's new tests),
  friendly 403 behavior (Task 3's new tests) ✓.
- **No placeholders:** every step has literal file paths, full code, and
  exact commands with expected output.
- **Type/name consistency:** `canCreate`/`canManage`/`canConnect` match the
  prop names already defined in each page's `Props` interface;
  `viewMembers` matches the ability name used in both the policy and the
  controller's `$this->authorize()` call; `errors/Error` matches the
  Inertia component path convention used elsewhere (`reports/Index`,
  `seo/InsightsIndex`).
