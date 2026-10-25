# Security Checklist — Pre-Launch

Run through this checklist before going live. Each item is a hard requirement, not a suggestion.

---

## Application

- [ ] `APP_KEY` is set to a unique, securely generated value (`php artisan key:generate`)
- [ ] `APP_ENV=production`
- [ ] `APP_DEBUG=false` — stack traces must never be visible to end users
- [ ] `APP_URL` uses `https://` — required for correct URL generation and OAuth redirects
- [ ] No `.env` file is committed to version control (confirm `.gitignore` includes `.env`)

---

## HTTPS / TLS

- [ ] Caddy is configured with your production domain (not `:80`)
- [ ] Caddy is obtaining a valid Let's Encrypt certificate (check `docker compose logs caddy`)
- [ ] `curl -I https://app.yourdomain.com` returns `HTTP/2 200` with no certificate warnings
- [ ] HTTP (port 80) redirects to HTTPS automatically (Caddy does this by default)

---

## Sessions & Cookies

- [ ] `SESSION_SECURE_COOKIE=true` — cookies only sent over HTTPS
- [ ] `SESSION_ENCRYPT=true` — session payload encrypted at rest (already default in `.env.example`)
- [ ] `SESSION_DRIVER=redis` — sessions stored in Redis, not files
- [ ] `SESSION_LIFETIME` is set to an appropriate value (default: 120 minutes)

---

## Database

- [ ] `DB_PASSWORD` and `DB_ROOT_PASSWORD` are strong, unique passwords (not the `.env.example` defaults)
- [ ] MySQL port (`DB_EXTERNAL_PORT`) is NOT exposed to the public internet — bind to `127.0.0.1` or remove the port mapping in production
- [ ] Regular backups are configured (see `docs/backup-strategy.md`)
- [ ] `organization_id` is never accepted from browser input — enforced by `SetActiveOrganization` middleware (do not change this)

---

## Redis

- [ ] `REDIS_PASSWORD` is set to a strong password in production
- [ ] Redis port (`REDIS_EXTERNAL_PORT`) is NOT exposed to the public internet
- [ ] Redis `requirepass` is enabled in the Redis config (or use a Docker network-only setup)

---

## Queue & Scheduler

- [ ] `ultron-queue` container is running and healthy (`docker compose ps`)
- [ ] `ultron-scheduler` container is running and healthy
- [ ] `QUEUE_CONNECTION=redis` (not `sync`) — all external API calls and emails are queued
- [ ] Failed jobs are monitored (`php artisan queue:failed`)

---

## Google OAuth

- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are real credentials from Google Cloud Console
- [ ] `GOOGLE_REDIRECT_URI` matches the authorized redirect URI registered in Google Cloud Console exactly
- [ ] OAuth tokens are stored encrypted in the database — never logged, never sent to React (verified by `test_index_does_not_expose_tokens`)
- [ ] Google Cloud project has only the required scopes: `analytics.readonly`, `webmasters.readonly`
- [ ] Google Cloud project OAuth consent screen is configured (brand name, support email, privacy policy URL)

---

## n8n

- [ ] `N8N_ENCRYPTION_KEY` is replaced with a securely generated 32+ character string (never use the `.env.example` default `changeme-32-char-minimum-key-here`)
- [ ] n8n admin UI is not publicly exposed without authentication (consider binding to `127.0.0.1` or adding Basic Auth in Caddy)
- [ ] `N8N_DB_PASSWORD` is a strong, unique password

---

## Logging

- [ ] `LOG_LEVEL=error` or `warning` in production (not `debug` — debug logs can contain sensitive data)
- [ ] Logs do not contain access tokens, refresh tokens, or raw API responses (review `safeMessage()` in sync jobs)
- [ ] Log storage does not grow unbounded — configure log rotation (`LOG_STACK=daily` with retention, or external log aggregator)

---

## Secrets Management

- [ ] `.env` file on the VPS has permissions `600` (`chmod 600 .env`)
- [ ] No secrets appear in Docker image layers — `.env` is not `COPY`-ed in the Dockerfile (it is mounted via `docker compose`)
- [ ] No secrets appear in git history (`git log -p | grep -i secret`)
- [ ] No secrets are passed as React props (all sensitive data stays server-side)

---

## Headers & CSRF

- [ ] CSRF protection is active (Laravel default — do not disable `VerifyCsrfToken` middleware)
- [ ] Inertia uses `X-XSRF-TOKEN` header for all non-GET requests (handled automatically by `@inertiajs/react`)

---

## Post-launch verification

```bash
# Health check
curl https://app.yourdomain.com/health

# Confirm APP_DEBUG is off (should NOT see stack traces on error)
curl https://app.yourdomain.com/nonexistent-route

# Confirm HTTPS redirect
curl -I http://app.yourdomain.com
```
