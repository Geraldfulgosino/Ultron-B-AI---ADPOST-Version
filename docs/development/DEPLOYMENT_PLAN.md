# Free-Tier Deployment Plan (Phase 15: preparation only)

Nothing here has been executed. Deploying (Phase 18) and connecting Supabase (Phase 17) both need the owner's authorization.

## Target
| Piece | Service | Notes |
|-------|---------|-------|
| Frontend (`apps/adpost-web`) | Netlify (free tier) | Static Vite build; `netlify.toml` prepared |
| Database / Auth / Storage / Realtime | Supabase (free tier) | Migrations in `supabase/migrations` |
| AI execution, syncs, webhooks, exports | Supabase Edge Functions | Contracts in SUPABASE_INTEGRATION_PLAN.md §4 |
| Legacy Laravel app | Unchanged | Stays the system of record until parity is verified live |

Check each provider's current free-tier limits (bandwidth, build minutes, database size, inactivity pausing, Edge Function invocations) before the pilot. They change, so they are not copied here.

## Prepared artifacts
- `apps/adpost-web/netlify.toml`: build runs the tests then the build; publishes `dist`; SPA fallback; security headers (CSP, HSTS, frame denial, nosniff, referrer and permissions policy); immutable caching for hashed assets.
- `apps/adpost-web/.env.example`: only `VITE_BACKEND`, plus commented Supabase public settings. Model keys must never be `VITE_*`.
- Build output (local verification): see TEST_RESULTS.md (Phase 15 row).

## Local-only pilot option (no backend)
The app runs entirely in the browser with `VITE_BACKEND=local`. That makes it usable as a **click-through demo** on Netlify before Supabase exists. Data stays in each visitor's browser, and every AI reply is labelled *Simulated*. It must not be used with real customer data (see SECURITY_REVIEW.md: local auth is a simulation).

## Phase 18 runbook (requires authorization)
1. Owner creates or approves the Netlify site and connects the GitHub repo; base directory `apps/adpost-web`; production branch chosen by the owner (not `main` until reviewed).
2. Confirm the deploy-preview build passes (tests run in the build command).
3. Smoke test the preview URL: login with a dev account, brand switch, dashboard charts, chat reply, CSV/PDF export, deep-link refresh (SPA fallback), and check response headers include the CSP.
4. Phase 17 first if a real backend is wanted: apply migrations to a **staging** Supabase project, run the RLS test plan, set `VITE_BACKEND=supabase` + public URL/anon key in Netlify env, and set model keys only as Edge Function secrets.
5. Roll back: Netlify "Publish deploy" on the previous build. The legacy Laravel app is unaffected throughout.

## Not done / blocked
- B-003: no Netlify site linked and no deploy performed.
- B-002: no Supabase project connected.
