# Production Deployment Plan

Ordered checklist for the first live deployment of ULTRON-B AI.
Work through each phase in sequence; complete every item before proceeding to the next.

---

## Phase 1 — VPS Preflight

Complete every item in `docs/vps-preflight.md` before any Docker command:

- [ ] Ubuntu 22.04 LTS or Debian 12 confirmed
- [ ] Docker 24+ installed, user in `docker` group
- [ ] Docker Compose v2.24.4+ plugin available
- [ ] Repository cloned to `/srv/ultron`
  ```bash
  git clone https://github.com/Geraldfulgosino/ultron-b-ai.git /srv/ultron
  cd /srv/ultron
  ```
- [ ] Correct release tag checked out
  ```bash
  git checkout v1.6-sprint-16-phase-f-production-readiness-stable
  ```
- [ ] DNS A record for `app.yourdomain.com` resolves to this VPS IP
- [ ] UFW active with ports 80 and 443 open, 3306/6379/5678 closed to public

---

## Phase 2 — Environment Configuration

- [ ] `.env` created from `.env.example`
  ```bash
  cp .env.example .env
  chmod 600 .env
  ```
- [ ] `APP_KEY` generated and set
  ```bash
  docker compose run --rm ultron-app php artisan key:generate --show
  # Paste output into APP_KEY= in .env
  ```
- [ ] Variables set to production values:

  | Variable | Required value |
  |----------|----------------|
  | `APP_ENV` | `production` |
  | `APP_DEBUG` | `false` |
  | `APP_URL` | `https://app.yourdomain.com` |
  | `DB_PASSWORD` | Strong unique password |
  | `DB_ROOT_PASSWORD` | Strong unique password |
  | `REDIS_PASSWORD` | Strong unique password (`openssl rand -base64 24`) |
  | `SESSION_SECURE_COOKIE` | `true` |
  | `SESSION_DRIVER` | `redis` |
  | `QUEUE_CONNECTION` | `redis` |
  | `LOG_LEVEL` | `error` |
  | `MAIL_MAILER` | `smtp` / `mailgun` / `ses` / `postmark` |
  | `N8N_ENCRYPTION_KEY` | 32+ char random string (`openssl rand -base64 32`) |

- [ ] `.env` permissions confirmed `600`
  ```bash
  ls -la .env   # must show -rw-------
  ```

---

## Phase 3 — Docker and Caddy

- [ ] `Caddyfile.production` created from example and domain set
  ```bash
  cp Caddyfile.production.example Caddyfile.production
  # Edit: replace app.yourdomain.com with your actual domain
  ```
- [ ] Production Compose config rendered and inspected — no bind mounts on app/queue/scheduler, no host ports on MySQL/Redis/n8n
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.production.yml config
  ```
- [ ] App-level env validation passes
  ```bash
  docker compose run --rm --env-file .env \
    ultron-app php artisan ultron:env:validate
  ```
  Every item must show **PASS**.

---

## Phase 4 — Asset Build

- [ ] Frontend dependencies installed and assets compiled on the VPS (or built locally and copied)
  ```bash
  npm ci
  npm run build
  ```
- [ ] `public/build/manifest.json` present in `/srv/ultron/public/build/`

---

## Phase 5 — Container Start and Database

- [ ] All containers started
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
  docker compose ps   # all services must be Up/healthy
  ```
- [ ] Database migrations run
  ```bash
  docker compose exec ultron-app php artisan migrate --force
  ```
- [ ] Caches rebuilt inside the running container
  ```bash
  docker compose exec ultron-app php artisan config:cache
  docker compose exec ultron-app php artisan route:cache
  docker compose exec ultron-app php artisan view:cache
  ```
- [ ] Storage symlink created (once only)
  ```bash
  docker compose exec ultron-app php artisan storage:link
  ```

---

## Phase 6 — Queue Worker and Scheduler

- [ ] Queue worker is running
  ```bash
  docker compose ps ultron-queue     # State: Up
  docker compose logs ultron-queue --tail=20   # no fatal errors
  ```
- [ ] Scheduler is running
  ```bash
  docker compose ps ultron-scheduler    # State: Up
  docker compose logs ultron-scheduler --tail=20
  ```

---

## Phase 7 — Routing and TLS

- [ ] Caddy obtained a TLS certificate (check logs; takes ~30 seconds after DNS resolves)
  ```bash
  docker compose logs caddy --tail=30
  # Look for: certificate obtained successfully
  ```
- [ ] HTTPS site loads with a valid certificate
  ```bash
  curl -Is https://app.yourdomain.com/health | head -5
  # HTTP/2 200
  ```
- [ ] HTTP redirects to HTTPS (Caddy default)
  ```bash
  curl -Is http://app.yourdomain.com | grep -i location
  # Location: https://app.yourdomain.com/
  ```

---

## Phase 8 — Smoke Tests

Run all items in `docs/smoke-tests.md`. Minimum required:

- [ ] `/health` returns `{"status":"ok"}`
- [ ] Login page loads at `https://app.yourdomain.com/login`
- [ ] Admin user can log in (see `docs/first-admin-setup.md`)
- [ ] Organization dashboard loads
- [ ] Reports CSV export downloads a file
- [ ] Reports PDF export downloads a PDF
- [ ] Queue processes a test job (trigger from the app or tinker)
- [ ] No 500 errors in Caddy or app logs during smoke tests
  ```bash
  docker compose logs caddy --tail=50
  docker compose logs ultron-app --tail=50
  ```

---

## Phase 9 — Uptime Monitoring

- [ ] Uptime monitor configured to poll `https://app.yourdomain.com/health` every 5 minutes
- [ ] Alert destination set (email/Slack/PagerDuty)

---

## Phase 10 — Backup

- [ ] Database backup verified (see `docs/backup-strategy.md`)
  ```bash
  docker compose exec ultron-mysql \
    mysqldump -u root -p"${DB_ROOT_PASSWORD}" ultron | gzip > /srv/backups/ultron-$(date +%F).sql.gz
  ```
- [ ] Backup stored off-VPS (S3, Backblaze B2, or SFTP)
- [ ] Restore procedure tested with the backup file

---

## Rollback Procedure

If a deployment fails, follow `docs/deployment-rollback.md`. Quick summary:

```bash
# Revert to the previous release tag
git checkout <previous-tag>

# Rebuild and restart
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build

# Roll back migrations if needed (only if the new migration was destructive)
docker compose exec ultron-app php artisan migrate:rollback --step=1 --force

# Rebuild caches
docker compose exec ultron-app php artisan config:cache
docker compose exec ultron-app php artisan route:cache
docker compose exec ultron-app php artisan view:cache
```

---

## Deployment Sign-off

All phases complete → deployment verified. Record the tag, date, and confirming engineer:

| Field | Value |
|-------|-------|
| Release tag | `v1.6-sprint-16-phase-f-production-readiness-stable` |
| Deployment date | |
| Deployed by | |
| Smoke tests passed | [ ] Yes |
| Uptime monitor active | [ ] Yes |
| Backup verified | [ ] Yes |
