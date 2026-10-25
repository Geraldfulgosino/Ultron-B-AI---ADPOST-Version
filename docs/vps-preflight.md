# VPS Preflight Checklist

Run through every item here **before** the app-level dry run (`docs/deployment-dry-run.md`).
These are server-level requirements that must be in place before any Docker command runs.

A checked item means you have verified it, not just read it.

---

## 1 — Operating System

- [ ] VPS is running Ubuntu 22.04 LTS or Debian 12
  ```bash
  lsb_release -a
  ```
  Expected: `Ubuntu 22.04` or `Debian GNU/Linux 12`

- [ ] System packages are up to date
  ```bash
  sudo apt-get update && sudo apt-get upgrade -y
  ```

---

## 2 — Docker

- [ ] Docker 24+ is installed
  ```bash
  docker --version
  ```
  Expected: `Docker version 24.x.x` or higher.
  If missing, install via the official script:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  # Log out and back in, or: newgrp docker
  ```

- [ ] Docker Compose v2.24.4+ plugin is available
  ```bash
  docker compose version
  ```
  Expected: `Docker Compose version v2.24.4` or higher. The production override uses Compose `!reset` / `!override` tags to remove development bind mounts and public service ports.
  If missing:
  ```bash
  sudo apt-get install docker-compose-plugin
  ```

- [ ] Docker daemon is running and your user can run Docker without `sudo`
  ```bash
  docker ps
  ```
  Expected: empty container table with no permission error.

---

## 3 — DNS

- [ ] The domain `app.yourdomain.com` has an A record pointing to this VPS's public IP
  ```bash
  # On the VPS, check your public IP:
  curl -s ifconfig.me

  # From any machine with dig:
  dig +short app.yourdomain.com
  ```
  Both commands must return the same IP address.

  > DNS propagation can take up to 48 hours after setting the record. Caddy cannot obtain a TLS certificate until DNS resolves correctly to this server.

---

## 4 — Firewall

- [ ] UFW (or equivalent) is enabled
  ```bash
  sudo ufw status
  ```
  Expected: `Status: active`
  If inactive:
  ```bash
  sudo ufw allow OpenSSH
  sudo ufw enable
  ```

- [ ] Port 80 (HTTP) is open
  ```bash
  sudo ufw allow 80/tcp
  sudo ufw status | grep 80
  ```
  Expected: `80/tcp   ALLOW`

- [ ] Port 443 (HTTPS) is open
  ```bash
  sudo ufw allow 443/tcp
  sudo ufw status | grep 443
  ```
  Expected: `443/tcp  ALLOW`

- [ ] Port 3306 (MySQL) is NOT open to the public internet
  ```bash
  sudo ufw status | grep 3306
  ```
  Expected: no output (port is not allowed). The Docker internal network handles MySQL access; it must never be reachable from outside the server.

- [ ] Port 6379 (Redis) is NOT open to the public internet
  ```bash
  sudo ufw status | grep 6379
  ```
  Expected: no output.

- [ ] Port 5678 (n8n) is NOT open to the public internet
  ```bash
  sudo ufw status | grep 5678
  ```
  Expected: no output. To access n8n remotely, use an SSH tunnel:
  ```bash
  ssh -L 5678:localhost:5678 user@vps-ip
  # Then open http://localhost:5678 in your local browser
  ```

---

## 5 — Repository

- [ ] The repository is cloned to `/srv/ultron`
  ```bash
  sudo mkdir -p /srv/ultron
  sudo chown $USER:$USER /srv/ultron
  git clone https://github.com/Geraldfulgosino/ultron-b-ai.git /srv/ultron
  cd /srv/ultron
  ```

- [ ] You are on the correct release tag
  ```bash
  git tag --sort=-version:refname | head -5
  git checkout v1.6-sprint-16-phase-f-production-readiness-stable   # or the intended release tag
  ```

---

## 6 — Environment File

- [ ] `.env` is created from `.env.example`
  ```bash
  cp .env.example .env
  ```

- [ ] `APP_KEY` is generated and set
  ```bash
  docker compose run --rm ultron-app php artisan key:generate --show
  ```
  Copy the output (starts with `base64:`) and paste it into `.env` as:
  ```
  APP_KEY=base64:...
  ```

- [ ] `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://app.yourdomain.com`

- [ ] `DB_PASSWORD` is a strong unique password (not `password`, `secret`, or any `.env.example` default)

- [ ] `DB_ROOT_PASSWORD` is a strong unique password (not `rootsecret`)

- [ ] `REDIS_PASSWORD` is set to a strong password (not `null` or empty)
  ```bash
  openssl rand -base64 24
  # Paste the output as REDIS_PASSWORD=<output>
  ```

- [ ] `SESSION_SECURE_COOKIE=true`

- [ ] `SESSION_DRIVER=redis`, `QUEUE_CONNECTION=redis`

- [ ] `N8N_ENCRYPTION_KEY` is replaced with a 32+ character random string (not the `.env.example` default `changeme-32-char-minimum-key-here`)
  ```bash
  openssl rand -base64 32
  # Paste the output as N8N_ENCRYPTION_KEY=<output>
  ```

- [ ] `MAIL_MAILER` is set to a real provider (`smtp`, `mailgun`, `ses`, or `postmark`) — not `log`

- [ ] `.env` file permissions are `600`
  ```bash
  chmod 600 .env
  ls -la .env
  ```
  Expected: `-rw-------`

---

## 7 — App-Level Validation

- [ ] Render and inspect the production Compose config
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.production.yml config
  ```
  Confirm:
  - `ultron-app`, `ultron-queue`, and `ultron-scheduler` do not mount the repository or `vendor` volume.
  - `caddy` mounts `./Caddyfile.production` and `./public:/var/www/html/public:ro`.
  - `ultron-mysql`, `ultron-redis`, and `n8n-main` do not publish host ports.
  - `ultron-redis` uses `--requirepass` and an authenticated healthcheck.

- [ ] Run `ultron:env:validate` to confirm all app-level checks pass
  ```bash
  docker compose run --rm \
    --env-file .env \
    ultron-app php artisan ultron:env:validate
  ```
  Expected output:
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
  Every item must show **PASS**. Address any WARN or FAIL item before proceeding.

---

## Preflight complete

All items above are checked → proceed to `docs/deployment-dry-run.md` for the full app-level pre-deployment checklist, then `docs/vps-launch-commands.md` to deploy.
