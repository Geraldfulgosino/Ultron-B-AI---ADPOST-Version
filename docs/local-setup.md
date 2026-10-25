# Local Setup Guide

This guide covers running ULTRON-B AI locally for browser testing.

## Prerequisites

- Docker Desktop
- Node.js 20+
- PHP 8.4 + Composer (for IDE tooling; app runs inside Docker)

## 1. Environment setup

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
APP_ENV=local
APP_KEY=          # generated below
DB_DATABASE=ultron
DB_USERNAME=ultron
DB_PASSWORD=secret
```

Then generate the application key:

```bash
docker compose run --rm ultron-app php artisan key:generate
```

> **Google OAuth (optional):** To test live OAuth, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to `.env`. Without these, the integrations page shows a warning and creates placeholder records only.

> **Mail (optional):** Set `MAIL_MAILER=log` to capture sent emails in `storage/logs/laravel.log` instead of delivering them.

## 2. Start infrastructure

```bash
docker compose up -d
```

This starts: Caddy (reverse proxy), the Laravel app, queue worker, scheduler, MySQL, Redis, n8n, and n8n-postgres.

> **Queue worker:** The `ultron-queue` container runs `php artisan queue:work` automatically. Invitation emails and analytics sync jobs use this worker. If jobs appear stuck, check its logs: `docker compose logs ultron-queue`.

## 3. Run migrations

```bash
docker compose exec ultron-app php artisan migrate
```

## 4. Seed demo data (local only)

```bash
docker compose exec ultron-app php artisan db:seed --class=DemoSeeder
```

This creates:

| Account | Email | Password | Role |
|---------|-------|----------|------|
| Demo Owner | demo@example.com | password | Owner |
| Demo Admin | admin@example.com | password | Admin |
| Demo Member | member@example.com | password | Member |
| Demo Viewer | viewer@example.com | password | Viewer |

All accounts belong to the **Demo Agency** organization.

> **Warning:** `DemoSeeder` is blocked in production (`APP_ENV=production`). It will throw a 403 if you try.

> **Re-seeding:** The seeder inserts fixed email addresses and an org slug. Running it twice will fail with a unique constraint error. To reset and re-seed from scratch:
> ```bash
> docker compose exec ultron-app php artisan migrate:fresh
> docker compose exec ultron-app php artisan db:seed --class=DemoSeeder
> ```

## 5. Start the frontend dev server

```bash
npm install
npm run dev
```

## 6. Open the app

Navigate to `http://localhost` (Caddy proxies port 80 → the Laravel app).

Log in with `demo@example.com` / `password`.

## 7. Verify demo data

After login you should see:

- **Dashboard** — the Demo Agency org with a getting-started checklist
- **Clients** — Acme Corp, Beta Foods, and one archived client
- **Websites** — 4 websites (3 active, 1 archived)
- **Integrations** — one connected Google Analytics integration for Acme Main Site
- **SEO** — KPI cards populated with 30 days of analytics data, landing pages, search queries, and 8 SEO insights in various statuses

## 8. Run tests

```bash
docker compose exec ultron-app php artisan test
```

## 9. Type-check & build

```bash
npm run typecheck
npm run build
```

## Common issues

| Problem | Fix |
|---------|-----|
| Port 80 already in use | Stop other local web servers, or edit `docker-compose.yml` Caddy port |
| MySQL connection refused | Wait ~10s for MySQL to initialize, then retry migrate |
| "Vite manifest not found" | Run `npm run build` or `npm run dev` first |
| Google OAuth "not configured" | Expected — add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env` to enable OAuth |
