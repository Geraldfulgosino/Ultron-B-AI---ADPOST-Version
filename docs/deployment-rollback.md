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
docker exec -i ultron-ultron-mysql-1 mysql \
  -u root -p"${DB_ROOT_PASSWORD}" \
  -e "DROP DATABASE IF EXISTS ultron; CREATE DATABASE ultron CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Import the backup
docker exec -i ultron-ultron-mysql-1 mysql \
  -u ultron -p"${DB_PASSWORD}" ultron \
  < /srv/backups/ultron-$(date +%Y-%m-%d).sql

# 6. Verify row count
docker exec ultron-ultron-mysql-1 mysql \
  -u ultron -p"${DB_PASSWORD}" ultron \
  -e "SELECT COUNT(*) AS org_count FROM organizations;"
```

If no backup exists for today, use the most recent one and accept possible data loss for the period between the backup and the failed deployment.

---

## Step 4 — Revert the code

```bash
# Check out the last known good tag
git checkout v0.9-sprint-9-complete

# Or, if the bad change was a single commit and you are preparing a reviewed fix branch,
# revert it forward outside the emergency server session
git revert HEAD --no-edit
```

Do not push to GitHub from the emergency rollback session unless the release owner has explicitly approved that action. The immediate rollback only needs the VPS working tree at the last known good tag or a reviewed rollback commit already available to the server.

---

## Step 5 — Rebuild and restart with the previous code

```bash
# Rebuild the image from the reverted code
docker compose -f docker-compose.yml -f docker-compose.production.yml build

# Restart app, queue, and scheduler
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

1. Identified what caused the failure (`docker compose logs ultron-app --tail=100`)
2. Written a fix
3. Run `docker compose exec ultron-app php artisan test` locally and confirmed all tests pass
4. Run through `docs/deployment-dry-run.md` again

---

## Partial migration rollback

If migrations ran but only some succeeded, step back the last batch:

```bash
# See which migrations have run
docker compose exec ultron-app php artisan migrate:status

# Roll back the last batch only (safer than rolling back all)
docker compose exec ultron-app php artisan migrate:rollback --force

# Or roll back a specific number of steps
docker compose exec ultron-app php artisan migrate:rollback --step=2 --force
```

> **Important:** `migrate:rollback` calls the `down()` method of each migration. Verify that the `down()` method is implemented correctly before relying on it in production.
