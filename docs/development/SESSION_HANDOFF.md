# Session Handoff

**Updated:** 2026-11-02 (Phase 17 started)
**Project root:** `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`
**Branch:** `feature/adpost-react-supabase-ai` (pushed; `main` untouched at `13bc3d0`)
**Supabase:** the only authorized project is `adpost-staging`, ref `ppwkxlwxzutigepaizob`. **No migration applied yet.**
**Last synced commit:** see GITHUB_SYNC_LOG.md (source of truth: `git log origin/feature/adpost-react-supabase-ai -1`)

## Status by milestone
| Area | Implemented locally | Validated locally | On staging |
|---|---|---|---|
| 17A Supabase client/config/provider factory | yes | yes (unit tests) | not yet |
| Migrations 0001–0005 + RLS hardening | yes | yes (real Postgres via PGlite, 37 tests) | **awaiting approval** |
| Auth adapter, data adapters, realtime client, storage client | no | — | — |
| AI Edge Functions | no | — | awaiting model credentials |
| GA4/GSC sync | no | — | awaiting Google OAuth credentials |

## Test status
- adpost-web: tsc 0 errors · **244/244** tests (37 run on real Postgres in PGlite, all others on mocks/jsdom) · build ok · 0 vulnerabilities.
- **Nothing has been tested against remote staging yet.**

## Blockers
- B-001: no PHP/Docker on host.
- B-003: Netlify not authorized (Phase 18).
- B-004: the Supabase CLI isn't logged in here. The owner runs `npx supabase@2.121.0 login` (browser flow; the token stays in the CLI's own store, never in the repo).
- B-005: the first remote migration needs owner approval after the dry run.
- `.env.local` holds a placeholder publishable key. The owner pastes the real **publishable** key; never a secret key.

## Next exact task
1. Owner: `npx supabase@2.121.0 login`.
2. `npx supabase@2.121.0 link --project-ref ppwkxlwxzutigepaizob`. The owner enters the DB password at the prompt; it is not shared.
3. `migration list` (remote history must be empty), then `db push --dry-run`.
4. Owner approves migrations 0001–0005, then `db push`, then sign-up and RLS spot checks on staging.
5. Build the Supabase auth adapter, then the data adapters, gated by `runBackendContract` against staging.

Each step's details are in PHASE17_STAGING_RUNBOOK.md §3.
