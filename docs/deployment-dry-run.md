# Production Deployment Dry Run Checklist

Run through every item in this checklist **before** deploying to a VPS.
A checked item means you have verified it, not just read it.

---

## Staging VPS Dry-Run Order

This is the safe staging rehearsal path. It does not deploy production traffic and it does not call external APIs.

1. Provision a staging VPS and point a staging DNS name at it, for example `staging-app.yourdomain.com`.
2. Complete `docs/vps-preflight.md` on the staging VPS, including the rendered Compose config inspection.
3. Copy `Caddyfile.production.example` to `Caddyfile.production` and replace the domain with the staging hostname.
4. Create `.env` from `.env.example` with staging-only values. Do not reuse production credentials.
5. Set Google OAuth, mail, WordPress, and any other external provider credentials to empty or non-sending sandbox values unless the dry run explicitly includes that provider.
6. Run all phases in this file.
7. Follow `docs/vps-launch-commands.md` on the staging VPS only.
8. Run `docs/smoke-tests.md` and record every pass/fail in the staging deployment log.
9. Do not merge, tag, push, or promote staging to production from this runbook.

## Phase 1 — Code & Build

- [ ] All changes are merged to `main` and the branch is clean (`git status` shows nothing uncommitted)
- [ ] Latest commit is tagged (`git tag` shows the release version, e.g. `v1.0.0`)
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run build` succeeds — `public/build/manifest.json` exists after the build
- [ ] `public/build/manifest.json` is present on the VPS before building the production image; Caddy serves `./public` read-only in production
- [ ] `docker compose exec ultron-app php artisan test` passes — all tests green
- [ ] `./vendor/bin/pint --test` reports 0 formatting violations
- [ ] Production Compose renders without development bind mounts or public database/cache/n8n ports:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.production.yml config
  ```
  Confirm `ultron-app`, `ultron-queue`, and `ultron-scheduler` have no `volumes`, and `ultron-mysql`, `ultron-redis`, and `n8n-main` have no `ports`.

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
- [ ] Confirm current migration status before and after the dry run:
  ```bash
  docker compose exec ultron-app php artisan migrate:status
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
