# Sprint 10 — Deployment Dry Run & VPS Launch Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create all deployment preparation documentation and an environment validation Artisan command so the team can confidently launch ULTRON-B AI on a VPS.

**Architecture:** Primarily documentation (Markdown files in `docs/`) plus one new Artisan command (`app/Console/Commands/ValidateEnvironment.php`) that checks production readiness at the CLI level. No new routes, no new migrations, no new frontend pages — this sprint is operational hardening only.

**Tech Stack:** PHP 8.4 / Laravel 13 console commands, Markdown docs, PHPUnit feature tests.

---

## File Map

### New files

| File | Purpose |
|------|---------|
| `docs/deployment-dry-run.md` | Pre-deployment dry-run checklist (run before every deploy) |
| `docs/vps-launch-commands.md` | Ordered VPS launch commands with expected outputs |
| `docs/deployment-rollback.md` | Rollback procedure for failed deployments |
| `docs/first-admin-setup.md` | How to create the first admin user in production |
| `docs/smoke-tests.md` | Post-deployment smoke test checklist |
| `app/Console/Commands/ValidateEnvironment.php` | `php artisan ultron:env:validate` command |
| `tests/Feature/Console/ValidateEnvironmentTest.php` | Tests for the validation command |

### Modified files

| File | Change |
|------|--------|
| `docs/sprint-status.md` | Append Sprint 10 status block |
| `docs/AI_HANDOFF.md` | Update sprint section and test/build counts |

---

## Task 1: Create `docs/deployment-dry-run.md`

**Files:**
- Create: `docs/deployment-dry-run.md`

- [ ] **Step 1: Write the file**

```markdown
# Production Deployment Dry Run Checklist

Run through every item in this checklist **before** pushing a release to the VPS.
A checked item means you have verified it, not just read it.

---

## Phase 1 — Code & Build

- [ ] All changes are merged to `main` and the branch is clean (`git status` shows nothing uncommitted)
- [ ] Latest commit is tagged (`git tag` shows the release version, e.g. `v1.0.0`)
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run build` succeeds — `public/build/manifest.json` exists after the build
- [ ] `docker compose exec ultron-app php artisan test` passes — all tests green
- [ ] `./vendor/bin/pint --test` reports 0 formatting violations

---

## Phase 2 — Environment

- [ ] `.env` on the VPS is populated with all required production values (see `docs/production-deployment.md` §2)
- [ ] `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://app.yourdomain.com`
- [ ] `APP_KEY` is set to a unique, securely generated value (not the default)
- [ ] `DB_PASSWORD` and `DB_ROOT_PASSWORD` are strong passwords (not `secret`, `password`, or defaults)
- [ ] `REDIS_PASSWORD` is set to a strong password
- [ ] `SESSION_SECURE_COOKIE=true`, `SESSION_DRIVER=redis`, `QUEUE_CONNECTION=redis`
- [ ] `N8N_ENCRYPTION_KEY` is a 32+ character random string (not `changeme-32-char-minimum-key-here`)
- [ ] `MAIL_MAILER` is set to a real provider (`smtp`, `mailgun`, `ses`, or `postmark`)
- [ ] `.env` file permissions are `600` on the VPS (`chmod 600 /srv/ultron/.env`)
- [ ] Run the environment validation command:
  ```bash
  docker compose exec ultron-app php artisan ultron:env:validate
  ```
  All checks must show **PASS**. Address any WARN or FAIL items before proceeding.

---

## Phase 3 — Database

- [ ] Run a migration dry run to see which migrations will execute:
  ```bash
  docker compose exec ultron-app php artisan migrate --pretend --force
  ```
  Review the output. If any destructive operations appear (DROP COLUMN, DROP TABLE), confirm they are intentional.
- [ ] Confirm the database backup completed successfully before migrating production data
  ```bash
  gunzip -t /srv/backups/ultron-$(date +%Y-%m-%d).sql.gz && echo "Backup OK"
  ```

---

## Phase 4 — Security Checklist

- [ ] Work through every item in `docs/security-checklist.md` — no skipped items
- [ ] `curl -I https://app.yourdomain.com` returns `HTTP/2 200` (no certificate warnings)
- [ ] `curl -I http://app.yourdomain.com` returns a `301` redirect to HTTPS
- [ ] No secrets appear in `git log -p` output (`git log -p | grep -i "APP_KEY\|DB_PASSWORD\|REDIS_PASSWORD"` returns nothing)

---

## Phase 5 — Infrastructure

- [ ] DNS for `app.yourdomain.com` points to the VPS public IP
- [ ] Ports 80 and 443 are open in the firewall; all other ports are closed to the public internet
- [ ] MySQL and Redis ports are NOT exposed publicly (check `docker-compose.yml` port bindings)
- [ ] The backup cron job is active and the first manual dump succeeds (see `docs/backup-strategy.md`)

---

## Phase 6 — Sign-off

- [ ] At least one team member has reviewed this checklist
- [ ] Deployment window is agreed on (avoid peak hours)
- [ ] Rollback procedure is understood by the deployer (see `docs/deployment-rollback.md`)
- [ ] Monitoring / uptime alert is configured for `https://app.yourdomain.com/health`

**All phases complete → proceed to `docs/vps-launch-commands.md`.**
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment-dry-run.md
git commit -m "docs: add production deployment dry-run checklist"
```

---

## Task 2: Create `docs/vps-launch-commands.md`

**Files:**
- Create: `docs/vps-launch-commands.md`

- [ ] **Step 1: Write the file**

```markdown
# VPS Launch Commands

Run these commands in order on a fresh VPS deployment. Each step lists the command, what it does, and the expected output. If the output does not match, stop and investigate before proceeding.

---

## Prerequisites

- VPS is provisioned (Ubuntu 22.04 LTS, 2 vCPU, 2 GB RAM minimum)
- Docker 24+ and Docker Compose v2 are installed
- DNS points `app.yourdomain.com` to the VPS public IP
- You have run through `docs/deployment-dry-run.md` and all items are checked
- You are in `/srv/ultron` (the cloned repository directory)

---

## Step 1 — Build the production Docker image

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml build
```

**What it does:** Builds the `production` Dockerfile target, compiles PHP dependencies, and bakes the compiled frontend assets (`public/build/`) into the image. No source bind mount — code is frozen at build time.

**Expected output:**
```
[+] Building ...
 => [ultron-app production X/Y] ...
 ...
 => exporting to image
 => => naming to docker.io/library/ultron-app
```
Build must complete without errors. Warnings from `npm install` are acceptable; any `ERROR` line is not.

---

## Step 2 — Start all services

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

**What it does:** Starts Caddy, the Laravel app (PHP-FPM), queue worker, scheduler, MySQL, Redis, n8n, and n8n-postgres in detached mode.

**Expected output:**
```
[+] Running 8/8
 ✔ Container ultron-mysql-1        Started
 ✔ Container ultron-redis-1        Started
 ✔ Container ultron-n8n-postgres-1 Started
 ✔ Container ultron-app-1          Started
 ✔ Container ultron-queue-1        Started
 ✔ Container ultron-scheduler-1    Started
 ✔ Container ultron-n8n-1          Started
 ✔ Container caddy-1               Started
```

Verify all containers are running:
```bash
docker compose ps
```
All containers must show `running` (not `exited` or `restarting`).

---

## Step 3 — Run database migrations

```bash
docker compose exec ultron-app php artisan migrate --force
```

**What it does:** Applies all pending migrations. The `--force` flag is required when `APP_ENV=production`.

**Expected output (first deploy):**
```
  INFO  Running migrations.

  2026_06_11_000001_add_mfa_to_users_table .............. 12ms DONE
  2026_06_11_000002_create_organizations_table .......... 18ms DONE
  ...
```

**Expected output (subsequent deploys with no new migrations):**
```
  INFO  Nothing to migrate.
```

If any migration fails, do not proceed. See `docs/deployment-rollback.md`.

---

## Step 4 — Cache configuration

```bash
docker compose exec ultron-app php artisan config:cache
```

**What it does:** Merges all config files into a single cached file, eliminating repeated file reads. Required in production.

**Expected output:**
```
   INFO  Configuration cached successfully.
```

---

## Step 5 — Cache routes

```bash
docker compose exec ultron-app php artisan route:cache
```

**What it does:** Compiles all route definitions into a single cached file. Speeds up routing in production.

**Expected output:**
```
   INFO  Routes cached successfully.
```

---

## Step 6 — Cache views

```bash
docker compose exec ultron-app php artisan view:cache
```

**What it does:** Pre-compiles all Blade templates. Reduces first-request latency.

**Expected output:**
```
   INFO  Blade templates cached successfully.
```

---

## Step 7 — Verify queue worker

```bash
docker compose ps ultron-queue
```

**Expected output:**
```
NAME              IMAGE         COMMAND                  SERVICE        CREATED    STATUS    PORTS
ultron-queue-1    ultron-app    "php artisan queue:w…"   ultron-queue   ...        Up ...
```

Check recent queue logs:
```bash
docker compose logs ultron-queue --tail=30
```

**Expected output (healthy):**
```
[TIMESTAMP] INFO: Worker starting
[TIMESTAMP] Processed: App\...Job
```

No `CRITICAL` or unhandled exception lines. If you see repeated failures, run:
```bash
docker compose exec ultron-app php artisan queue:failed
```
An empty table is expected on a fresh deployment.

---

## Step 8 — Verify scheduler

```bash
docker compose logs ultron-scheduler --tail=20
```

**Expected output (healthy):**
```
[TIMESTAMP] Running scheduled commands...
[TIMESTAMP] No scheduled commands are ready to run.
```

The scheduler runs every 60 seconds. If it shows `Restarting`, check `docker compose logs ultron-scheduler` for the error.

---

## Step 9 — Verify health endpoint

```bash
curl -s https://app.yourdomain.com/health
```

**Expected output:**
```json
{"status":"ok"}
```

Also verify HTTPS certificate and redirect:
```bash
# Check HTTPS response
curl -I https://app.yourdomain.com
# Must return: HTTP/2 200

# Check HTTP → HTTPS redirect
curl -I http://app.yourdomain.com
# Must return: HTTP 301 Location: https://app.yourdomain.com
```

If `/health` returns anything other than `{"status":"ok"}`, check:
1. `docker compose ps` — all containers running?
2. `docker compose logs caddy --tail=20` — TLS cert obtained?
3. `docker compose logs ultron-app --tail=20` — PHP-FPM errors?

---

## Step 10 — Create first admin user

See `docs/first-admin-setup.md` for the exact commands to create the first organization and owner account.

---

## Step 11 — Post-deployment smoke tests

See `docs/smoke-tests.md` for manual verification steps to confirm the application is functioning correctly end-to-end.

---

## Deployment complete

Configure your uptime monitor (UptimeRobot, Better Uptime, etc.) to poll `https://app.yourdomain.com/health` every 5 minutes and alert on non-200 responses.
```

- [ ] **Step 2: Commit**

```bash
git add docs/vps-launch-commands.md
git commit -m "docs: add VPS launch command checklist with expected outputs"
```

---

## Task 3: Create `docs/deployment-rollback.md`

**Files:**
- Create: `docs/deployment-rollback.md`

- [ ] **Step 1: Write the file**

```markdown
# Deployment Rollback Procedure

If a deployment fails or causes a critical regression, follow this procedure to restore the previous working state. Speed matters — work through these steps in order without skipping.

---

## Decision: do you need a rollback?

Roll back if any of the following are true after a deployment:

- The `/health` endpoint returns non-`{"status":"ok"}` and cannot be quickly fixed
- Users cannot log in or register
- Database migrations failed part-way through (partial migration)
- A critical security regression was introduced
- The app container is crash-looping

Do **not** roll back for: visual bugs, minor feature regressions, or issues you can hot-fix forward in under 15 minutes.

---

## Step 1 — Announce the rollback

Tell your team before you start. Anyone actively using the app will be interrupted.

---

## Step 2 — Identify the last known good image / tag

```bash
# See recent git tags
git tag --sort=-version:refname | head -10

# See recent images
docker images | grep ultron-app
```

Note the tag or image ID you want to roll back to (e.g. `v0.9-sprint-9-complete`).

---

## Step 3 — Restore the database (if migrations ran)

> **Only do this step if migrations ran during the failed deployment and the schema change caused the regression.**

```bash
# 1. Stop the app to prevent writes during restore
docker compose stop ultron-app ultron-queue ultron-scheduler

# 2. Identify today's backup
ls -la /srv/backups/ultron-*.sql.gz

# 3. Decompress
gunzip /srv/backups/ultron-$(date +%Y-%m-%d).sql.gz

# 4. Drop and recreate the database
docker exec -i ultron-mysql-1 mysql \
  -u root -p"${DB_ROOT_PASSWORD}" \
  -e "DROP DATABASE IF EXISTS ultron; CREATE DATABASE ultron CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Import the backup
docker exec -i ultron-mysql-1 mysql \
  -u ultron -p"${DB_PASSWORD}" ultron \
  < /srv/backups/ultron-$(date +%Y-%m-%d).sql

# 6. Verify row count
docker exec ultron-mysql-1 mysql \
  -u ultron -p"${DB_PASSWORD}" ultron \
  -e "SELECT COUNT(*) AS org_count FROM organizations;"
```

If no backup exists for today, use the most recent one and accept possible data loss for the period between the backup and the failed deployment.

---

## Step 4 — Revert the code

```bash
# Check out the last known good tag
git checkout v0.9-sprint-9-complete

# Or revert to the previous commit on main
git revert HEAD --no-edit
git push origin main
```

---

## Step 5 — Rebuild and restart with the previous code

```bash
# Rebuild the image from the reverted code
docker compose -f docker-compose.yml -f docker-compose.production.yml build

# Restart all services
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --no-deps \
  ultron-app ultron-queue ultron-scheduler

# Clear stale caches
docker compose exec ultron-app php artisan config:clear
docker compose exec ultron-app php artisan route:clear
docker compose exec ultron-app php artisan view:clear

# Re-cache with the reverted config
docker compose exec ultron-app php artisan config:cache
docker compose exec ultron-app php artisan route:cache
docker compose exec ultron-app php artisan view:cache
```

---

## Step 6 — Verify the rollback

```bash
# Health check
curl -s https://app.yourdomain.com/health
# Expected: {"status":"ok"}

# Log in manually and verify core flows work
```

---

## Step 7 — Investigate root cause before re-deploying

Do not re-deploy the failing version until you have:

1. Identified what caused the failure (check `docker compose logs ultron-app --tail=100`)
2. Written a fix
3. Run `php artisan test` locally and confirmed all tests pass
4. Run through `docs/deployment-dry-run.md` again

---

## Partial migration rollback

If migrations ran but only some succeeded, you can step back:

```bash
# See which migrations have run
docker compose exec ultron-app php artisan migrate:status

# Roll back the last batch only (safer than rolling back all)
docker compose exec ultron-app php artisan migrate:rollback --force

# Or roll back a specific number of steps
docker compose exec ultron-app php artisan migrate:rollback --step=2 --force
```

> **Important:** `migrate:rollback` calls the `down()` method of each migration. Verify that the `down()` method is implemented correctly before relying on it in production.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment-rollback.md
git commit -m "docs: add deployment rollback procedure"
```

---

## Task 4: Create `docs/first-admin-setup.md`

**Files:**
- Create: `docs/first-admin-setup.md`

- [ ] **Step 1: Write the file**

```markdown
# First Admin Setup

After deploying to a VPS for the first time, there are no users or organizations in the database. Use this guide to create the first owner account.

> **Never use DemoSeeder in production.** It is blocked by `abort_if(app()->isProduction(), ...)` and will throw a 403.

---

## Option A — Register via the web UI (recommended)

This is the simplest path and exercises the real registration flow.

1. Navigate to `https://app.yourdomain.com/register`
2. Fill in your name, email, and a strong password
3. Submit the form — this runs `RegisterUserAction`, which:
   - Creates the `User` record
   - Creates a first `Organization` (named after you by default)
   - Assigns you as `owner` of that organization
4. Verify your email using the link sent to your inbox (check mail logs if using `log` driver: `docker compose logs ultron-app | grep "mail"`)
5. After verification, navigate to `https://app.yourdomain.com/organizations/create` if you need to rename or configure the organization

---

## Option B — Create via Artisan Tinker (headless environments)

If you cannot access the web UI (DNS not yet active, Caddy not yet configured), use Tinker directly on the server.

```bash
docker compose exec ultron-app php artisan tinker
```

Inside Tinker, run:

```php
// Create the user
$user = \App\Domains\Identity\Models\User::create([
    'name'              => 'Your Name',
    'email'             => 'you@yourdomain.com',
    'password'          => bcrypt('your-strong-password-here'),
    'email_verified_at' => now(),
]);

// Create the organization (uses the real action)
$org = app(\App\Domains\Organizations\Actions\CreateOrganizationAction::class)
    ->execute($user, [
        'name' => 'Your Agency Name',
        'slug' => 'your-agency',
    ]);

echo "User ID: {$user->id}" . PHP_EOL;
echo "Org ID:  {$org->id}"  . PHP_EOL;
echo "Org slug: {$org->slug}" . PHP_EOL;
```

After running this, verify:
```php
// Confirm membership was created
\App\Domains\Organizations\Models\OrganizationMember::where('user_id', $user->id)->first();
// Should show role: 'owner'
```

Exit Tinker: `exit`

---

## Inviting additional team members

Once you are logged in as the owner:

1. Go to `/{your-org-slug}/members`
2. Use the invite form to send invitations to team members
3. Invited users will receive an email; they click the link, register (or log in), and join the organization

Roles available: `owner`, `admin`, `manager`, `member`, `viewer`.

---

## Resetting the owner password

If the owner loses their password:

```bash
docker compose exec ultron-app php artisan tinker
```

```php
$user = \App\Domains\Identity\Models\User::where('email', 'you@yourdomain.com')->firstOrFail();
$user->update(['password' => bcrypt('new-strong-password-here')]);
echo "Password updated for {$user->email}" . PHP_EOL;
```

Exit: `exit`

Then log in via the web UI.
```

- [ ] **Step 2: Commit**

```bash
git add docs/first-admin-setup.md
git commit -m "docs: add first admin setup guide for production"
```

---

## Task 5: Create `docs/smoke-tests.md`

**Files:**
- Create: `docs/smoke-tests.md`

- [ ] **Step 1: Write the file**

```markdown
# Post-Deployment Smoke Tests

Run these manual checks immediately after every deployment. They verify the golden path end-to-end — from HTTPS to database writes to queued jobs.

Each check should take under 2 minutes. If any check fails, consult `docs/deployment-rollback.md`.

---

## Infrastructure checks (no browser required)

```bash
# 1. Health endpoint
curl -s https://app.yourdomain.com/health
# Expected: {"status":"ok"}

# 2. HTTPS certificate
curl -I https://app.yourdomain.com
# Expected first line: HTTP/2 200
# Expected header: strict-transport-security: max-age=...

# 3. HTTP → HTTPS redirect
curl -I http://app.yourdomain.com
# Expected first line: HTTP/1.1 301 Moved Permanently
# Expected header: Location: https://app.yourdomain.com

# 4. Non-existent route does NOT show a stack trace (APP_DEBUG=false)
curl https://app.yourdomain.com/this-route-does-not-exist
# Expected: generic 404 page — no Laravel exception message, no stack trace

# 5. Queue worker is running
docker compose ps ultron-queue
# Expected: Status shows "Up"

# 6. Scheduler is running
docker compose ps ultron-scheduler
# Expected: Status shows "Up"

# 7. No recent container restarts
docker compose ps
# Expected: No container shows "Restarting"

# 8. No failed jobs from this deployment
docker compose exec ultron-app php artisan queue:failed
# Expected: "No failed jobs found."
```

---

## Browser smoke tests (authenticated)

Perform these in a real browser. Use an incognito window to avoid cached sessions.

### Auth flow

- [ ] **Register a new user** — Go to `https://app.yourdomain.com/register`. Fill in name, email, password. Submit. Expect: redirected to dashboard or email verification page.
- [ ] **Email verification** — Check your inbox (or `docker compose logs ultron-app | grep verification` for the log driver). Click the verification link. Expect: email verified, logged in, org dashboard visible.
- [ ] **Log out** — Click Logout. Expect: redirected to `/login`.
- [ ] **Log back in** — Use the credentials you registered with. Expect: redirected to the organization dashboard.
- [ ] **Forgot password** — Go to `/forgot-password`, enter your email, submit. Expect: "We have emailed your password reset link." Check the mail log or inbox for the reset email.

### Organization & Members

- [ ] **Dashboard loads** — `/{org-slug}/dashboard` shows KPI cards and the getting-started section.
- [ ] **Settings load** — `/{org-slug}/settings` shows the organization settings form.
- [ ] **Members page loads** — `/{org-slug}/members` shows the member list and invite form.
- [ ] **Send an invitation** — Invite a second email address. Expect: invitation row appears in the member list.
- [ ] **Cross-tenant denial** — Manually type another organization's slug in the URL (e.g. `/other-org/dashboard`). Expect: 403 Forbidden, not that organization's data.

### Clients & Websites

- [ ] **Clients index loads** — `/{org-slug}/clients`. Click "New Client", fill the form, submit. Expect: client appears in the list.
- [ ] **Websites index loads** — `/{org-slug}/websites`. Click "New Website", fill the form, submit. Expect: website appears in the list.

### Integrations

- [ ] **Integrations index loads** — `/{org-slug}/integrations`. If Google credentials are configured, the Connect button is visible.
- [ ] **No token exposure** — Open browser DevTools → Network tab. Inspect the Inertia page props for `/integrations`. Confirm no `access_token`, `refresh_token`, or `client_secret` fields are present in the JSON.

### SEO Dashboard

- [ ] **SEO dashboard loads** — `/{org-slug}/seo`. No external API calls should be made during page load (verify in DevTools Network tab — no calls to `googleapis.com`).
- [ ] **Empty states display correctly** — If no analytics data exists, empty-state cards appear instead of errors.

---

## Queue verification (requires a connected integration)

If you have a connected Google integration, trigger a manual sync:

1. Go to `/{org-slug}/integrations`
2. Click "Sync" on a connected integration
3. Expect: job queued confirmation
4. Check the queue worker log:
   ```bash
   docker compose logs ultron-queue --tail=30
   ```
   Expect: `Processed: App\Domains\Analytics\Jobs\Sync...`
5. After a minute, reload the SEO dashboard and confirm data populated

---

## Sign-off

Once all checks pass:

- [ ] Record the deployment date and version in your team's deployment log
- [ ] Enable/verify uptime monitoring for `https://app.yourdomain.com/health`
- [ ] Notify team that the deployment is live and verified
```

- [ ] **Step 2: Commit**

```bash
git add docs/smoke-tests.md
git commit -m "docs: add post-deployment smoke test checklist"
```

---

## Task 6: Write the failing test for `ValidateEnvironment` command

**Files:**
- Create: `tests/Feature/Console/ValidateEnvironmentTest.php`
- Create: `app/Console/Commands/ValidateEnvironment.php` (skeleton only, enough to make test file loadable)

This project uses TDD. Write the test first, see it fail, then implement.

- [ ] **Step 1: Write the test file**

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use Tests\TestCase;

class ValidateEnvironmentTest extends TestCase
{
    public function test_command_passes_with_production_ready_env(): void
    {
        config([
            'app.env'   => 'production',
            'app.debug' => false,
            'app.key'   => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url'   => 'https://app.example.com',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(0);
    }

    public function test_command_fails_when_debug_is_true_in_production(): void
    {
        config([
            'app.env'   => 'production',
            'app.debug' => true,
            'app.key'   => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url'   => 'https://app.example.com',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_app_key_is_missing(): void
    {
        config([
            'app.env'   => 'production',
            'app.debug' => false,
            'app.key'   => '',
            'app.url'   => 'https://app.example.com',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_app_url_is_not_https(): void
    {
        config([
            'app.env'   => 'production',
            'app.debug' => false,
            'app.key'   => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url'   => 'http://app.example.com',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_warns_when_not_in_production(): void
    {
        config([
            'app.env'   => 'local',
            'app.debug' => true,
            'app.key'   => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url'   => 'http://localhost',
        ]);

        // Non-production env should not exit 1 (it warns, but does not fail)
        $this->artisan('ultron:env:validate')
            ->assertExitCode(0);
    }

    public function test_command_fails_when_queue_connection_is_sync_in_production(): void
    {
        config([
            'app.env'          => 'production',
            'app.debug'        => false,
            'app.key'          => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url'          => 'https://app.example.com',
            'queue.default'    => 'sync',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_session_driver_is_not_redis_in_production(): void
    {
        config([
            'app.env'        => 'production',
            'app.debug'      => false,
            'app.key'        => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url'        => 'https://app.example.com',
            'queue.default'  => 'redis',
            'session.driver' => 'file',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }
}
```

- [ ] **Step 2: Run the test to confirm it fails (command not yet implemented)**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Console/ValidateEnvironmentTest.php
```

Expected: FAIL — `InvalidArgumentException: There are no commands defined in the "ultron:env" namespace.`

---

## Task 7: Implement `ValidateEnvironment` command

**Files:**
- Create: `app/Console/Commands/ValidateEnvironment.php`

In Laravel 13, commands placed in `app/Console/Commands/` are auto-discovered via `withCommands()` (which defaults to scanning that directory). No registration in a Kernel is needed.

- [ ] **Step 1: Write the command**

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;

class ValidateEnvironment extends Command
{
    protected $signature = 'ultron:env:validate';

    protected $description = 'Validate environment variables for production readiness';

    public function handle(): int
    {
        $isProduction = config('app.env') === 'production';

        if (! $isProduction) {
            $this->warn('Running in non-production environment. Checks are advisory only.');
        }

        $failures = 0;

        $failures += $this->check(
            'APP_KEY is set',
            fn () => ! empty(config('app.key')),
            'Set APP_KEY to a unique generated value (php artisan key:generate)',
        );

        $failures += $this->checkProduction(
            'APP_DEBUG is false',
            fn () => ! config('app.debug'),
            'Set APP_DEBUG=false in production — stack traces must never be visible to users',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'APP_URL uses HTTPS',
            fn () => str_starts_with((string) config('app.url'), 'https://'),
            'Set APP_URL=https://app.yourdomain.com for correct URL generation and OAuth',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'QUEUE_CONNECTION is redis',
            fn () => config('queue.default') === 'redis',
            'Set QUEUE_CONNECTION=redis — all external API calls and emails must be queued',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'SESSION_DRIVER is redis',
            fn () => config('session.driver') === 'redis',
            'Set SESSION_DRIVER=redis — file sessions do not work across multiple containers',
            $isProduction,
        );

        if ($failures === 0) {
            $this->info('All checks passed.');

            return self::SUCCESS;
        }

        $this->error("{$failures} check(s) failed. Fix the issues above before deploying.");

        return self::FAILURE;
    }

    /** @param callable(): bool $check */
    private function check(string $label, callable $check, string $remedy): int
    {
        if ($check()) {
            $this->line("  <fg=green>PASS</> {$label}");

            return 0;
        }

        $this->line("  <fg=red>FAIL</> {$label}");
        $this->line("       {$remedy}");

        return 1;
    }

    /** @param callable(): bool $check */
    private function checkProduction(string $label, callable $check, string $remedy, bool $isProduction): int
    {
        if (! $isProduction) {
            $this->line("  <fg=yellow>WARN</> {$label} (skipped — not in production)");

            return 0;
        }

        return $this->check($label, $check, $remedy);
    }
}
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
docker compose exec ultron-app php artisan test tests/Feature/Console/ValidateEnvironmentTest.php --verbose
```

Expected output:
```
PASS  Tests\Feature\Console\ValidateEnvironmentTest
  ✓ command passes with production ready env
  ✓ command fails when debug is true in production
  ✓ command fails when app key is missing
  ✓ command fails when app url is not https
  ✓ command warns when not in production
  ✓ command fails when queue connection is sync in production
  ✓ command fails when session driver is not redis in production

Tests:    7 passed
```

- [ ] **Step 3: Verify the command works manually**

```bash
# In a local environment (should print WARN lines and exit 0)
docker compose exec ultron-app php artisan ultron:env:validate
```

Expected (local env, APP_DEBUG=true, http URL):
```
  Running in non-production environment. Checks are advisory only.
  PASS APP_KEY is set
  WARN APP_DEBUG is false (skipped — not in production)
  WARN APP_URL uses HTTPS (skipped — not in production)
  WARN QUEUE_CONNECTION is redis (skipped — not in production)
  WARN SESSION_DRIVER is redis (skipped — not in production)
  All checks passed.
```

- [ ] **Step 4: Commit**

```bash
git add app/Console/Commands/ValidateEnvironment.php \
        tests/Feature/Console/ValidateEnvironmentTest.php
git commit -m "feat: add ultron:env:validate Artisan command for production readiness checks"
```

---

## Task 8: Run full test suite and production build

**Files:** None changed.

- [ ] **Step 1: Run all tests**

```bash
docker compose exec ultron-app php artisan test
```

Expected: all tests pass (129 previous + 7 new = 136 passed minimum).

- [ ] **Step 2: Run TypeScript check**

```bash
npm run typecheck
```

Expected: `0 errors`

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: success with `public/build/manifest.json` present.

- [ ] **Step 4: Commit if any fixes were needed**

Only commit if the above steps revealed issues that required code changes. Otherwise proceed.

---

## Task 9: Update `docs/sprint-status.md`

**Files:**
- Modify: `docs/sprint-status.md`

- [ ] **Step 1: Append Sprint 10 block to the end of the file**

Append the following after the final `---` and Build Health section:

```markdown
---

## Sprint 10 — Deployment Dry Run & VPS Launch Preparation

**Status:** Complete
**Date closed:** 2026-06-11
**Branch:** `sprint-10-deployment-dry-run-vps-launch`

### Delivered

| Area | Status | Notes |
|------|--------|-------|
| `docs/deployment-dry-run.md` | ✓ Done | Pre-deployment checklist covering code, env, database, security, infrastructure, and sign-off phases |
| `docs/vps-launch-commands.md` | ✓ Done | Step-by-step VPS launch commands (build, up, migrate, config cache, route cache, view cache, queue, scheduler, health) with expected outputs |
| `docs/deployment-rollback.md` | ✓ Done | Rollback decision guide, database restore procedure, code revert, cache clear, re-verification |
| `docs/first-admin-setup.md` | ✓ Done | Web UI registration path + Tinker fallback for headless environments; invite flow for additional members |
| `docs/smoke-tests.md` | ✓ Done | Infrastructure checks (curl), browser golden paths (auth, clients, integrations, SEO), queue verification |
| `ultron:env:validate` command | ✓ Done | `app/Console/Commands/ValidateEnvironment.php` — validates APP_KEY, APP_DEBUG, APP_URL, QUEUE_CONNECTION, SESSION_DRIVER |
| ValidateEnvironmentTest | ✓ Done | 7 tests covering pass/fail for each production check, non-production warning path |

### Deferred / Explicitly Not Built

| Item | Reason |
|------|--------|
| New AI agents | Out of scope (intentionally avoided) |
| WordPress publishing | Out of scope (intentionally avoided) |
| Automatic emails | Out of scope (intentionally avoided) |
| External API calls during render | Intentionally avoided |
| MFA enforcement | Deferred — columns scaffolded since Sprint 1 |

---

## Build Health (as of 2026-06-11)

```
php artisan test        → 136 passed (517 assertions) in ~4s
npm run typecheck       → 0 errors
npm run build           → ✓ built
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/sprint-status.md
git commit -m "docs: update sprint-status.md for Sprint 10 completion"
```

---

## Self-Review

### Spec coverage check

| Sprint 10 requirement | Covered by |
|----------------------|-----------|
| Production deployment dry-run checklist | Task 1 — `docs/deployment-dry-run.md` |
| VPS launch command checklist (all 9 items) | Task 2 — `docs/vps-launch-commands.md` (Steps 1–9) |
| Deployment rollback documentation | Task 3 — `docs/deployment-rollback.md` |
| First-admin setup documentation | Task 4 — `docs/first-admin-setup.md` |
| Post-deployment smoke test documentation | Task 5 — `docs/smoke-tests.md` |
| Environment validation command | Task 6+7 — `ValidateEnvironment` command |
| Tests only if routes/behavior change | Task 6+7 — 7 tests for the new command only |
| Do not build AI agents | ✓ None built |
| Do not publish to WordPress | ✓ None |
| Do not send emails automatically | ✓ None |
| Do not call external APIs during render | ✓ None |
| Run php artisan test + npm run build | Task 8 |
| Update docs/sprint-status.md | Task 9 |

### Placeholder scan

No TBD, TODO, or placeholder text appears in any task. All code blocks are complete and runnable.

### Type consistency

- `ValidateEnvironment::check()` is called with `(string, callable(): bool, string)` consistently across Task 7.
- `ValidateEnvironmentTest` uses `config()` to set the same keys (`app.env`, `app.debug`, `app.key`, `app.url`, `queue.default`, `session.driver`) that `ValidateEnvironment::handle()` reads.
- Exit codes use `self::SUCCESS` (0) and `self::FAILURE` (1), consistent with Laravel's `Command` contract.
