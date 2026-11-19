# Session Handoff

**Updated:** 2026-11-19 (Milestone 1: new laptop baseline recovery)
**Project root (current, laptop):** `C:\Users\GeraldFulgosino\Documents\Ultron-B-AI---ADPOST-Version`. Until 2026-11-13 the project lived on a desktop at `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`.
**Branch:** `feature/adpost-react-supabase-ai`, pushed. The remote SHA is in GITHUB_SYNC_LOG.md. `main` is untouched.
**Supabase:** `adpost-staging`, ref `ppwkxlwxzutigepaizob`. It was linked from the desktop. On the laptop the Supabase CLI is **not installed and not linked** (see below).
**Applied to staging:** 0001–0005 only. Staging is empty except 6 agent templates (read-only precheck).
**Local only, awaiting approval:** 0006, 0007, 0008, 0009, **0010_website_integrations**, plus the pilot seed `supabase/seeds/pilot/lugenix_pilot.sql`.
**Deployed Edge Functions:** none. Implemented: `agent-execute`, `ai-connection-test`, `user-invite`, **`integration-sync`**, **`integration-google`**.

## 2026-11-19: new laptop baseline (read first)
- **Recovered state:** local and `origin` were identical at `d289290` (v7 docs), with a clean tree. Nothing was lost or duplicated in the move.
- **Laptop toolchain:**
  - Node 26.13.1 (Active LTS), npm 11.20.0, Git 2.56.0, VS Code 1.146.0, Claude Code 2.1.328.
  - PHP, Docker and the Supabase CLI are not installed.
  - The repo-root `node_modules` is not installed (legacy Laravel/Inertia app, out of scope).
- **Node requirement:** `apps/adpost-web` now declares `"engines": { "node": ">=24.0.0" }`.
  - Node 24 LTS (the desktop) and Node 26 LTS (the laptop) are both supported.
  - Vite 8 needs `^20.19 || >=22.12`; vitest 5's Node types need `^22 || >=24`.
- **Fix 1: TypeScript.** `vite.config.ts` imports `node:url`, but `@types/node` was never declared in `apps/adpost-web`.
  - On the desktop, `tsc` resolved it from the repo-root `node_modules` (root `@types/node` 25.9.3).
  - A fresh checkout without a root install failed with `TS2591: Cannot find name 'node:url'`.
  - Now declared: `@types/node` **24.19.2**, exact, matching the lowest supported Node major. The lockfile only gained `@types/node` and `undici-types`.
- **Fix 2: Client User test** (`agencies.test.tsx`, "a read-only Client User has no chat, no report downloads and no admin pages"). This was a test race, not a security defect.
  - After `/chat` rendered a 403, the test navigated to `/members` and called `findByRole('heading', { name: 'Access denied' })`.
  - That call returned the **stale `/chat` heading** before React committed the new route. React then remounted the 403 for `/members`, the stale node detached, and `toBeInTheDocument()` failed.
  - On the desktop the same race could pass while asserting nothing about `/members`. Node 26/jsdom scheduling exposed it.
  - Fix: `expectDenied()` waits for the new location and for any previous 403 heading to unmount, then asserts the fresh 403.
  - Added a regression assertion: the read-only Client User also gets no user list and no invite actions on `/a/adpost/users`.
- **Open finding (owner decision, see the 17E plan):** a Client User can open their own agency's workspace shell: `/a/:agency` overview, `/clients` and read-only `/settings`.
  - Data stays scoped to their own client. Other agencies return 403, and every agency write is refused.
  - This is still broader than "only assigned client workspaces". The proposal is to redirect Client Users from agency routes to their client in 17E.
- **Minor a11y gap (not fixed):** a 403 rendered inside the app shell has no `<main id="main">`, so "Skip to content" has no target.
- **Verification:**
  - `npm run typecheck`: 0 errors.
  - `npm test`: **593 passed + 1 opt-in skipped** (57 files; stable across 3 full runs).
  - `npm run build`: ok. `npm audit`: 0 vulnerabilities.
  - The skipped test is `stagingRls.db.test.ts`, which runs only with `STAGING_RLS_RESULT_FILE`.

## Still pending (unchanged by Milestone 1)
- **Staging migrations 0006–0010:** local only, awaiting approval. The pilot seed is not applied.
- **17E auth adapter and 17F data adapter:** not implemented (`SUPABASE_ADAPTER_READY = false` in `src/main.tsx`).
- **Lugenix:**
  - agency ownership decision;
  - Edge secrets and `integration-sync` deployment;
  - Google OAuth client and the `/oauth/google/callback` route;
  - dashboard, AI context and reports on real data.
- **Laptop setup for any remote step:** install the Supabase CLI, run `supabase login` (owner), and run `supabase link --project-ref ppwkxlwxzutigepaizob`.

## 2026-11-13: v7.0 integrations
- **Read first:** LUGENIX_INTEGRATION_PLAN.md (verified baseline and order of approvals) and LUGENIX_PILOT_CHECKLIST.md.
- **Reusable server-side connectors** in `supabase/functions/_shared/integrations/`:
  - `wordpress.ts`
  - `crawler.ts`
  - `google.ts`, `ga4.ts`, `gsc.ts`
  - services `sync.ts` and `googleSync.ts`
  - `secrets.ts` (AES-GCM)
  - `supabaseRepo.ts`
- **Live, read-only, nothing stored:**
  - WordPress public API on the pilot: 21 pages, 137 posts, 8 categories, 0 tags, 1,076 media counted. Rank Math, Elementor, Site Kit.
  - A 40-page crawl: all HTTP 200, heuristic findings only.
- **Persistence:** migration 0010 (see REAL_DATA_MIGRATION_PLAN.md). It also fixes `app.can_read_client_row` returning NULL (in 0009).
- **UI:** the Integrations page is honest in mock mode. The browser client for the functions is in `src/data/supabase/integrationsClient.ts`.
- **Not done:**
  - 17E/17F: staging auth and the Supabase data adapter, so the dashboard still uses mock data;
  - the `/oauth/google/callback` page;
  - the dashboard, AI context and reports on real integration data;
  - the n8n adapter.

## Owner decisions needed (v7)
1. **Pilot agency:** a separate agency "Lugenix Digital Services" (slug `lugenix`, as prepared), or put the pilot client under GoldStarATM?
2. **Approve staging migrations 0006–0010**, then the pilot seed.
3. **Approve the Edge secrets and the `integration-sync` deployment.** This is the first real staging writes: WordPress inventory and crawl.
4. **Optional:** a dedicated WordPress user plus Application Password for authenticated reads (drafts, media list).
5. **Google:** create a Google Cloud OAuth client (Web; redirect `<app origin>/oauth/google/callback`; Analytics Admin, Analytics Data and Search Console APIs), and approve authorizing the Lugenix Google account.
6. Earlier open items still stand (first Super Admin bootstrap, invitation SMTP, AI provider accounts and budgets).

## Next exact task (no approval needed)
Implement 17E/17F: the Supabase auth adapter (login, session restore, role redirects, password reset) and the data adapter for agencies, clients, websites and integrations, behind `VITE_DATA_PROVIDER=supabase`, with no mock fallback. Then add the `/oauth/google/callback` route and the live Integrations actions.

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
