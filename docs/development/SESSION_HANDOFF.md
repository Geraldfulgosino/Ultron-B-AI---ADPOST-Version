# Session Handoff

**Updated:** 2026-11-13 (master prompt v6.0: Super Admin / Admin / Client User roles)
**Project root:** `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`
**Branch:** `feature/adpost-react-supabase-ai`, pushed. The remote SHA is in GITHUB_SYNC_LOG.md. `main` is untouched.
**Supabase:** `adpost-staging`, ref `ppwkxlwxzutigepaizob`. The CLI 2.121.0 is linked.
**Applied to staging:** migrations 0001–0005.
**Local only, awaiting approval:** 0006_advisor_fixes, 0007_ai_providers, 0008_agency_client_website, 0009_roles_access. The dry run confirms these four would be pushed, with no seeds.
**Deployed Edge Functions:** none. `agent-execute`, `ai-connection-test` and `user-invite` are implemented, not deployed.

## 2026-11-13: v6.0 role model (read first)
- **Roles:**
  - Super Admin (`platform_admins`, UI `/platform`);
  - Admin (agency_owner/agency_admin, UI `/a/:agency/users`);
  - Client User (brand role `client`, read-only by default, plus explicit `ai_chat` / `comment_tasks` / `download_reports`).
  - See ROLE_ARCHITECTURE.md and PERMISSION_MATRIX.md.
- **Hierarchy reconciled** (owner answers, applied once, rename/archive only):
  - VCA: CMS, LIPSKY, HLDC, LOOP19.
  - ADPOST: POD, FMF, DYNAMIC SCREEN PRINTING, CAR MAGNETS.
  - GoldStarATM: ATM NEBRASKA/FLORIDA/OHIO/HAWAII.
  - Archived: TRADE BAGS, STUDIO PILATES, GoldStar ATM.
- **Migration 0009 and the server:**
  - 0009 is validated on PGlite (100 DB tests, including the 22-row RLS_ROLE_TEST_MATRIX).
  - `agent-execute` enforces Client User runs: client-facing agents, client-shared one-to-one chats, no knowledge tools.
  - `user-invite` sends through Supabase Auth on the server and records `sent` only when Auth accepts the request.
- **Sample sign-ins** (local mock only): `platform@ultron.example.test`, `admin@adpost.example.test`, `user@lipsky.example.test` (Client User), `client@pod.example.test` (read-only).
- **Staging plan:** STAGING_MIGRATION_PLAN_0006_0009.md (backup, read-only pre-flight, push, verify). **Not applied.**

## Owner decisions needed (v6)
1. **Approve the staging migration plan** for 0006–0009 (or 0006–0008 only, or hold).
2. **First Super Admin:** after 0009 is on staging, run `select app.bootstrap_super_admin('<your email>')` yourself in the SQL editor, or approve it explicitly. See SUPER_ADMIN_DESIGN.md.
3. **Invitation email:** deploying `user-invite` needs approval, `ALLOWED_ORIGINS` and preferably custom SMTP.
4. The earlier open decisions below (provider accounts, budgets, staging test users) still stand.

## Next exact task (no approval needed)
Build the Supabase auth and data adapters (17E/17F), so the deployed functions and RLS become reachable from the UI. Wire invitations to `user-invite`.

## 2026-11-05: multi-agency hierarchy (read first)
- Mapping: **Client = Brand**. Routes: `/agencies`, `/a/:agency[/clients|/settings]`, `/a/:agency/c/:client/...`; legacy `/b/:slug` links redirect.
- Migration `20261105000008_agency_client_website.sql` and the dev seed `supabase/seeds/dev/sample_hierarchy.sql` are validated on PGlite only. Neither is applied to staging.
- The dev app runs on `src/data/local/sampleSeed.ts`: 3 agencies, 10 clients, no websites or metrics. Tests use `fixtures.ts`.
- Local commits `0841ef1`, `606a78a`, `f0254cd` and the docs commit are **not pushed**: the owner requires approval before any GitHub push.
- Details: MULTI_AGENCY_ARCHITECTURE.md (limitations and next milestones are in §10).

## Where things are
- Settings UI: `apps/adpost-web/src/pages/settings/AiSettingsPages.tsx`. Routes `/b/:slug/settings/ai-providers[/new|/:id]`, `ai-models`, `ai-routing`, `ai-usage`.
- Contract: `AiProvidersApi` (`api().ai`). Mock adapter: `src/data/local/ai.ts`.
- Shared server runtime: `supabase/functions/_shared/ai/*`, tested from `apps/adpost-web/src/test/ai/*`.
- Docs:
  - AI_PROVIDER_ARCHITECTURE, AI_PROVIDER_CONNECTIONS, AI_MODEL_ROUTING;
  - AI_CREDENTIAL_SECURITY, AI_CHAT_RUNTIME, AI_USAGE_BUDGETS;
  - AI_PROVIDER_TEST_MATRIX.

## Status
| Item | State |
|---|---|
| Provider schema + RLS (0007) | Implemented, locally tested (PGlite). **Awaiting approval** for staging |
| Settings UI, routing, usage | Implemented, tested on the mock adapter |
| Anthropic / OpenAI adapters | Implemented, tested with simulated responses. **No live call** |
| agent-execute / ai-connection-test | Implemented, handler-tested. **Not deployed** |
| Team orchestration, SEO tools, budgets | Implemented, mock-tested |
| Supabase auth adapter (17E), chat/data adapters (17F) | Not implemented. Needed before the deployed functions are reachable from the UI |

## Tests
425 passed + 1 opt-in, all mock or local Postgres. No staging test of the AI tables; no live provider call.

## Owner decisions needed
1. **Staging changes:** approve applying 0006 + 0007, and deploying `agent-execute` + `ai-connection-test` to `adpost-staging`. Separate approvals are fine.
2. **Provider accounts:** create Anthropic Console and/or OpenAI Platform API accounts (separate billing; subscriptions do not count) with provider-side spend limits. Then, from your own terminal, run `supabase secrets set ANTHROPIC_API_KEY=… OPENAI_API_KEY=…`. Never paste keys in chat.
3. **Budget for Milestone 13 smoke tests:**
   - one Anthropic request;
   - one OpenAI request;
   - switching;
   - one bounded team delegation.

   Suggested: a 256-token cap and a $1 provider limit.
4. **Staging test users** (unchanged): allow sign-up-API test users, or create them in the dashboard.

## Next exact task (no approval needed)
Build the Supabase auth adapter (17E) and the chat adapter (17F):
- `send` inserts the user message through PostgREST, then calls `agent-execute` with `stream: true` and a fresh idempotency key;
- add the Stop button (abort), the streaming indicator and the budget banner in ChatView.

Then point `AiProvidersApi.testConnection` at `ai-connection-test` in Supabase mode.
