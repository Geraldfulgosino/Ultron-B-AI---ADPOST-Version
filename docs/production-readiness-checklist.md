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
