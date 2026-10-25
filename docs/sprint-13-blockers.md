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
| `APP_KEY` | [ ] | Will be generated on the VPS via artisan key:generate |
| `APP_ENV=production` | [ ] | Hard-coded value |
| `APP_DEBUG=false` | [ ] | Hard-coded value |
| `APP_URL=https://<staging-domain>` | [ ] | Replace with your staging subdomain |
| `DB_PASSWORD` | [ ] | Strong unique password (not `password`) |
| `DB_ROOT_PASSWORD` | [ ] | Strong unique password (not `rootsecret`) |
| `REDIS_PASSWORD` | [ ] | Generated above |
| `SESSION_SECURE_COOKIE=true` | [ ] | Hard-coded value |
| `SESSION_DRIVER=redis` | [ ] | Hard-coded value |
| `QUEUE_CONNECTION=redis` | [ ] | Hard-coded value |
| `N8N_ENCRYPTION_KEY` | [ ] | Generated above (must be 32+ chars, not the default) |
| `N8N_DB_PASSWORD` | [ ] | Generated above |
| `MAIL_MAILER=log` | [ ] | Use `log` for staging — no real emails sent |
| `GOOGLE_CLIENT_ID` | [ ] | Leave empty for staging dry run |
| `GOOGLE_CLIENT_SECRET` | [ ] | Leave empty for staging dry run |
| `LOG_LEVEL=error` | [ ] | Hard-coded value |

### 1.5 Caddyfile.production

- [ ] You have decided on the staging domain (same as `APP_URL` above, without `https://`)
- [ ] `Caddyfile.production` will be created on the VPS from `Caddyfile.production.example` during setup

### 1.6 Local Machine Pre-flight

- [ ] `npm run build` passes on this machine — `public/build/manifest.json` exists
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

Run these on your LOCAL machine to confirm the release is clean before deploying.

```bash
# Confirm clean branch and correct tag
git status
git tag --sort=-version:refname | head -5
git log --oneline -3

# Build Vite assets (they must exist before the Docker image builds on the VPS)
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

**Do not proceed to Phase 1 if any check fails.**

---

### Phase 1 — VPS server-level preflight

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
```

If inactive:
```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

Open HTTP and HTTPS:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```
Expected: SSH, 80/tcp, 443/tcp are ALLOW. No 3306, 6379, or 5678 entries.

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
nano Caddyfile.production
```

Replace:
- `app.yourdomain.com` → your staging domain
- `admin@yourdomain.com` → your email (for Let's Encrypt notifications)

Verify:
```bash
head -15 Caddyfile.production
grep "yourdomain" Caddyfile.production
```
Expected: your staging domain appears; no `yourdomain.com` placeholders remain.

#### 1G — .env setup
```bash
cp .env.example .env
nano .env
```

Set all values from Section 1.4 of this document.

Generate APP_KEY:
```bash
docker compose run --rm ultron-app php artisan key:generate --show
```
Paste the output (starts with `base64:`) into `.env` as `APP_KEY=base64:...`

Set file permissions:
```bash
chmod 600 .env
ls -la .env
```
Expected: `-rw-------`

#### 1H — Vite assets on VPS

`public/build/` is git-ignored. You must get it onto the VPS by one of:

**Option A — Copy from local machine:**
```bash
# Run from your LOCAL machine
scp -r public/build/ <user>@<vps-ip>:/srv/ultron/public/
```

**Option B — Build on VPS (requires Node.js on the VPS):**
```bash
# On VPS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /srv/ultron
npm ci
npm run build
```

Verify:
```bash
ls -la /srv/ultron/public/build/manifest.json
```
Expected: file exists.

#### 1I — Render and inspect production Compose config
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```

Confirm all of these:
- `ultron-app`, `ultron-queue`, `ultron-scheduler`: use `target: production`, NO repository or `vendor` bind mounts
- `caddy`: mounts `./Caddyfile.production` and `./public:/var/www/html/public:ro`
- `ultron-mysql`, `ultron-redis`, `n8n-main`: NO `ports` entries
- `ultron-redis`: has `--requirepass` in command and `REDISCLI_AUTH` healthcheck

#### 1J — Run env:validate
```bash
docker compose run --rm --env-file .env ultron-app php artisan ultron:env:validate
```
Expected:
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

### Phase 2 — App-level dry run

Still on the VPS, from `/srv/ultron`.

#### 2A — Pre-deploy security checks

```bash
# No secrets in git history
git log -p | grep -i "APP_KEY\|DB_PASSWORD\|REDIS_PASSWORD"
```
Expected: no output.

```bash
# .env is not committed
cat .gitignore | grep "\.env"
```
Expected: `.env` line present.

```bash
# .env permissions
ls -la .env
```
Expected: `-rw-------`

#### 2B — Migration dry run
```bash
docker compose exec ultron-app php artisan migrate --pretend --force
```
Review the output. If any destructive operations appear (DROP COLUMN, DROP TABLE), confirm they are intentional.

---

### Phase 3 — Launch commands

#### Step 1 — Build production Docker image
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml build
```
Expected: build completes without any `ERROR` lines. npm warnings during install are acceptable.

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

Verify all containers are running:
```bash
docker compose ps
```
All containers must show `running`. No `exited` or `restarting`.

#### Step 3 — Run database migrations
```bash
docker compose exec ultron-app php artisan migrate:status
docker compose exec ultron-app php artisan migrate --force
docker compose exec ultron-app php artisan migrate:status
```
Expected (first deploy): all migrations show `Ran` after `migrate --force`.

If any migration fails, stop immediately. See `docs/deployment-rollback.md`.

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
Expected: status `Up`, no CRITICAL or unhandled exception in logs, empty failed jobs table.

#### Step 6 — Verify scheduler
```bash
docker compose ps ultron-scheduler
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

> Note: TLS certificate acquisition can take 1–2 minutes after Caddy starts. If `https://` fails immediately, wait 2 minutes and retry before investigating.

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

If TLS fails, check Caddy logs:
```bash
docker compose logs caddy --tail=30
```

#### Step 9 — Verify n8n
```bash
docker compose ps n8n-main n8n-postgres
docker compose logs n8n-main --tail=30
```
Expected: both `Up`, no database connection errors, no public port in `docker compose ps`.

To access n8n admin panel during dry run (do NOT expose publicly):
```bash
# From your local machine
ssh -L 5678:localhost:5678 <user>@<vps-ip>
# Then open http://localhost:5678 in your browser
```

#### Step 10 — Storage permissions
```bash
docker compose exec ultron-app php artisan storage:link
docker compose exec ultron-app sh -lc 'test -w storage && test -w bootstrap/cache && echo "Storage OK"'
```
Expected: `Storage OK`

#### Step 11 — Logs and backup readiness
```bash
docker compose logs ultron-app --tail=50
docker compose logs caddy --tail=50
sudo mkdir -p /srv/backups
ls -la /srv/backups
```
Expected: no fatal errors or leaked credentials in logs; `/srv/backups` directory exists.

#### Step 12 — Rollback readiness
```bash
git tag --sort=-version:refname | head -10
```
Expected: `v1.2-sprint-12-complete` visible. Keep `docs/deployment-rollback.md` open during the deployment window.

---

### Phase 4 — First admin setup

See `docs/first-admin-setup.md` for full instructions.

**Option A — Web UI (preferred):**
1. Open `https://<staging-domain>/register` in an incognito browser window
2. Register the first user — this auto-creates the first organization
3. If using `MAIL_MAILER=log`, check mail log: `docker compose logs ultron-app | grep -A 5 "To:"`
4. Click the email verification link (copy from logs if using log driver)
5. Confirm redirect to org dashboard

**Option B — Artisan Tinker (fallback if mail is blocked):**
```bash
docker compose exec ultron-app php artisan tinker
```
```php
$user = \App\Domains\Identity\Models\User::create([
    'name' => 'Admin',
    'email' => 'admin@example.com',
    'password' => bcrypt('change-this-password'),
    'email_verified_at' => now(),
]);
echo $user->id;
```

---

### Phase 5 — Smoke tests

Run every check in `docs/smoke-tests.md`. Record pass/fail for each item.

Infrastructure checks (run from VPS):
```bash
curl -s https://<staging-domain>/health                          # → {"status":"ok"}
curl -I https://<staging-domain>                                 # → HTTP/2 200
curl -I http://<staging-domain>                                  # → 301 redirect to HTTPS
curl https://<staging-domain>/this-route-does-not-exist          # → 404, no stack trace
docker compose ps                                                # all Up, no Restarting
docker compose exec ultron-app php artisan queue:failed          # No failed jobs
docker compose exec ultron-app php artisan migrate:status        # all Ran
docker compose exec ultron-redis redis-cli ping                  # NOAUTH Authentication required.
docker compose exec ultron-redis sh -lc 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'  # PONG
curl -I https://<staging-domain>/build/manifest.json             # HTTP/2 200
docker compose ps n8n-main n8n-postgres                          # both Up
docker compose exec ultron-app sh -lc 'test -w storage && test -w bootstrap/cache && echo "Storage OK"'
docker compose logs ultron-app --tail=50                         # no fatal errors, no leaked credentials
docker compose logs caddy --tail=50                              # no fatal errors
```

Browser checks (use incognito window, replace `<staging-domain>`):
- [ ] Register new user at `https://<staging-domain>/register`
- [ ] Verify email (from mail log or inbox)
- [ ] Log out → log back in
- [ ] Org dashboard loads: `https://<staging-domain>/<org-slug>/dashboard`
- [ ] Settings page loads
- [ ] Members page loads; send a test invitation
- [ ] Clients page loads; create a test client
- [ ] Websites page loads; create a test website
- [ ] Integrations page loads
- [ ] DevTools Network: no `googleapis.com` calls during page load
- [ ] DevTools Network: no `access_token`, `refresh_token`, or `client_secret` in Inertia page props
- [ ] SEO dashboard loads; empty states display correctly (no API calls)
- [ ] Go to `https://<staging-domain>/<other-org-slug>/dashboard` — expect 403 Forbidden

---

### Phase 6 — Post-deployment sign-off

- [ ] All smoke test items pass — record results
- [ ] Record deployment: date `___`, version `v1.2-sprint-12-complete`, deployer `<name>`
- [ ] Configure uptime monitor to poll `https://<staging-domain>/health` every 5 minutes
- [ ] Notify owner that staging deployment is live and verified
- [ ] **Do NOT merge, tag, push to GitHub, or promote to production without explicit owner approval**

---

## Section 3 — Known Product Gaps

Pre-existing issues that remain after Sprint 13 (none block the staging dry run):

| Gap | Impact on Staging Dry Run |
|-----|--------------------------|
| MFA not enforced | Login works; MFA prompt does not appear — acceptable for staging |
| OAuth token refresh not implemented | Google OAuth connect works; sync may fail when tokens expire |
| Scheduled analytics sync not wired | Scheduler runs but no auto-analytics sync cadence |
| n8n has no Laravel webhook handlers | n8n container runs; no workflow triggers from Laravel |
| Error pages (403/404/500) not scaffolded | Errors show Laravel defaults — not ideal but not a blocker |
| Billing/subscription not implemented | `plan`/`seats` columns exist but no enforcement |
