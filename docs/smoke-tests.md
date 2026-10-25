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

# 9. Migration status
docker compose exec ultron-app php artisan migrate:status
# Expected: all required migrations show "Ran"

# 10. Redis requires auth
docker compose exec ultron-redis redis-cli ping
# Expected: NOAUTH Authentication required.

# 11. Redis accepts the configured password
docker compose exec ultron-redis sh -lc 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
# Expected: PONG

# 12. Caddy serves built assets
curl -I https://app.yourdomain.com/build/manifest.json
# Expected first line: HTTP/2 200

# 13. n8n and its Postgres database are running
docker compose ps n8n-main n8n-postgres
# Expected: both services show "Up"; n8n-main has no public host port

# 14. Storage and cache directories are writable
docker compose exec ultron-app sh -lc 'test -w storage && test -w bootstrap/cache && echo "Storage OK"'
# Expected: Storage OK

# 15. Recent logs are clean
docker compose logs ultron-app --tail=50
docker compose logs caddy --tail=50
docker compose logs ultron-queue --tail=50
docker compose logs ultron-scheduler --tail=50
# Expected: no fatal errors, no stack traces, no leaked credentials or tokens

# 16. Backup exists and is readable
ls -la /srv/backups/ultron-*.sql.gz
gunzip -t /srv/backups/ultron-$(date +%Y-%m-%d).sql.gz && echo "Backup OK"
# Expected: Backup OK

# 17. Rollback readiness
git tag --sort=-version:refname | head -10
# Expected: previous known-good release tag is visible
```

---

## Browser smoke tests (authenticated)

Perform these in a real browser. Use an incognito window to avoid cached sessions.

### Auth flow

- [ ] **Register a new user** — Go to `https://app.yourdomain.com/register`. Fill in name, email, password. Submit. Expect: redirected to dashboard or email verification page.
- [ ] **Email verification** — Check your inbox (or `docker compose logs ultron-app | grep "To:"` for the log driver). Click the verification link. Expect: email verified, logged in, org dashboard visible.
- [ ] **Log out** — Click Logout. Expect: redirected to `/login`.
- [ ] **Log back in** — Use the credentials you registered with. Expect: redirected to the organization dashboard.
- [ ] **Forgot password** — Go to `/forgot-password`, enter your email, submit. Expect: "We have emailed your password reset link." Check the mail log or inbox for the reset email.

### Organization & Members

- [ ] **Dashboard loads** — `/{org-slug}/dashboard` shows KPI cards and the getting-started section with no errors.
- [ ] **Settings load** — `/{org-slug}/settings` shows the organization settings form.
- [ ] **Members page loads** — `/{org-slug}/members` shows the member list and invite form.
- [ ] **Send an invitation** — Invite a second email address. Expect: invitation row appears in the member list.
- [ ] **Cross-tenant denial** — Manually type another organization's slug in the URL (e.g. `/other-org/dashboard`). Expect: 403 Forbidden — not that organization's data.

### Clients & Websites

- [ ] **Clients index loads** — `/{org-slug}/clients`. Click "New Client", fill the form, submit. Expect: client appears in the list.
- [ ] **Websites index loads** — `/{org-slug}/websites`. Click "New Website", fill the form, submit. Expect: website appears in the list.

### Integrations

- [ ] **Integrations index loads** — `/{org-slug}/integrations`. If Google credentials are configured, the Connect button is visible.
- [ ] **No token exposure** — Open browser DevTools → Network tab. Inspect the Inertia page props for `/integrations`. Confirm no `access_token`, `refresh_token`, or `client_secret` fields appear in the JSON response.

### SEO Dashboard

- [ ] **SEO dashboard loads** — `/{org-slug}/seo`. No external API calls should occur during page load (verify in DevTools Network tab — no calls to `googleapis.com`).
- [ ] **Empty states display correctly** — If no analytics data exists, empty-state cards appear instead of errors or blank pages.

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
