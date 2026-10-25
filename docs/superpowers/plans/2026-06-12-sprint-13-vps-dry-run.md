# Sprint 13 — Staging VPS Deployment Dry Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and guide an actual staging VPS deployment dry run — identify blockers, fix stale docs, produce a complete deployment command sequence, and run final verification.

**Architecture:** No application code changes. Sprint 13 is documentation-only: fix one stale tag reference, produce the Sprint 13 blockers checklist, write the full deployment runbook, update handoff docs, and verify the local codebase is clean and buildable.

**Tech Stack:** Git, Bash, Docker Compose v2.24.4+, PHP Artisan, npm, Caddy

---

## Pre-Task Context

| Item | Value |
|------|-------|
| Current branch | `sprint-13-staging-vps-deployment-dry-run` |
| Latest release tag | `v1.2-sprint-12-complete` |
| Tests | 139 passing, 506 assertions |
| TypeScript | 0 errors |
| npm build | Clean, ~494ms |
| Git status | Clean (nothing to commit at sprint start) |

All application code is complete. This sprint is documentation and readiness only.

**Deployment is BLOCKED** — the VPS, domain, SSH access, and production `.env` values have not been provided. Tasks 1–4 prepare the repo so the owner can unblock the sprint.

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `docs/vps-preflight.md:136` | Fix stale tag `v1.1-sprint-11-complete` → `v1.2-sprint-12-complete` |
| Create | `docs/sprint-13-blockers.md` | Full blockers checklist + staged deployment command sequence |
| Modify | `docs/AI_HANDOFF.md` | Update for Sprint 13 branch, tag, and state |
| Modify | `docs/sprint-status.md` | Add Sprint 13 section |

---

## Task 1: Fix stale tag reference in vps-preflight.md

**Files:**
- Modify: `docs/vps-preflight.md:136`

The Section 5 "Repository" block still tells the deployer to check out `v1.1-sprint-11-complete`. Sprint 12 is now tagged as `v1.2-sprint-12-complete`.

- [ ] **Step 1: Edit the stale checkout line**

In `docs/vps-preflight.md`, find and replace the stale tag reference:

Old (line ~136):
```
  git checkout v1.1-sprint-11-complete   # or the intended release tag
```

New:
```
  git checkout v1.2-sprint-12-complete   # or the intended release tag
```

- [ ] **Step 2: Verify the file looks correct**

Run:
```bash
grep -n "sprint-11\|sprint-12\|sprint-13" docs/vps-preflight.md
```

Expected: only `sprint-12` or `sprint-13` references remain. No `sprint-11` reference in a `git checkout` command.

---

## Task 2: Create Sprint 13 blockers checklist and deployment runbook

**Files:**
- Create: `docs/sprint-13-blockers.md`

This file serves two purposes:
1. Clearly states what the owner must provide before SSH deployment can begin.
2. Embeds the full, ordered staging deployment command sequence so it is ready to execute once blockers are cleared.

- [ ] **Step 1: Create docs/sprint-13-blockers.md**

Create the file with the following content (fill every section exactly as shown):

```markdown
# Sprint 13 — Staging VPS Deployment: Blockers & Runbook

**Status:** BLOCKED — items below must be resolved before deployment can begin.

Deployment docs order: `docs/vps-preflight.md` → `docs/deployment-dry-run.md` → `docs/vps-launch-commands.md` → `docs/smoke-tests.md`

Release tag to deploy: `v1.2-sprint-12-complete`

---

## Section 1 — Blockers Checklist

All items must be confirmed before running any SSH command.

### 1.1 VPS Server

- [ ] VPS server is provisioned (Ubuntu 22.04 LTS or Debian 12)
- [ ] VPS public IP address is known: `___________________`
- [ ] SSH user is known (e.g. `ubuntu`, `root`, `deploy`): `___________________`
- [ ] SSH private key path or password auth method is ready
- [ ] You can SSH in: `ssh <user>@<ip>`
- [ ] The deploying machine's SSH key is authorized on the VPS

### 1.2 DNS

- [ ] Staging subdomain chosen (e.g. `staging-app.yourdomain.com`): `___________________`
- [ ] DNS A record created pointing the staging subdomain to the VPS public IP
- [ ] DNS has propagated (verify: `dig +short staging-app.yourdomain.com` returns the VPS IP)

> Caddy cannot obtain a TLS certificate until DNS resolves to this server.

### 1.3 Git Repository Access from VPS

- [ ] Repository URL is known: `___________________`
- [ ] The VPS can clone the repository (deploy key added to GitHub, or HTTPS token ready)

### 1.4 Production .env Values

Prepare these before starting. Generate the secrets locally:

```bash
# Generate REDIS_PASSWORD
openssl rand -base64 24

# Generate N8N_ENCRYPTION_KEY (must be 32+ chars)
openssl rand -base64 32

# Generate N8N_DB_PASSWORD
openssl rand -base64 20
```

| Variable | Ready? | Notes |
|----------|--------|-------|
| `APP_KEY` | [ ] | Will be generated on the VPS |
| `APP_ENV=production` | [ ] | Hard-coded value |
| `APP_DEBUG=false` | [ ] | Hard-coded value |
| `APP_URL=https://<staging-domain>` | [ ] | Replace with your staging subdomain |
| `DB_PASSWORD` | [ ] | Strong unique password (not `password`) |
| `DB_ROOT_PASSWORD` | [ ] | Strong unique password (not `rootsecret`) |
| `REDIS_PASSWORD` | [ ] | Generated above |
| `SESSION_SECURE_COOKIE=true` | [ ] | Hard-coded value |
| `SESSION_DRIVER=redis` | [ ] | Hard-coded value |
| `QUEUE_CONNECTION=redis` | [ ] | Hard-coded value |
| `N8N_ENCRYPTION_KEY` | [ ] | Generated above (32+ chars) |
| `N8N_DB_PASSWORD` | [ ] | Generated above |
| `MAIL_MAILER` | [ ] | Use `log` for staging (no real emails sent) |
| `GOOGLE_CLIENT_ID` | [ ] | Leave empty for staging dry run |
| `GOOGLE_CLIENT_SECRET` | [ ] | Leave empty for staging dry run |
| `LOG_LEVEL=error` | [ ] | Hard-coded value |

### 1.5 Caddyfile.production

- [ ] `Caddyfile.production` does not exist yet on the VPS — it will be created during setup
- [ ] You have decided on the staging domain to put in the Caddyfile (same as `APP_URL` above)

### 1.6 Local Machine Pre-flight

- [ ] `npm run build` passes on this machine (Vite assets built in `public/build/`)
- [ ] `docker compose exec ultron-app php artisan test` — 139 tests pass
- [ ] `git tag` shows `v1.2-sprint-12-complete` as the latest tag

### 1.7 Approval Gate

- [ ] **Owner has explicitly approved SSH connection to the staging VPS**
- [ ] **Owner has explicitly approved running deployment commands on the staging VPS**
- [ ] The deployment window is agreed on (pick a time with no active users)
- [ ] Rollback procedure is understood: `docs/deployment-rollback.md`

---

## Section 2 — Staged Deployment Command Sequence

**Only begin this section after ALL blockers in Section 1 are cleared and owner approval is given.**

Commands are grouped in the order they must run. Read the full group before running any command in it.

---

### Phase 0 — Local machine (before SSH)

Run these on your LOCAL machine to confirm the release is clean before deploying:

```bash
# Confirm clean branch and correct tag
git status
git tag --sort=-version:refname | head -5
git log --oneline -3

# Build Vite assets (they must be on the VPS before the Docker image builds)
npm ci
npm run build

# Confirm public/build/manifest.json exists
ls -la public/build/manifest.json

# Run full test suite one final time
docker compose exec ultron-app php artisan test

# Run Pint formatting check
docker compose exec ultron-app ./vendor/bin/pint --test

# TypeScript check
npm run typecheck

# Render production Compose model locally (confirm no bind mounts, no public ports)
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```

Expected:
- `git status` → clean
- `v1.2-sprint-12-complete` visible in tags
- `public/build/manifest.json` exists
- 139 tests pass, 506 assertions
- Pint: PASS (159 files)
- TypeScript: 0 errors
- Compose config: app/queue/scheduler have no repository bind mounts; MySQL/Redis/n8n have no host ports

**Do not proceed if any check fails.**

---

### Phase 1 — VPS server-level preflight (vps-preflight.md)

SSH into the VPS:
```bash
ssh <user>@<vps-ip>
```

#### 1A — OS check
```bash
lsb_release -a
sudo apt-get update && sudo apt-get upgrade -y
```
Expected: `Ubuntu 22.04` or `Debian GNU/Linux 12`

#### 1B — Docker
```bash
docker --version
```
Expected: `Docker version 24.x.x` or higher.

If missing:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

```bash
docker compose version
```
Expected: `Docker Compose version v2.24.4` or higher.

If missing:
```bash
sudo apt-get install docker-compose-plugin
```

```bash
docker ps
```
Expected: empty table, no permission error.

#### 1C — Firewall
```bash
sudo ufw status
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```
Expected: SSH, 80/tcp, 443/tcp are ALLOW. No 3306, 6379, or 5678 lines.

#### 1D — DNS verification
```bash
# On VPS — get public IP
curl -s ifconfig.me

# From your local machine
dig +short <staging-domain>
```
Both must return the same IP.

#### 1E — Clone repository
```bash
sudo mkdir -p /srv/ultron
sudo chown $USER:$USER /srv/ultron
git clone <repo-url> /srv/ultron
cd /srv/ultron
git tag --sort=-version:refname | head -5
git checkout v1.2-sprint-12-complete
```
Expected: tag list visible, checkout succeeds cleanly.

#### 1F — Caddyfile.production
```bash
cp Caddyfile.production.example Caddyfile.production
nano Caddyfile.production   # or vi
```

Replace `app.yourdomain.com` with your staging domain.
Replace `admin@yourdomain.com` with your email (for Let's Encrypt).

Save and verify:
```bash
head -15 Caddyfile.production
```
Expected: your staging domain appears at line 11.

#### 1G — .env setup
```bash
cp .env.example .env
nano .env   # or vi
```

Set all values from Section 1.4 of this document.

Generate APP_KEY:
```bash
docker compose run --rm ultron-app php artisan key:generate --show
```
Paste the output (starts with `base64:`) into `.env` as `APP_KEY=base64:...`

Set permissions:
```bash
chmod 600 .env
ls -la .env
```
Expected: `-rw-------`

#### 1H — Render and inspect production Compose config
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```

Confirm all of these:
- `ultron-app`, `ultron-queue`, `ultron-scheduler`: use `target: production`, NO repository or `vendor` bind mounts
- `caddy`: mounts `./Caddyfile.production` and `./public:/var/www/html/public:ro`
- `ultron-mysql`, `ultron-redis`, `n8n-main`: NO `ports` entries
- `ultron-redis`: has `--requirepass` in command and `REDISCLI_AUTH` healthcheck

#### 1I — Run env:validate
```bash
docker compose run --rm --env-file .env ultron-app php artisan ultron:env:validate
```
Expected output:
```
  PASS  APP_KEY is set
  PASS  APP_DEBUG is false
  PASS  APP_URL uses HTTPS
  PASS  QUEUE_CONNECTION is redis
  PASS  SESSION_DRIVER is redis
  PASS  SESSION_SECURE_COOKIE is true
  PASS  REDIS_PASSWORD is set
All checks passed.
```
Every item must show PASS. Fix any WARN or FAIL before proceeding.

---

### Phase 2 — App-level dry run (deployment-dry-run.md)

Still on the VPS, from `/srv/ultron`:

#### 2A — Code & Build checks
```bash
git status
git tag --sort=-version:refname | head -3

# Confirm public/build/manifest.json exists (copied from local or built on VPS)
ls -la public/build/manifest.json
```

> **Note:** `public/build/` is git-ignored. You must either:
> a. Run `npm ci && npm run build` on the VPS (requires Node.js), OR
> b. Copy the built `public/build/` directory from your local machine via `scp`:
>    ```bash
>    scp -r public/build/ <user>@<vps-ip>:/srv/ultron/public/
>    ```
> Caddy serves `./public` read-only, so the manifest must exist before starting containers.

#### 2B — Render production Compose (again, on VPS)
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```
Same checks as Phase 1H above.

#### 2C — Security checklist
Work through every item in `docs/security-checklist.md`. The Compose config check above covers MySQL/Redis ports. Remaining items to verify manually:
- `APP_KEY`, `APP_DEBUG`, `APP_ENV` set correctly in `.env`
- `SESSION_SECURE_COOKIE=true`
- `REDIS_PASSWORD` is a strong generated password
- `N8N_ENCRYPTION_KEY` is 32+ chars and not the default
- `.env` permissions are `600`
- No secrets in git history: `git log -p | grep -i "APP_KEY\|DB_PASSWORD\|REDIS_PASSWORD"` → no output

---

### Phase 3 — Launch commands (vps-launch-commands.md)

#### Step 1 — Build production Docker image
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml build
```
Expected: build completes without ERROR lines.

#### Step 2 — Start all services
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```
Expected:
```
[+] Running 8/8
 ✔ Container ultron-mysql-1        Started
 ✔ Container ultron-redis-1        Started
 ✔ Container ultron-n8n-postgres-1 Started
 ✔ Container ultron-app-1          Started
 ✔ Container ultron-queue-1        Started
 ✔ Container ultron-scheduler-1    Started
 ✔ Container ultron-n8n-main-1     Started
 ✔ Container caddy-1               Started
```

Verify all containers running:
```bash
docker compose ps
```
All containers must show `running`. No `exited` or `restarting`.

#### Step 3 — Wait for MySQL to be healthy, then migrate
```bash
docker compose exec ultron-app php artisan migrate:status
docker compose exec ultron-app php artisan migrate --force
docker compose exec ultron-app php artisan migrate:status
```
Expected (first deploy): all migrations show `Ran` after migrate.

If any migration fails, do NOT proceed. See `docs/deployment-rollback.md`.

#### Step 4 — Cache configuration, routes, views
```bash
docker compose exec ultron-app php artisan config:cache
docker compose exec ultron-app php artisan route:cache
docker compose exec ultron-app php artisan view:cache
```
Expected:
```
   INFO  Configuration cached successfully.
   INFO  Routes cached successfully.
   INFO  Blade templates cached successfully.
```

#### Step 5 — Verify queue worker
```bash
docker compose ps ultron-queue
docker compose logs ultron-queue --tail=30
docker compose exec ultron-app php artisan queue:failed
```
Expected: status `Up`, no CRITICAL in logs, empty failed jobs table.

#### Step 6 — Verify scheduler
```bash
docker compose logs ultron-scheduler --tail=20
```
Expected: `Running scheduled commands...` or `No scheduled commands are ready to run.`

#### Step 7 — Verify Redis auth
```bash
docker compose exec ultron-redis redis-cli ping
```
Expected: `NOAUTH Authentication required.`

```bash
docker compose exec ultron-redis sh -lc 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
```
Expected: `PONG`

#### Step 8 — Verify health endpoint and HTTPS
```bash
curl -s https://<staging-domain>/health
```
Expected: `{"status":"ok"}`

```bash
curl -I https://<staging-domain>
```
Expected first line: `HTTP/2 200` and `strict-transport-security` header present.

```bash
curl -I http://<staging-domain>
```
Expected: `HTTP/1.1 301 Moved Permanently` redirecting to HTTPS.

```bash
curl -I https://<staging-domain>/build/manifest.json
```
Expected: `HTTP/2 200`

If TLS is not ready yet, check:
```bash
docker compose logs caddy --tail=30
```
Caddy logs will show certificate acquisition status. DNS must resolve before the cert can be issued.

#### Step 9 — Verify n8n
```bash
docker compose ps n8n-main n8n-postgres
docker compose logs n8n-main --tail=30
```
Expected: both `Up`, no database connection errors, `n8n-main` has NO public host port.

#### Step 10 — Storage permissions
```bash
docker compose exec ultron-app php artisan storage:link
docker compose exec ultron-app sh -lc 'test -w storage && test -w bootstrap/cache && echo "Storage OK"'
```
Expected: `Storage OK`

#### Step 11 — Logs and backup
```bash
docker compose logs ultron-app --tail=50
docker compose logs caddy --tail=50
ls -la /srv/backups
```
Expected: no fatal errors, no stack traces, no leaked credentials.

> **Backup note:** For a staging dry run, no data exists yet so a pre-deployment backup is not required. Run the manual backup cron immediately after first-admin setup to verify the backup mechanism works.

#### Step 12 — Rollback readiness
```bash
git tag --sort=-version:refname | head -10
```
Expected: `v1.2-sprint-12-complete` visible. Keep `docs/deployment-rollback.md` open during the deployment window.

---

### Phase 4 — First admin setup

See `docs/first-admin-setup.md` for full instructions.

Option A (web UI):
1. Open `https://<staging-domain>/register` in browser
2. Register the first user — this auto-creates the first organization
3. Verify email (check `docker compose logs ultron-app | grep "To:"` if using `log` mailer)
4. Confirm redirect to dashboard

Option B (Artisan Tinker — if email is blocked):
```bash
docker compose exec ultron-app php artisan tinker
```
```php
$user = \App\Domains\Identity\Models\User::create([
    'name' => 'Admin',
    'email' => 'admin@example.com',
    'password' => bcrypt('your-secure-password'),
    'email_verified_at' => now(),
]);
```

---

### Phase 5 — Smoke tests (smoke-tests.md)

Run every check in `docs/smoke-tests.md`. Record pass/fail for each item.

Key checks (summarized):
```bash
# Infrastructure
curl -s https://<staging-domain>/health                          # {"status":"ok"}
curl -I https://<staging-domain>                                 # HTTP/2 200
curl -I http://<staging-domain>                                  # 301 redirect
curl https://<staging-domain>/this-route-does-not-exist          # 404 no stack trace
docker compose ps                                                # all Up, no Restarting
docker compose exec ultron-app php artisan queue:failed          # No failed jobs
docker compose exec ultron-app php artisan migrate:status        # all Ran
docker compose exec ultron-redis redis-cli ping                  # NOAUTH
docker compose exec ultron-redis sh -lc 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'  # PONG
curl -I https://<staging-domain>/build/manifest.json             # HTTP/2 200
docker compose ps n8n-main n8n-postgres                          # both Up
docker compose exec ultron-app sh -lc 'test -w storage && test -w bootstrap/cache && echo "Storage OK"'
docker compose logs ultron-app --tail=50                         # no fatal errors
docker compose logs caddy --tail=50                              # no fatal errors
```

Browser checks (use incognito window):
- Register new user → email verification → dashboard loads
- Log out → log back in
- Settings, Members, Clients, Websites, Integrations pages all load
- DevTools Network: no googleapis.com calls during page load
- DevTools Network: no access_token/refresh_token in Inertia props

---

### Phase 6 — Post-deployment sign-off

- [ ] All smoke test items pass
- [ ] Record deployment: date `2026-06-12`, version `v1.2-sprint-12-complete`, deployer `<name>`
- [ ] Configure uptime monitor to poll `https://<staging-domain>/health` every 5 minutes
- [ ] Notify owner that staging deployment is live and verified
- [ ] **Do NOT merge, tag, push to GitHub, or promote to production until owner explicitly approves**

---

## Section 3 — Known Product Gaps (not blocking this sprint)

These are pre-existing issues that remain after Sprint 13:

| Gap | Impact on Staging Dry Run |
|-----|--------------------------|
| MFA not enforced | Login works; MFA prompt does not appear |
| OAuth token refresh not implemented | Google OAuth connect works; sync may fail when stored tokens expire |
| Scheduled analytics sync not wired | Scheduler runs but no auto-analytics sync cadence |
| n8n has no Laravel webhook handlers | n8n container runs; no workflow triggers |
| Error pages (403/404/500) not scaffolded | Errors show Laravel defaults |
| Billing/subscription not implemented | `plan`/`seats` columns exist but no enforcement |

None of these block the staging dry run.
```

- [ ] **Step 2: Verify the file was created**

Run:
```bash
wc -l docs/sprint-13-blockers.md
```
Expected: approximately 250+ lines (the file is substantial).

---

## Task 3: Update AI_HANDOFF.md for Sprint 13

**Files:**
- Modify: `docs/AI_HANDOFF.md`

- [ ] **Step 1: Update the header block**

In `docs/AI_HANDOFF.md`, replace the top header block:

Old:
```markdown
**Last updated:** 2026-06-12
**Current branch:** `sprint-12-real-vps-deployment-dry-run`
**Release tag:** `v1.1-sprint-11-complete`
**Sprints completed:** 1–11 (merged to `main`), Sprint 12 complete on branch pending Claude review
```

New:
```markdown
**Last updated:** 2026-06-12
**Current branch:** `sprint-13-staging-vps-deployment-dry-run`
**Release tag:** `v1.2-sprint-12-complete`
**Sprints completed:** 1–12 (all merged to `main` and tagged), Sprint 13 in progress
```

- [ ] **Step 2: Update the Sprint 12 Handoff section at the bottom**

Replace the "Sprint 12 Handoff" section heading and the "Remaining Tasks" and "Recommended Claude Prompt" subsections with a Sprint 13 Handoff section:

```markdown
## Sprint 13 Handoff

**Current branch:** `sprint-13-staging-vps-deployment-dry-run`
**Latest commit:** Sprint 13 plan and doc fixes
**Release tag baseline:** `v1.2-sprint-12-complete`

### Status

Sprint 13 is a documentation-only sprint preparing the actual staging VPS deployment dry run. No application code was changed.

### Completed Work

- Fixed stale tag reference in `docs/vps-preflight.md` (v1.1 → v1.2)
- Created `docs/sprint-13-blockers.md` — full blockers checklist and staged deployment command sequence
- Updated `docs/AI_HANDOFF.md` and `docs/sprint-status.md` for Sprint 13

### Deployment Blockers

Deployment cannot proceed until the owner provides:
1. Staging VPS IP and SSH access
2. Staging subdomain with DNS A record
3. Git repository access from the VPS
4. Production `.env` values (see `docs/sprint-13-blockers.md` Section 1.4)
5. Explicit owner approval to SSH and deploy

See `docs/sprint-13-blockers.md` for the complete blockers checklist and full deployment command sequence.

### Exact Remaining Tasks

1. Owner provides VPS, domain, SSH access, and `.env` values
2. Owner gives explicit approval to deploy
3. Execute the staged deployment command sequence in `docs/sprint-13-blockers.md`
4. Record smoke test results
5. Owner approves production promotion (separate sprint)
```

- [ ] **Step 3: Verify the edit**

```bash
head -10 docs/AI_HANDOFF.md
grep -n "sprint-13\|sprint-12\|v1.2" docs/AI_HANDOFF.md | head -10
```
Expected: header block shows `sprint-13-staging-vps-deployment-dry-run` and `v1.2-sprint-12-complete`.

---

## Task 4: Add Sprint 13 entry to sprint-status.md

**Files:**
- Modify: `docs/sprint-status.md`

- [ ] **Step 1: Append Sprint 13 section at the end of the file**

Add this section at the very end of `docs/sprint-status.md`:

```markdown
---

## Sprint 13 — Staging VPS Deployment Dry Run

**Status:** In Progress
**Date started:** 2026-06-12
**Branch:** `sprint-13-staging-vps-deployment-dry-run`

### Goal

Execute the actual staging VPS deployment dry run using the runbooks prepared in Sprints 9–12. Identify all blockers before SSH deployment begins, fix any stale documentation, and run final local verification.

### Delivered

| Area | Status | Notes |
|------|--------|-------|
| Stale tag fix in vps-preflight.md | ✓ Done | `v1.1-sprint-11-complete` → `v1.2-sprint-12-complete` |
| Sprint 13 blockers checklist | ✓ Done | `docs/sprint-13-blockers.md` — full list of required VPS/domain/credential items |
| Staged deployment command sequence | ✓ Done | Embedded in `docs/sprint-13-blockers.md` Section 2 — Phases 0–6 |
| AI_HANDOFF.md update | ✓ Done | Updated branch, tag, handoff state |
| sprint-status.md update | ✓ Done | This section |

### Blocked Items (requires owner action)

| Blocker | Owner Action Required |
|---------|----------------------|
| Staging VPS not provisioned | Provision Ubuntu 22.04 LTS, 2 vCPU, 2 GB RAM |
| Staging domain not set | Create DNS A record for staging subdomain |
| SSH access not confirmed | Provide SSH user and key; confirm can connect |
| Production .env not prepared | Fill out Section 1.4 in `docs/sprint-13-blockers.md` |
| Explicit deployment approval | Owner must say "proceed with deployment" |

### Deferred / Explicitly Not Built

| Item | Reason |
|------|--------|
| Actual VPS deployment | BLOCKED — awaiting owner-provided VPS and credentials |
| GitHub push / merge / release tag | Awaiting deployment completion and owner approval |
| External API calls | Out of scope; staging dry run avoids real provider calls |
| MFA enforcement | Ongoing known gap |
| OAuth token refresh | Ongoing known gap |
```

- [ ] **Step 2: Verify the append**

```bash
tail -20 docs/sprint-status.md
```
Expected: Sprint 13 section visible at the end.

---

## Task 5: Run final verification

**Files:** None (read-only checks)

- [ ] **Step 1: Check git status**

```bash
git status
```
Expected output:
```
On branch sprint-13-staging-vps-deployment-dry-run
Changes not staged for commit:
  (use "git add <file>..." to update staging area)

        modified:   docs/AI_HANDOFF.md
        modified:   docs/sprint-status.md
        modified:   docs/vps-preflight.md

Untracked files:
        docs/sprint-13-blockers.md
```

- [ ] **Step 2: Run full test suite**

```bash
docker compose exec ultron-app php artisan test
```
Expected:
```
   PASS  Tests\...
   ...
  Tests:  139 passed (506 assertions)
  Duration: ~1.8s
```

All 139 tests must pass. No failures, no errors.

- [ ] **Step 3: Run production build**

```bash
npm run build
```
Expected:
```
vite v5.x.x building for production...
✓ NNN modules transformed.
dist/build/manifest.json                  x.xx kB
...
✓ built in XXXms
```
Build must complete without errors.

- [ ] **Step 4: Run TypeScript check**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 5: Render production Compose**

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```
Confirm:
- `ultron-app`, `ultron-queue`, `ultron-scheduler`: NO repository or vendor bind mounts
- `caddy`: mounts `./Caddyfile.production` and `./public:/var/www/html/public:ro`
- `ultron-mysql`, `ultron-redis`, `n8n-main`: NO `ports` entries
- `ultron-redis`: has `--requirepass` in command

---

## Task 6: Commit Sprint 13 documentation

**Files:**
- `docs/vps-preflight.md`
- `docs/AI_HANDOFF.md`
- `docs/sprint-status.md`
- `docs/sprint-13-blockers.md` (new)
- `docs/superpowers/plans/2026-06-12-sprint-13-vps-dry-run.md` (this plan)

- [ ] **Step 1: Stage all changed files**

```bash
git add docs/vps-preflight.md \
        docs/AI_HANDOFF.md \
        docs/sprint-status.md \
        docs/sprint-13-blockers.md \
        "docs/superpowers/plans/2026-06-12-sprint-13-vps-dry-run.md"
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: Sprint 13 staging VPS dry run — blockers checklist, deployment runbook, and stale tag fix"
```

- [ ] **Step 3: Verify commit**

```bash
git status
git log --oneline -3
```
Expected: working tree clean; Sprint 13 commit visible at the top.

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|-------------|------|
| Do not change code first | ✓ No code changes in this plan |
| Review staging VPS deployment checklist | ✓ All docs read; findings embedded in plan |
| Confirm VPS information required | ✓ Task 2 Section 1 blockers checklist |
| Prepare step-by-step staging deployment command sequence | ✓ Task 2 Section 2 Phases 0–6 |
| Do not run SSH commands unless explicitly approved | ✓ Blocked; no SSH commands in plan execution |
| Do not expose credentials | ✓ No credentials in any file |
| Do not push to GitHub unless explicitly approved | ✓ Not in plan |
| Do not call external APIs | ✓ Not in plan |
| Do not send emails | ✓ Not in plan |
| If deployment blocked, create blockers checklist and stop | ✓ Task 2; deployment is blocked |
| Fix small doc issues | ✓ Task 1 — stale tag reference |
| git status | ✓ Task 5 Step 1 |
| docker compose exec ultron-app php artisan test | ✓ Task 5 Step 2 |
| npm run build | ✓ Task 5 Step 3 |
| Do not merge or tag Sprint 13 | ✓ Not in plan |

### Placeholder scan

No TBD, TODO, or "similar to Task N" references in this plan.

### Type consistency

No code types in this plan — documentation only. No consistency issues.
