# ULTRON-B AI — AI Handoff Document

**Last updated:** 2026-06-17
**Current branch:** `sprint-16-client-dashboard-reporting-production` (not merged to `main`; no `origin` remote configured — all commits/tags are local-only)
**Latest stable tag:** `v1.6-sprint-16-phase-f-task-6-reports-copy-stable`
**Latest commit:** `db96f44` (`feat: clarify reports export labels and empty-state copy`)
**Sprints completed:** 1–14 (merged to `main` and tagged); Sprint 15 recommendation superseded by Sprint 16 reporting work; Sprint 16 Phases D–F complete and stable

---

## Project Overview

ULTRON-B AI is a multi-tenant B2B SaaS platform for digital marketing agencies. It is built as a Laravel 13 modular monolith with a React 19 + Inertia.js v2 frontend. Each organization is a tenant; all tenant-owned data is scoped by `organization_id`, enforced server-side via `SetActiveOrganization` middleware.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | PHP 8.4 / Laravel 13 |
| Frontend | React 19, Inertia.js v2, TypeScript |
| Styling | Tailwind CSS v4 |
| Database | MySQL 8.4 |
| Cache / Queue / Session | Redis 7 |
| Web server | Caddy (via Docker) |
| Automation | n8n (self-hosted) |
| Container orchestration | Docker Compose |
| Build tool | Vite 8 |

---

## Architecture

```
app/
  Domains/
    Identity/       — User model, RegisterUserAction
    Organizations/  — Organization, OrganizationMember, Department; CreateOrganizationAction; OrganizationContextService; MemberRole + OrganizationStatus enums; OrganizationPolicy
    Invitations/    — OrganizationInvitation; SendInvitationAction, AcceptInvitationAction; InvitationNotification; InvitationStatus enum
    Clients/        — Client, Website models; Create/Update/Delete actions for each; ClientPolicy, WebsitePolicy; WebsiteStatus enum
    Integrations/   — Integration model; StartGoogleOAuthAction, CompleteGoogleOAuthAction, DisconnectIntegrationAction; IntegrationPolicy; IntegrationProvider contract + enum; IntegrationStatus enum
    Analytics/      — AnalyticsDailyMetric, AnalyticsLandingPage, AnalyticsSearchQuery, AnalyticsSearchPage, AnalyticsSyncHistory models; GA4 + GSC data services; SyncGoogleAnalyticsJob, SyncGoogleSearchConsoleJob; QueueAnalyticsSyncAction; GetSeoDashboardDataAction; AnalyticsSyncStatus enum
    Seo/            — SeoInsight model; GenerateSeoInsightsAction, GetSeoInsightListAction, GetSeoInsightDetailAction, UpdateSeoInsightStatusAction, BulkUpdateSeoInsightStatusAction, GetSeoInsightsForDashboardAction; AnalyticsSummaryAgent; SeoInsightPolicy; SeoInsightStatus, SeoInsightType enums
    Audit/          — AuditLog model; AuditLogger service
  Http/
    Controllers/    — Thin controllers only; delegate to Actions/Services
    Middleware/     — SetActiveOrganization, HandleInertiaRequests, RedirectIfAuthenticated
  Console/
    Commands/       — ValidateEnvironment (ultron:env:validate)
resources/js/
  pages/            — Inertia page components (one file per route)
  components/ui/    — Shared primitive UI components
```

Domain logic lives exclusively in `app/Domains/`. Controllers delegate to Actions. Policies enforce authorization.

---

## Completed Modules (Sprints 1–11)

### Identity (Sprint 1)
- `User` model with MFA columns (`mfa_secret`, `mfa_enabled`, `mfa_recovery_codes`) — columns present, enforcement deferred
- `RegisterUserAction` — creates user + auto-creates first organization

### Authentication (Sprint 1)
- Register, Login, Logout
- Email verification
- Forgot password / Reset password
- All auth controllers in `app/Http/Controllers/Auth/`

### Organizations (Sprint 1)
- `Organization` model — name, slug, status (active/suspended/pending), plan, seats, settings JSON
- `OrganizationMember` pivot — roles: `owner`, `admin`, `manager`, `member`, `viewer`
- `Department` model scoped to organization
- `CreateOrganizationAction` — creates org, assigns creator as owner
- `OrganizationContextService` — resolves active org from slug + auth context
- `SetActiveOrganization` middleware — enforces tenant isolation on every org-scoped route
- `OrganizationPolicy` — view, update, delete gated by role

### Invitations (Sprint 1)
- `OrganizationInvitation` model — token, email, role, status (pending/accepted/cancelled/expired), expires_at
- `SendInvitationAction` — validates role, prevents duplicates, queues notification email
- `AcceptInvitationAction` — verifies email match, creates membership, marks invitation accepted
- `InvitationNotification` (queued) — sends invite email

### Clients & Websites (Sprint 2)
- `Client` model — scoped to `organization_id`; name, email, status, notes; soft-deletable
- `Website` model — scoped to `organization_id`; url, platform (WordPress/Shopify/Custom/Other), status enum; soft-deletable
- Full CRUD via `ClientController` and `WebsiteController` (index, store, update, destroy)
- `ClientPolicy`, `WebsitePolicy` — ownership + permission checks
- `clients/Index.tsx`, `websites/Index.tsx` — list + create/edit inline

### Integrations & Google OAuth (Sprint 2)
- `Integration` model — scoped to `organization_id`; provider enum, status enum, encrypted credentials JSON
- `IntegrationController` — index, connect (Google), googleCallback, sync, destroy
- `StartGoogleOAuthAction`, `CompleteGoogleOAuthAction` — Socialite-based OAuth; tokens stored encrypted
- `DisconnectIntegrationAction` — wipes credentials and marks disconnected
- `IntegrationPolicy` — ownership + permission checks
- Tokens never exposed to React (`test_index_does_not_expose_tokens` test enforces this)
- `integrations/Index.tsx` — connect/disconnect UI; shows warning when Google credentials not configured

### SEO Dashboard Scaffold (Sprint 2)
- `seo/Index.tsx` — KPI cards, empty states, tracked website list; renders from local DB only

### Analytics Sync (Sprint 3)
- Database tables: `analytics_daily_metrics`, `analytics_landing_pages`, `analytics_search_queries`, `analytics_search_pages`, `analytics_sync_history`
- `GoogleAnalyticsDataService` — HTTP service for GA4 Data API; only called from queued jobs
- `GoogleSearchConsoleDataService` — HTTP service for Search Analytics; only called from queued jobs
- `SyncGoogleAnalyticsJob`, `SyncGoogleSearchConsoleJob` — upsert local records, update sync status
- `QueueAnalyticsSyncAction` — policy-protected; never accepts `organization_id` from browser
- Manual sync trigger on connected integrations (`POST /{org}/integrations/{integration}/sync`)

### SEO Dashboard Data UI (Sprint 4)
- `GetSeoDashboardDataAction` — aggregates KPIs, landing pages, search queries, sync status from local tables
- `SeoDashboardRequest` — validates website/date filters against active organization context
- SEO dashboard renders 100% from local database; zero external API calls during page load

### SEO Insights Agent (Sprint 5)
- `seo_insights` table — tenant-scoped; type, status (pending/reviewed/approved/dismissed), severity, subject, evidence, review fields
- `AnalyticsSummaryAgent` — deterministic local-data agent (no external AI calls); generates insights from stored analytics
- Insight types: declining page clicks, high-impression low-CTR queries, improving impressions, ranking opportunities, missing/stale sync
- Manual generation only (`POST /{org}/seo/insights/generate`); admin/owner only

### SEO Insights Review Workflow (Sprint 6)
- `UpdateSeoInsightStatusAction` — individual status transitions (reviewed/approved/dismissed/reopened); sets reviewer fields
- `BulkUpdateSeoInsightStatusAction` — direct `->update()` scoped to org; writes single bulk audit entry
- `GetSeoInsightListAction` — paginated (20/page) with type, status, website, severity, date filters
- `GetSeoInsightDetailAction` — loads insight with website, generatedBy, reviewedBy relations
- `SeoInsightController` — index, show, markReviewed, markApproved, markDismissed, reopen, bulkReviewed, bulkDismissed
- `seo/InsightsIndex.tsx` — paginated table with filter bar, bulk checkbox panel
- `seo/InsightShow.tsx` — detail view with review history, review_notes, inline status-action forms
- `AuditLog` model + `AuditLogger` service — synchronous audit writes for all insight status events

### Demo Data & QA Docs (Sprint 7)
- `DemoSeeder` — 4 users (Owner/Admin/Member/Viewer), 1 org, 3 clients, 4 websites, 1 integration, 30 days analytics, 8 SEO insights; blocked in production via `abort_if(app()->isProduction(), ...)`
- `docs/local-setup.md` — start stack, migrate, seed, verify demo data
- `docs/qa-checklist.md` — manual QA checklist for all features

### Production Hardening (Sprint 9)
- Structured logging in sync jobs (`Log::info`/`Log::error`)
- `/health` endpoint — `GET /health` returns `{"status":"ok"}` (unauthenticated)
- `.env.example` annotated with `# PRODUCTION:` guidance on all security-sensitive vars
- `docs/production-deployment.md` — VPS guide, Docker, env config, Caddy HTTPS, workflow
- `docs/security-checklist.md` — pre-launch security checklist
- `docs/backup-strategy.md` — MySQL dump, retention, off-site sync, restore procedure
- `Caddyfile.production.example` — HTTPS config with Let's Encrypt and security headers

### VPS Deployment Preparation (Sprint 10)
- `docs/deployment-dry-run.md` — 6-phase pre-deployment checklist
- `docs/vps-launch-commands.md` — 11-step launch guide with expected outputs
- `docker-compose.production.yml` — production Compose override (production build target, no bind mounts)
- `docs/deployment-rollback.md` — decision guide, DB restore, code revert, partial migration rollback
- `docs/first-admin-setup.md` — web UI path + Artisan Tinker fallback
- `docs/smoke-tests.md` — infrastructure, browser, and queue verification
- `php artisan ultron:env:validate` — validates APP_KEY, APP_DEBUG, APP_URL, QUEUE_CONNECTION, SESSION_DRIVER

### VPS Deployment Dry-Run Readiness (Sprint 11)
- `docker-compose.production.yml` — added `env_file: .env` to app, queue, scheduler (critical: without it, containers have no Laravel env vars in production); added Redis `--requirepass ${REDIS_PASSWORD}` override
- `php artisan ultron:env:validate` — extended with two new production-gated checks: `SESSION_SECURE_COOKIE=true` and `REDIS_PASSWORD is set`
- `docs/vps-preflight.md` — new 7-section server-level checklist: OS, Docker, DNS, Firewall, Repository, Environment File, App Validation; run before `deployment-dry-run.md`
- `docs/vps-launch-commands.md` — prerequisites now reference `vps-preflight.md` before `deployment-dry-run.md`

### Real VPS Deployment Dry-Run Hardening (Sprint 12)
- Production Compose `!reset []` for app/queue/scheduler volumes — removes development bind mounts in production renders
- Caddy production override mounts `./public:/var/www/html/public:ro` so Caddy serves Vite assets
- MySQL, Redis, and n8n host ports set to `127.0.0.1` in production; only Caddy exposes HTTP/HTTPS
- Redis production healthcheck uses `REDISCLI_AUTH` for authenticated liveness checks
- `docs/deployment-dry-run.md`, `docs/vps-launch-commands.md`, `docs/smoke-tests.md`, `docs/vps-preflight.md` all hardened for real staging execution

### Staging VPS Deployment Dry Run (Sprint 13)
- Stale tag reference fixed in `docs/vps-preflight.md` (`v1.1` → `v1.2`)
- `docs/sprint-13-blockers.md` — blockers checklist and staged deployment command sequence (Phases 0–6)
- Sprint is documentation-only; no application code changed; actual deployment blocked pending VPS provisioning

### Google OAuth, Website Analytics Fields, GSC sc-domain & SEO Source Filtering (Sprint 14)
- **Blank pages fix**: `HandleInertiaRequests::share()` — wrapped `currentOrganization` and `userOrganizations` in closures; Inertia evaluates them lazily after `SetActiveOrganization` runs
- **React defensive slugs**: all pages (`clients/Index.tsx`, `websites/Index.tsx`, `seo/Index.tsx`, `seo/InsightsIndex.tsx`, `seo/InsightShow.tsx`) use `currentOrganization?.slug ?? URL first segment` fallback; `AppLayout.tsx` does the same for nav link generation
- **Google OAuth redirect fix**: OAuth callback now issues a top-level `Redirect::to()` rather than an Inertia redirect, preventing browser navigation issues when the callback URL is hit after Google returns
- **GA4 / GSC website fields**: `ga4_property_id` and `gsc_site_url` columns on `websites`; surfaced in website settings UI; used by sync jobs to target specific GA4 properties and GSC sites
- **sc-domain GSC support**: `gsc_site_url` values beginning with `sc-domain:` are handled correctly in `GoogleSearchConsoleDataService`; domain properties no longer require a trailing slash
- **SEO dashboard source filtering**: new source filter (GA4 / Search Console / All) on the SEO dashboard; data action scopes queries by source; source badges on metric cards

---

## Database Migrations

| File | Description |
|------|-------------|
| `0001_01_01_000000_create_users_table` | Users, password resets, sessions |
| `0001_01_01_000001_create_cache_table` | Laravel cache |
| `0001_01_01_000002_create_jobs_table` | Queue jobs, failed jobs, job batches |
| `2026_06_11_000001_add_mfa_to_users_table` | `mfa_secret`, `mfa_enabled`, `mfa_recovery_codes` |
| `2026_06_11_000002_create_organizations_table` | Organizations |
| `2026_06_11_000003_create_organization_members_table` | Pivot: user ↔ organization with role |
| `2026_06_11_000004_create_departments_table` | Departments scoped to organization |
| `2026_06_11_000005_create_organization_invitations_table` | Invitation tokens |
| `2026_06_11_000006_create_clients_table` | Clients scoped to organization |
| `2026_06_11_000007_create_websites_table` | Websites scoped to organization |
| `2026_06_11_000008_create_integrations_table` | Integration credentials scoped to organization |
| `2026_06_11_000009_create_audit_logs_table` | Audit log (actor, action, subject, metadata) |
| `2026_06_11_000010_add_platform_to_websites_table` | `platform` column on websites |
| `2026_06_11_000011_create_analytics_tables` | Daily metrics, landing pages, search queries, search pages, sync history |
| `2026_06_11_000012_create_seo_insights_table` | SEO insights with status, severity, evidence, review fields |
| `2026_06_11_000013_add_review_notes_to_seo_insights_table` | Nullable `review_notes` TEXT column |
| `2026_06_12_000001_add_analytics_fields_to_websites_table` | `ga4_property_id` (nullable string) and `gsc_site_url` (nullable string) on `websites` |

---

## Routes

### Auth routes (`routes/auth.php`) — guest middleware
| Method | URI | Name | Controller |
|--------|-----|------|------------|
| GET | `/register` | `register` | `RegisterController@create` |
| POST | `/register` | — | `RegisterController@store` |
| GET | `/login` | `login` | `LoginController@create` |
| POST | `/login` | — | `LoginController@store` |
| GET | `/forgot-password` | `password.request` | `ForgotPasswordController@create` |
| POST | `/forgot-password` | `password.email` | `ForgotPasswordController@store` |
| GET | `/reset-password/{token}` | `password.reset` | `ResetPasswordController@create` |
| POST | `/reset-password` | `password.update` | `ResetPasswordController@store` |

### Auth routes — auth middleware
| Method | URI | Name | Controller |
|--------|-----|------|------------|
| POST | `/logout` | `logout` | `LoginController@destroy` |
| GET | `/email/verify` | `verification.notice` | `EmailVerificationController@notice` |
| GET | `/email/verify/{id}/{hash}` | `verification.verify` | `EmailVerificationController@verify` |
| POST | `/email/verification-notification` | `verification.send` | `EmailVerificationController@resend` |

### App routes (`routes/web.php`)
| Method | URI | Name | Middleware | Controller |
|--------|-----|------|------------|------------|
| GET | `/` | `home` | — | Redirects to `login` |
| GET | `/health` | `health` | — | `fn() → {"status":"ok"}` |
| GET | `/organizations/create` | `organizations.create` | auth, verified | `OrganizationController@create` |
| POST | `/organizations` | `organizations.store` | auth, verified | `OrganizationController@store` |
| GET | `/invitations/{token}` | `invitations.show` | auth | `InvitationController@show` |
| POST | `/invitations/{token}/accept` | `invitations.accept` | auth | `InvitationController@accept` |
| GET | `/{org}/dashboard` | `dashboard` | auth, verified, org | `DashboardController` |
| GET | `/{org}/settings` | `organization.settings` | auth, verified, org | `OrganizationController@settings` |
| PATCH | `/{org}/settings` | `organization.update` | auth, verified, org | `OrganizationController@update` |
| GET | `/{org}/members` | `organization.members` | auth, verified, org | `OrganizationController@members` |
| POST | `/{org}/invitations` | `invitations.store` | auth, verified, org | `InvitationController@store` |
| DELETE | `/{org}/invitations/{invitation}` | `invitations.destroy` | auth, verified, org | `InvitationController@destroy` |
| GET | `/{org}/clients` | `clients.index` | auth, verified, org | `ClientController@index` |
| POST | `/{org}/clients` | `clients.store` | auth, verified, org | `ClientController@store` |
| PATCH | `/{org}/clients/{client}` | `clients.update` | auth, verified, org | `ClientController@update` |
| DELETE | `/{org}/clients/{client}` | `clients.destroy` | auth, verified, org | `ClientController@destroy` |
| GET | `/{org}/websites` | `websites.index` | auth, verified, org | `WebsiteController@index` |
| POST | `/{org}/websites` | `websites.store` | auth, verified, org | `WebsiteController@store` |
| PATCH | `/{org}/websites/{website}` | `websites.update` | auth, verified, org | `WebsiteController@update` |
| DELETE | `/{org}/websites/{website}` | `websites.destroy` | auth, verified, org | `WebsiteController@destroy` |
| GET | `/{org}/integrations` | `integrations.index` | auth, verified, org | `IntegrationController@index` |
| POST | `/{org}/integrations/google` | `integrations.google.connect` | auth, verified, org | `IntegrationController@connect` |
| GET | `/{org}/integrations/google/callback` | `integrations.google.callback` | auth, verified, org | `IntegrationController@googleCallback` |
| POST | `/{org}/integrations/{integration}/sync` | `integrations.sync` | auth, verified, org | `IntegrationController@sync` |
| DELETE | `/{org}/integrations/{integration}` | `integrations.destroy` | auth, verified, org | `IntegrationController@destroy` |
| GET | `/{org}/seo` | `seo.index` | auth, verified, org | `SeoDashboardController` |
| POST | `/{org}/seo/insights/generate` | `seo.insights.generate` | auth, verified, org | `SeoInsightController@generate` |
| GET | `/{org}/seo/insights` | `seo.insights.index` | auth, verified, org | `SeoInsightController@index` |
| POST | `/{org}/seo/insights/bulk-reviewed` | `seo.insights.bulk-reviewed` | auth, verified, org | `SeoInsightController@bulkReviewed` |
| POST | `/{org}/seo/insights/bulk-dismissed` | `seo.insights.bulk-dismissed` | auth, verified, org | `SeoInsightController@bulkDismissed` |
| GET | `/{org}/seo/insights/{insight}` | `seo.insights.show` | auth, verified, org | `SeoInsightController@show` |
| POST | `/{org}/seo/insights/{insight}/reviewed` | `seo.insights.reviewed` | auth, verified, org | `SeoInsightController@markReviewed` |
| POST | `/{org}/seo/insights/{insight}/approved` | `seo.insights.approved` | auth, verified, org | `SeoInsightController@markApproved` |
| POST | `/{org}/seo/insights/{insight}/dismissed` | `seo.insights.dismissed` | auth, verified, org | `SeoInsightController@markDismissed` |
| POST | `/{org}/seo/insights/{insight}/reopened` | `seo.insights.reopened` | auth, verified, org | `SeoInsightController@reopen` |
| GET | `/{org}/reports` | `reports.index` | auth, verified, org | `ReportsController` |
| GET | `/{org}/reports/export` | `reports.export` | auth, verified, org | `ReportExportController` |
| GET | `/{org}/reports/export/pdf` | `reports.export.pdf` | auth, verified, org | `ReportPdfExportController` |

`org` middleware alias = `SetActiveOrganization`

---

## Controllers

| File | Responsibility |
|------|---------------|
| `Controller.php` | Base controller |
| `Auth/RegisterController.php` | User registration via `RegisterUserAction` |
| `Auth/LoginController.php` | Login / logout |
| `Auth/ForgotPasswordController.php` | Send password reset email |
| `Auth/ResetPasswordController.php` | Reset password with token |
| `Auth/EmailVerificationController.php` | Email verification notice, verify, resend |
| `DashboardController.php` | Renders dashboard Inertia page |
| `OrganizationController.php` | Create, settings, update, members |
| `InvitationController.php` | Show, accept, store, destroy invitations |
| `ClientController.php` | Client CRUD; delegates to Client Actions |
| `WebsiteController.php` | Website CRUD; delegates to Website Actions |
| `IntegrationController.php` | Integration index, Google OAuth connect/callback, sync, destroy |
| `SeoDashboardController.php` | SEO dashboard; aggregates local analytics via `GetSeoDashboardDataAction` |
| `SeoInsightController.php` | Insight generate, list, show, status transitions, bulk actions |
| `ReportsController.php` | Reports preview page; aggregates via `GetReportPreviewAction` (`app/Domains/Reports/Actions/`) |
| `ReportExportController.php` | Streams CSV attachment via `BuildReportCsvAction` |
| `ReportPdfExportController.php` | Streams PDF attachment via `BuildReportPdfAction` (`barryvdh/laravel-dompdf`) |

---

## Middleware

| File | Responsibility |
|------|---------------|
| `SetActiveOrganization.php` | Resolves org from URL slug, checks membership, sets app context; denies cross-tenant access |
| `HandleInertiaRequests.php` | Shares global props (auth user, org context) with all Inertia pages |
| `RedirectIfAuthenticated.php` | Redirects logged-in users away from guest routes |

---

## React / Inertia Pages

| File | Route |
|------|-------|
| `auth/Login.tsx` | `/login` |
| `auth/Register.tsx` | `/register` |
| `auth/ForgotPassword.tsx` | `/forgot-password` |
| `auth/ResetPassword.tsx` | `/reset-password/{token}` |
| `auth/VerifyEmail.tsx` | `/email/verify` |
| `invitations/Accept.tsx` | `/invitations/{token}` |
| `organizations/Create.tsx` | `/organizations/create` |
| `organizations/Settings.tsx` | `/{org}/settings` |
| `organizations/Members.tsx` | `/{org}/members` |
| `Dashboard.tsx` | `/{org}/dashboard` |
| `clients/Index.tsx` | `/{org}/clients` |
| `websites/Index.tsx` | `/{org}/websites` |
| `integrations/Index.tsx` | `/{org}/integrations` |
| `seo/Index.tsx` | `/{org}/seo` |
| `seo/InsightsIndex.tsx` | `/{org}/seo/insights` |
| `seo/InsightShow.tsx` | `/{org}/seo/insights/{insight}` |

### Shared UI Components (`resources/js/components/ui/`)
`Badge.tsx`, `Button.tsx`, `Card.tsx`, `Input.tsx`, `Label.tsx`, `Textarea.tsx`

---

## Artisan Commands

| Command | File | Purpose |
|---------|------|---------|
| `ultron:env:validate` | `app/Console/Commands/ValidateEnvironment.php` | Validates production readiness: APP_KEY, APP_DEBUG, APP_URL, QUEUE_CONNECTION, SESSION_DRIVER, SESSION_SECURE_COOKIE, REDIS_PASSWORD. Exits 0 on pass, 1 on failure. Production-gates all checks except APP_KEY. |

---

## Deployment Readiness (v1.1)

Deployment documentation is ready for staging rehearsal. Run checklist order: `docs/vps-preflight.md` → `docs/deployment-dry-run.md` → `docs/vps-launch-commands.md` → `docs/smoke-tests.md`.

| Artifact | Location | Status |
|----------|----------|--------|
| Server-level VPS preflight checklist | `docs/vps-preflight.md` | ✓ |
| VPS deployment guide | `docs/production-deployment.md` | ✓ |
| Pre-deploy dry-run checklist | `docs/deployment-dry-run.md` | ✓ |
| VPS launch commands (ordered, with expected output) | `docs/vps-launch-commands.md` | ✓ |
| Production Compose override (with env_file, reset development mounts, Redis auth, private MySQL/Redis/n8n ports, Caddy public asset mount) | `docker-compose.production.yml` | ✓ |
| Production Caddyfile example | `Caddyfile.production.example` | ✓ |
| Rollback procedure | `docs/deployment-rollback.md` | ✓ |
| First admin setup | `docs/first-admin-setup.md` | ✓ |
| Post-deployment smoke tests | `docs/smoke-tests.md` | ✓ |
| Security checklist | `docs/security-checklist.md` | ✓ |
| Backup strategy | `docs/backup-strategy.md` | ✓ |
| Environment validation command | `php artisan ultron:env:validate` | ✓ |

---

## Test Status

**Passing** — Sprint 16 Phase F verified (`db96f44`, 2026-06-17): `261 passed (1584 assertions) in 5.18s`

| Suite | Tests |
|-------|-------|
| `Feature/Auth/AuthTest` | 8 |
| `Feature/Analytics/AnalyticsSyncTest` | 5 |
| `Feature/ClientPortal/ClientPortalAccessTest` | 16 |
| `Feature/Clients/ClientCrudTest` | 6 |
| `Feature/Clients/WebsiteCrudTest` | 6 |
| `Feature/Console/ValidateEnvironmentTest` | 10 |
| `Feature/DashboardAccessTest` | 6 |
| `Feature/DemoSeederTest` | 7 |
| `Feature/ErrorPages/FriendlyErrorPagesTest` | 5 |
| `Feature/ExampleTest` | 1 |
| `Feature/HealthCheckTest` | 2 |
| `Feature/Integrations/IntegrationTest` | 7 |
| `Feature/Invitations/InvitationTest` | 9 |
| `Feature/Organizations/MembersAccessTest` | 5 |
| `Feature/Organizations/OrganizationPageRenderTest` | 12 |
| `Feature/Organizations/OrganizationTest` | 7 |
| `Feature/Organizations/TenantIsolationTest` | 7 |
| `Feature/Reports/ReportsTest` | 17 |
| `Feature/Reports/ReportExportTest` | 7 |
| `Feature/Reports/ReportPdfExportTest` | 9 |
| `Feature/Seo/SeoDashboardTest` | 5 |
| `Feature/Seo/SeoInsightAuthorizationTest` | 13 |
| `Feature/Seo/SeoInsightBulkActionTest` | 8 |
| `Feature/Seo/SeoInsightFilterTest` | 9 |
| `Feature/Seo/SeoInsightReviewTest` | 12 |
| `Feature/Seo/SeoInsightTenantIsolationTest` | 7 |
| `Feature/Seo/SeoInsightsTest` | 3 |
| `Feature/Sidebar/SidebarNavTest` | 7 |
| `Unit/ExampleTest` | 1 |
| `Unit/MemberRoleClientTest` | 11 |

Every organization-owned feature has tenant isolation test coverage. Reports preview/export tests cover owner/admin org-wide access and client assigned-website-only scoping.

Browser QA (manual, outside the automated suite): CSV export passed; PDF export passed. Phase F client portal UX QA passed (members 403, friendly error pages, sidebar active-state, read-only notices, updated reports copy).

---

## TypeScript & Build Status

| Check | Status |
|-------|--------|
| `npm run typecheck` (`tsc --noEmit`) | **0 errors** (re-verified Phase F, 2026-06-17) |
| `npm run build` (Vite production) | **Success** — built in 291ms (re-verified Phase F, 2026-06-17) |
| `docker compose exec ultron-app ./vendor/bin/pint --test` | **PASS** — 159 files (last verified Sprint 12) |
| `docker compose -f docker-compose.yml -f docker-compose.production.yml config` | **PASS** — production override renders with app bind mounts reset, Caddy public mount, private MySQL/Redis/n8n ports |

---

## Commands

### Start services
```bash
docker compose up -d
```

### Run migrations
```bash
docker compose exec ultron-app php artisan migrate
```

### Run tests
```bash
docker compose exec ultron-app php artisan test
```

### Validate production environment
```bash
docker compose exec ultron-app php artisan ultron:env:validate
```

### Seed demo data (local only)
```bash
docker compose exec ultron-app php artisan db:seed --class=DemoSeeder
```

### Tinker (REPL)
```bash
docker compose exec ultron-app php artisan tinker
```

### Frontend dev server (on host)
```bash
npm run dev
```

### Frontend production build
```bash
npm run build
```

### TypeScript check
```bash
npm run typecheck
```

---

## Key Architectural Rules (must be preserved)

1. `declare(strict_types=1)` on every PHP file.
2. Controllers must be thin — all business logic in Actions/Services.
3. Use Form Requests for validation; Policies/Gates for authorization.
4. `organization_id` is REQUIRED on every tenant-owned row.
5. `organization_id` must NEVER be trusted from the browser — always derive from `SetActiveOrganization` middleware.
6. Policies must verify both permission AND resource ownership.
7. Queue all external API calls, AI requests, emails, exports (`QUEUE_CONNECTION=redis`).
8. Never expose credentials, tokens, or secrets to React or logs.
9. SEO dashboard and all dashboards must render from local database only — no external API calls during page load.
10. DemoSeeder is blocked in production — do not remove the `abort_if(app()->isProduction(), ...)` guard.

---

## Known Issues / Gaps

1. **MFA is scaffolded but not functional** — columns exist on `users` table (`mfa_secret`, `mfa_enabled`, `mfa_recovery_codes`); no enable/verify flow, no middleware enforcement.
2. **OAuth token refresh not implemented** — analytics sync assumes valid stored tokens; jobs will fail when tokens expire. Needs `CompleteGoogleOAuthAction` to handle refresh grant.
3. **Scheduled automatic analytics sync not wired** — manual sync only (`QueueAnalyticsSyncAction`); no Laravel scheduler entry for periodic auto-sync.
4. **n8n integration is infrastructure-only** — container runs but no workflow triggers or webhook handlers exist in Laravel.
5. **No billing/subscription module** — `plan` and `seats` columns exist on `organizations` but no enforcement or Stripe integration; report generation/export volume is also unmetered.
6. **No actual VPS deployment has been performed** — Sprint 12 prepared the real staging dry-run path but intentionally did not deploy, push, merge, or tag.
7. **PDF export is synchronous, on-request, and not emailed** — `ReportPdfExportController` builds the PDF inline on the HTTP request; no queued/scheduled generation job and no email delivery exist yet.
8. **PDF export has no branded logo and limited page-break control** — `reports.pdf` Blade view is text/table-only; long tables (top queries/pages, insights) can break awkwardly across pages.
9. **No `origin` git remote configured** — Sprint 16 work (including phase tags) exists only in the local repository; nothing has been pushed.

---

## Sprint 14 Handoff

**Current branch:** `main`
**Latest commit:** `3ac39e1`
**Release tag:** `v1.4-sprint-14-complete`
**Status:** Complete — merged to `main` and tagged

### Completed Work

- **Blank pages fix**: `HandleInertiaRequests::share()` closures; defensive slug fallbacks in all affected React pages and `AppLayout.tsx`; 12 new `OrganizationPageRenderTest` tests
- **Google OAuth redirect fix**: top-level `Redirect::to()` in OAuth callback controller; prevents post-OAuth navigation failures
- **Website analytics fields**: `ga4_property_id` and `gsc_site_url` nullable columns on `websites`; migration, model fillables, form request validation, settings UI
- **sc-domain GSC support**: `GoogleSearchConsoleDataService` handles `sc-domain:example.com` properties without requiring trailing slash
- **SEO dashboard source filtering**: source filter (GA4 / Search Console / All) on the SEO dashboard; `GetSeoDashboardDataAction` scopes by source; source badges on metric cards

### Tests / Build Results

```
docker compose exec ultron-app php artisan test  → passing
npm run typecheck                                → 0 errors
npm run build                                    → success
```

### Recommended Claude Prompt for Sprint 15

```text
Continue ULTRON-B AI on branch main.

Read:
CLAUDE.md
docs/AI_HANDOFF.md
docs/sprint-status.md

Sprint 14 is complete and tagged v1.4-sprint-14-complete (commit 3ac39e1).

Next sprint: Sprint 15 — Client Portal Access Control.

All tests pass. TypeScript: 0 errors. Build: clean.
```

### Recommended Next Sprint

**Sprint 15 — Client Portal Access Control**

Build a read-only client-facing portal where clients can log in and view their own website analytics and SEO insights without access to agency-internal controls (member management, settings, integrations, insight generation).

---

## Sprint 16 Handoff — Client Dashboard Reporting (Phases D–F Complete)

**Current branch:** `sprint-16-client-dashboard-reporting-production`
**Latest commit:** `db96f44` (`feat: clarify reports export labels and empty-state copy`)
**Stable tag:** `v1.6-sprint-16-phase-f-task-6-reports-copy-stable`
**Status:** Phases D–F complete and stable. Branch is **not** merged to `main`; **no `origin` remote is configured**, so nothing here has been pushed — tags and commits are local-only.

### Completed Work (Phases D–F)

**Phase D–E — Reports foundation and export:**
- **Reports preview foundation**: `GetReportPreviewAction`, `ReportsController`, `reports/Index.tsx` — six sections; org-wide for owner/admin, assigned-websites-only for client role
- **Reports preview filters**: website / date-range / source filters via `ReportsIndexRequest`
- **Reports trend summaries**: aggregated GSC/GA4 totals, top queries, top landing pages — local analytics tables only
- **Reports CSV export**: `BuildReportCsvAction` + `ReportExportController` (`GET {organization}/reports/export`)
- **Reports PDF export**: `BuildReportPdfAction` (via `barryvdh/laravel-dompdf`) + `ReportPdfExportController` (`GET {organization}/reports/export/pdf`)

**Phase F — Production readiness & client portal UX:**
- **Task 1**: `docs/production-readiness-checklist.md` — pre-launch checklist (`b69fb62`)
- **Task 2**: `OrganizationPolicy::viewMembers()` — client role denied 403 on `/{org}/members`; `MembersAccessTest` (5 tests)
- **Task 3**: `bootstrap/app.php` `HttpException` renderer + `Error.tsx` standalone page — friendly 403/404/429/500/503 responses; `APP_DEBUG` preserved for 500s in dev; `FriendlyErrorPagesTest` (5 tests)
- **Task 4**: Most-specific-match active-state algorithm in `AppLayout.tsx` — sidebar collision between `/{org}/seo` and `/{org}/seo/insights` resolved; `SidebarNavTest` (7 tests)
- **Task 5**: `clients/Index.tsx`, `websites/Index.tsx`, `integrations/Index.tsx` — read-only notice cards replace disabled admin forms for client/viewer roles; 7 new tests in `ClientPortalAccessTest`
- **Task 6**: `reports/Index.tsx` — export buttons relabelled "Download CSV (spreadsheet)" / "Download PDF (formatted report)" with tooltips + caption; empty state replaced with two-line user-facing copy; export routes and data logic unchanged

### Phase Tags (Sprint 16)

```
v1.6-sprint-16-phase-e-reports-export-stable          (Phase E baseline)
v1.6-sprint-16-phase-f-task-2-members-access-stable
v1.6-sprint-16-phase-f-task-4-sidebar-active-stable
v1.6-sprint-16-phase-f-task-5-read-only-notices-stable
v1.6-sprint-16-phase-f-task-6-reports-copy-stable     (current HEAD)
```

### Tests / Build Results (Phase F, 2026-06-17)

```
docker compose exec ultron-app php artisan test --no-coverage  → 261 passed (1584 assertions) in 5.18s
npm run typecheck                                               → 0 errors
npm run build                                                   → ✓ built in 291ms
```

### Remaining / Future Items (Sprint 17 candidates)

| Item | Notes |
|------|-------|
| Git remote/origin setup | No `origin` configured; nothing has been pushed — all Sprint 16 tags/commits are local-only |
| Production deployment checklist execution | `docs/production-readiness-checklist.md` exists; actual VPS deployment not performed |
| Scheduled/queued PDF generation | PDF export is currently synchronous on the HTTP request |
| Email delivery of PDF reports | Not built — download-only today |
| Billing/usage limits | No plan/seat enforcement on report generation or export volume |
| Export rate limiting | No per-user/per-org rate limit on CSV/PDF export endpoints |
| Branded logo image in PDF header | `reports.pdf` Blade view is text-only |
| Better PDF page-break control | Long tables can break awkwardly across PDF pages |

### Recommended Claude Prompt for Sprint 17

```text
Continue ULTRON-B AI on branch sprint-16-client-dashboard-reporting-production.

Read:
CLAUDE.md
docs/AI_HANDOFF.md
docs/sprint-status.md

Sprint 16 Phases D–F are complete and stable.
Latest tag: v1.6-sprint-16-phase-f-task-6-reports-copy-stable (commit db96f44).
All tests pass: 261 passed (1584 assertions). TypeScript: 0 errors. Build: clean.
Working tree is clean. No origin remote is configured.

Recommended next: set up git origin remote and push Sprint 16 branch + tags, or
begin Sprint 17 — pick up the highest-priority remaining item per owner direction
(queued PDF generation, email delivery, billing limits, or production deployment).
```
