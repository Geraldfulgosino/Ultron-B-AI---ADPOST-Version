# Production Deployment Guide

This guide covers deploying ULTRON-B AI on a VPS using Docker Compose, Caddy, and the production Dockerfile target.

---

## System Requirements

| Component | Minimum |
|-----------|---------|
| OS | Ubuntu 22.04 LTS or Debian 12 |
| CPU | 2 vCPU |
| RAM | 2 GB |
| Disk | 20 GB SSD |
| Docker | 24+ |
| Docker Compose | v2.24.4+ plugin |
| Open ports | 80, 443 |

---

## 1. Server setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin (if not bundled)
sudo apt-get install docker-compose-plugin

# Clone the repository
git clone https://github.com/Geraldfulgosino/ultron-b-ai.git /srv/ultron
cd /srv/ultron
```

---

## 2. Environment configuration

```bash
cp .env.example .env
```

Edit `.env` with production values. Required changes:

| Variable | Production value |
|----------|-----------------|
| `APP_ENV` | `production` |
| `APP_DEBUG` | `false` |
| `APP_KEY` | Generated (see below) |
| `APP_URL` | `https://app.yourdomain.com` |
| `DB_PASSWORD` | Strong unique password |
| `DB_ROOT_PASSWORD` | Strong unique password |
| `REDIS_PASSWORD` | Strong unique password |
| `SESSION_SECURE_COOKIE` | `true` |
| `LOG_LEVEL` | `error` or `warning` |
| `MAIL_MAILER` | `smtp` / `mailgun` / `ses` / `postmark` |
| `N8N_ENCRYPTION_KEY` | 32+ character random string |

Generate the application key:

```bash
# Run once — keep the generated key secret
docker compose run --rm ultron-app php artisan key:generate --show
# Paste the output into APP_KEY= in .env
```

---

## 3. Production Docker Compose override

The `docker-compose.yml` uses the `development` build target and development bind mounts. For production, use the committed `docker-compose.production.yml` override:

```yaml
services:
  ultron-app:
    build:
      context: .
      target: production
    env_file: .env
    volumes: !reset []   # no source or vendor bind mount

  ultron-queue:
    build:
      context: .
      target: production
    env_file: .env
    volumes: !reset []

  ultron-scheduler:
    build:
      context: .
      target: production
    env_file: .env
    volumes: !reset []

  caddy:
    volumes: !override
      - ./Caddyfile.production:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
      - ./public:/var/www/html/public:ro

  n8n-main:
    ports: !reset []

  ultron-mysql:
    ports: !reset []

  ultron-redis:
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    ports: !reset []
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=\"$${REDIS_PASSWORD}\" redis-cli ping | grep PONG"]
```

Render the merged config and inspect it before starting containers:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml config
```

Confirm app/queue/scheduler have no repository bind mounts, Caddy mounts `./public` read-only, and MySQL/Redis/n8n have no host `ports`.

Start with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

---

## 4. Caddy HTTPS configuration

Copy `Caddyfile.production.example` to `Caddyfile.production` and set your domain:

```
app.yourdomain.com {
    root * /var/www/html/public

    encode gzip

    php_fastcgi ultron-app:9000 {
        index index.php
    }

    file_server

    log {
        output stdout
        format json
        level WARN
    }
}
```

Caddy automatically obtains and renews a Let's Encrypt TLS certificate when the domain resolves to the server's public IP.

---

## 5. Database migration

```bash
docker compose exec ultron-app php artisan migrate --force
```

The `--force` flag is required when `APP_ENV=production`.

> **Never run DemoSeeder in production.** It is blocked by `abort_if(app()->isProduction(), ...)`.

---

## 6. Asset build

Assets must be compiled before building the production Docker image:

```bash
npm ci
npm run build
```

The `public/build/` directory is ignored by Git but included in the Docker build context unless `.dockerignore` is changed. Confirm `public/build/manifest.json` exists on the VPS before building the Docker image. Caddy also serves `./public` read-only from the host, so the same build output must be present in `/srv/ultron/public`.

---

## 7. Queue worker

The `ultron-queue` container runs `php artisan queue:work` automatically with `restart: unless-stopped`. Verify it is running:

```bash
docker compose ps ultron-queue
docker compose logs ultron-queue --tail=50
```

Failed jobs are stored in the `failed_jobs` table. Inspect them with:

```bash
docker compose exec ultron-app php artisan queue:failed
```

Retry all failed jobs:

```bash
docker compose exec ultron-app php artisan queue:retry all
```

---

## 8. Scheduler

The `ultron-scheduler` container runs `php artisan schedule:run` every 60 seconds with `restart: unless-stopped`. Verify:

```bash
docker compose logs ultron-scheduler --tail=20
```

---

## 9. Health check

The `/health` endpoint returns `{"status":"ok"}` for uptime monitors and load balancers:

```bash
curl https://app.yourdomain.com/health
# → {"status":"ok"}
```

Configure your uptime monitor (UptimeRobot, Better Uptime, etc.) to poll this URL every 5 minutes.

---

## 10. Laravel cache warm-up

The production Dockerfile runs these automatically at build time:

```bash
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

To clear and rebuild caches after a deployment without rebuilding the image:

```bash
docker compose exec ultron-app php artisan config:clear
docker compose exec ultron-app php artisan config:cache
docker compose exec ultron-app php artisan route:cache
docker compose exec ultron-app php artisan view:cache
```

---

## 11. Storage symlink

If using the `local` filesystem driver, create the public symlink once:

```bash
docker compose exec ultron-app php artisan storage:link
```

---

## 12. Deployment workflow (zero-downtime)

```bash
# 1. Pull latest code
git pull origin main

# 2. Install frontend dependencies and build assets
npm ci
npm run build

# 3. Build new image
docker compose -f docker-compose.yml -f docker-compose.production.yml build ultron-app

# 4. Run migrations
docker compose exec ultron-app php artisan migrate --force

# 5. Rebuild caches inside the new container
# The production image bakes caches at build time. After `up -d` replaces the
# container, those baked-in caches are stale against the new code until rebuilt.
docker compose exec ultron-app php artisan config:cache
docker compose exec ultron-app php artisan route:cache
docker compose exec ultron-app php artisan view:cache

# 6. Restart app and workers
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --no-deps ultron-app ultron-queue ultron-scheduler
```
