# ULTRON-B AI — Claude Code Project Guidance

## Stack
- PHP 8.4 / Laravel 13 — modular monolith
- React 19 + Inertia.js v2 + TypeScript
- Tailwind CSS v4
- MySQL 8.4 + Redis 7
- Docker Compose (Caddy, app, queue, scheduler, MySQL, Redis, n8n, n8n-postgres)

## Architecture
- Domain logic lives in `app/Domains/<Domain>/` — Actions, Models, Enums, DTOs, Policies, Services
- Thin HTTP layer in `app/Http/` — Controllers, Middleware, Requests
- Frontend pages in `resources/js/pages/`, shared UI in `resources/js/components/ui/`
- Routes: `routes/web.php` + `routes/auth.php`

## Key Rules
- `declare(strict_types=1)` on every PHP file
- Thin controllers: delegate to Actions/Services; never put business logic in controllers
- Use Form Requests for validation; use Policies/Gates for authorization
- `organization_id` is REQUIRED on every tenant-owned table row
- NEVER trust `organization_id` from the browser; derive it from authenticated membership via `SetActiveOrganization` middleware
- Policies must verify both permission AND resource ownership
- Queue all external API calls, AI requests, emails, and exports
- Never expose credentials, tokens, or secrets to React or logs

## Running commands
```bash
docker compose up -d                        # Start all services
docker compose exec ultron-app php artisan migrate
docker compose exec ultron-app php artisan test
docker compose exec ultron-app php artisan tinker
npm run dev                                 # Frontend dev server (on host)
npm run build                              # Production build
npm run typecheck                          # TypeScript check
```

## Testing
- Run tests: `docker compose exec ultron-app php artisan test`
- Every organization-owned feature MUST have a tenant isolation test (two orgs, verify cross-access is denied)
- Use factories and synthetic data; never use production data in tests

## Current Sprint (Sprint 1)
See `docs/superpowers/` for implementation plans and specs.
