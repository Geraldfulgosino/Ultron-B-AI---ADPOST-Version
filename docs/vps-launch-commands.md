# VPS Launch Commands

Run these commands in order on a fresh VPS deployment. Each step lists the command, what it does, and the expected output. If the output does not match, stop and investigate before proceeding.

---

## Prerequisites

- VPS is provisioned (Ubuntu 22.04 LTS, 2 vCPU, 2 GB RAM minimum)
- Docker 24+ and Docker Compose v2.24.4+ are installed
- DNS points `app.yourdomain.com` to the VPS public IP
- You have run through `docs/vps-preflight.md` (server-level requirements) and all items are checked
- You have run through `docs/deployment-dry-run.md` (app-level checks) and all items are checked
- You are in `/srv/ultron` (the cloned repository directory)
- `Caddyfile.production` exists and contains the real deployment hostname
- `npm run build` has been run on the VPS and `public/build/manifest.json` exists

---

## Step 1 — Render and inspect the production Compose config

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```

**What it does:** Renders the exact Compose model that Docker will run after applying the production override.

**Expected checks:**
- `ultron-app`, `ultron-queue`, and `ultron-scheduler` use `target: production` and have no repository or `vendor` bind mounts.
- `caddy` mounts `./Caddyfile.production` and `./public:/var/www/html/public:ro`.
- `ultron-mysql`, `ultron-redis`, and `n8n-main` do not publish host ports.
- `ultron-redis` includes `--requirepass` and an authenticated healthcheck.

If any item is wrong, stop before building.

---

## Step 2 — Build the production Docker image

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml build
```

**What it does:** Builds the `production` Dockerfile target and installs optimized PHP dependencies. The image copies the current repository state, including `public/build/` when it exists in the build context.

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

## Step 3 — Start all services

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
 ✔ Container ultron-n8n-main-1     Started
 ✔ Container caddy-1               Started
```

Verify all containers are running:
```bash
docker compose ps
```
All containers must show `running` (not `exited` or `restarting`).

---

## Step 4 — Run database migrations

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

Verify migration status:

```bash
docker compose exec ultron-app php artisan migrate:status
```

Expected: every required migration shows `Ran`.

---

## Step 5 — Cache configuration

```bash
docker compose exec ultron-app php artisan config:cache
```

**What it does:** Merges all config files into a single cached file, eliminating repeated file reads. Required in production.

**Expected output:**
```
   INFO  Configuration cached successfully.
```

---

## Step 6 — Cache routes

```bash
docker compose exec ultron-app php artisan route:cache
```

**What it does:** Compiles all route definitions into a single cached file. Speeds up routing in production.

**Expected output:**
```
   INFO  Routes cached successfully.
```

---

## Step 7 — Cache views

```bash
docker compose exec ultron-app php artisan view:cache
```

**What it does:** Pre-compiles all Blade templates. Reduces first-request latency.

**Expected output:**
```
   INFO  Blade templates cached successfully.
```

---

## Step 8 — Verify queue worker

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

## Step 9 — Verify scheduler

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

## Step 10 — Verify Redis auth

```bash
docker compose exec ultron-redis redis-cli ping
```

**Expected output:** `NOAUTH Authentication required.`

Then verify authenticated access:

```bash
docker compose exec ultron-redis sh -lc 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
```

**Expected output:** `PONG`

---

## Step 11 — Verify health endpoint, HTTPS, and static assets

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

Verify the Vite manifest is served by Caddy:

```bash
curl -I https://app.yourdomain.com/build/manifest.json
# Must return: HTTP/2 200
```

If `/health` returns anything other than `{"status":"ok"}`, check:
1. `docker compose ps` — all containers running?
2. `docker compose logs caddy --tail=20` — TLS cert obtained?
3. `docker compose logs ultron-app --tail=20` — PHP-FPM errors?

---

## Step 12 — Verify n8n container health

```bash
docker compose ps n8n-main n8n-postgres
docker compose logs n8n-main --tail=30
```

Expected: both containers are `Up`, n8n logs do not show database connection failures, and `n8n-main` has no published host port in `docker compose ps`.

---

## Step 13 — Verify storage permissions

```bash
docker compose exec ultron-app php artisan storage:link
docker compose exec ultron-app sh -lc 'test -w storage && test -w bootstrap/cache && echo "Storage OK"'
```

Expected: `Storage OK`. If `storage:link` reports the link already exists, that is acceptable.

---

## Step 14 — Verify logs and backup presence

```bash
docker compose logs ultron-app --tail=50
docker compose logs caddy --tail=50
ls -la /srv/backups
```

Expected: no fatal errors or leaked secrets in logs, and at least one verified database backup is present before handling production data.

---

## Step 15 — Confirm rollback readiness

```bash
git tag --sort=-version:refname | head -10
ls -la /srv/backups/ultron-*.sql.gz
```

Expected: the previous known-good release tag is visible and a restorable database backup exists. Keep `docs/deployment-rollback.md` open during the deployment window.

---

## Step 16 — Create first admin user

See `docs/first-admin-setup.md` for the exact commands to create the first organization and owner account.

---

## Step 17 — Post-deployment smoke tests

See `docs/smoke-tests.md` for manual verification steps to confirm the application is functioning correctly end-to-end.

---

## Deployment complete

Configure your uptime monitor (UptimeRobot, Better Uptime, etc.) to poll `https://app.yourdomain.com/health` every 5 minutes and alert on non-200 responses.
