# Test Results

| Date | Phase | Suite | Command | Result |
|------|-------|-------|---------|--------|
| 2026-10-25 | 00 | Legacy TS | `npm run typecheck` | pass (0 errors) |
| 2026-10-25 | 00 | Legacy build | `npm run build` | pass |
| 2026-10-25 | 00 | npm audit | `npm audit` | 9 → 0 vulns after `npm audit fix` |
| 2026-10-25 | 00 | Laravel PHPUnit | `php artisan test` | **not run** — no PHP/Docker on host (B-001) |
| 2026-10-25 | 02 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 6/6 tests, build ok |
| 2026-10-25 | 03 | Supabase SQL | libpg-query parse (PG 18 parser) | pass — schema 58 stmts, rls 72 stmts; not executed against a DB |
| 2026-10-25 | 03 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 32/32 tests, build ok |
| 2026-10-25 | 04 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 48/48 tests, build ok |
| 2026-10-25 | 05 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 55/55 tests, build ok |
| 2026-10-25 | 06 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 81/81 tests, build ok |
| 2026-10-25 | 06 | Visual check | browser render of charts/pages | **not done** — no browser session used; verified via jsdom tests only |
| 2026-10-25 | 06 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 96/96 tests, build ok |
| 2026-10-25 | 07 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 117/117 tests, build ok |
| 2026-10-25 | 08 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 136/136 tests, build ok |
| 2026-10-25 | 10 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 139/139 tests, build ok |
| 2026-10-25 | 11 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 145/145 tests, build ok |
| 2026-10-25 | 12 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 150/150 tests, build ok |
| 2026-10-25 | 13 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 160/160 tests, build ok |
| 2026-10-25 | 14 | Full regression | adpost-web tsc+vitest+build; legacy typecheck+build; npm audit x2; secret scan | pass — 165/165, 0 vulns, no secrets |
| 2026-10-25 | 14 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 165/165 tests, build ok |
| 2026-10-25 | 15 | Prod preview smoke | vite build + vite preview + curl /, /login, /b/pod/dashboard | pass — 200 + SPA fallback; main chunk 421 kB (133 kB gzip) after route code-splitting |
| 2026-10-25 | 15 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 165/165 tests, build ok |
| 2026-10-25 | 16 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 171/171 tests, build ok |
| 2026-10-25 | 17-prep | Contract suite | vitest src/test/contract | pass — 8/8 against local adapter; full suite 179/179 |
| 2026-10-26 | UI: dark mode | adpost-web | typecheck + vitest + build + audit | pass — tsc 0 errors, 197/197 tests (18 new: theme, tokens, sidebar switch, chat regression), build ok, 0 vulns |
| 2026-10-26 | UI: dark mode | Real-browser check | headless Microsoft Edge via DevTools protocol against `npm run dev`; screenshots of login, dashboard, SEO, insights, reports, agents, chat thread, team chat, projects, approvals, settings at 1440×900 + mobile 390×844 nav, both themes | pass after 2 fixes: switch knob mis-positioned (missing `left-0`); **pre-existing crash** opening a chat thread in Chromium (`useEffect` leaked `scrollIntoView()`'s Promise as its cleanup → "destroy is not a function"). Live toggle verified without reload (body bg #f9fafb → #0b1120, preference saved). No console errors after fixes. Not done: axe/Lighthouse, Firefox/Safari, real-device mobile. |
| 2026-11-02 | Resume check | adpost-web | typecheck + vitest + build + audit, before any change | pass — tsc 0 errors, 197/197, build ok (main 427.74 kB), 0 vulns; repo at c6a64e8 = origin |
| 2026-11-02 | Local QA | Real-browser QA | headless Microsoft Edge via DevTools protocol against `npm run dev`, 1440×900 + 390×844. Login validation (empty / wrong password), focus ring; brand picker (5 brands) + sidebar brand switch; agent chat send→reply; team chat thread (lead + specialist replies); theme toggle live + persists over reload; chart series colour in dark; reports "View as table"; role nav for 6 accounts; deep links: client → /agents, /team and viewer → /automation all 403; DMD manager → POD brand 403; viewer /settings read-only (by design); mobile drawer; 12 pages × 2 themes no horizontal overflow | pass after fixes below. No console errors. |
| 2026-11-02 | Local QA | Accessibility (axe-core 4.10.3, WCAG 2.0/2.1 A+AA) | 22 routes × light/dark, plus reports with tables open, mobile drawer open, open chat thread | **Found:** sidebar group labels + "Following system setting" slate-500 on slate-900 (3.74:1) on every page; /register in-text link colour-only (1.3:1); chart "View as table" scroll region not keyboard-focusable; /automation event codes `fg-subtle` (2.53:1); active conversation preview 4.32:1; mobile drawer had no Escape/focus management. **After fixes: 0 violations** on every scanned view in both themes. Not done: Lighthouse, Firefox/Safari, real devices, screen-reader walkthrough. |
| 2026-11-02 | Local QA | adpost-web | typecheck + vitest + build after fixes | pass — tsc 0 errors, 200/200 tests (3 new: drawer dialog/Escape/focus, chart table region, sidebar contrast guard), build ok |
| 2026-11-02 | 17-prep | Supabase SQL | libpg-query 18.1.5 parse of all migrations incl. new `20261102000004_realtime.sql` | pass — 61 / 75 / 1 / 3 stmts; not executed against a DB |
| 2026-11-02 | 17A–C | Supabase SQL on real Postgres | PGlite 0.5.10 (Postgres WASM) plus Supabase platform emulation; migrations applied as a non-superuser role without BYPASSRLS; `src/test/db/*.db.test.ts` | pass. 37 tests: migrations apply, sign-up trigger works, FORCE regression reproduced, and an RLS matrix across 25 brand tables × 12 synthetic users (SELECT/INSERT/UPDATE/DELETE, client scope, viewer, revocation, deactivation, escalation S1–S5, approvals, invitations, storage, FTS retrieval, Realtime publication). Mutation check without 0005: 18/34 fail as expected. **Local emulation, not staging.** |
| 2026-11-02 | 17A | adpost-web | typecheck + vitest + build after Supabase client foundation | pass. tsc 0 errors, 244/244 (7 new config/connection tests), build ok (main 432.9 kB; supabase-js tree-shaken out of mock mode), 0 vulns |
| 2026-11-02 | 17D | **Staging** migration | Owner approved the reviewed set. `supabase db push --linked` (CLI 2.121.0) to `ppwkxlwxzutigepaizob`; remote history was empty and the dry run listed exactly 0001–0005 | pass. All 5 applied; `migration list` shows local = remote for 0001–0005 |
| 2026-11-02 | 17D | **Staging** catalog checks | `supabase db query --linked` (read-only) | pass. 31/31 public tables have RLS, 0 forced; 6 agent templates; buckets `brand-knowledge` (private, 1 MB) and `report-exports` (private, 20 MB); `supabase_realtime` = agent_executions, approval_requests, messages; `on_auth_user_created` → `app.handle_new_user` on auth.users. Roles: `postgres` has BYPASSRLS on Supabase (so R1 could not have broken staging; the fix stays as a defensive change) |
| 2026-11-02 | 17D | **Staging** RLS verification | Rollback-only script (`src/test/db/stagingRls.ts`) proven on PGlite first, then run with `db query --linked -f`. Seeds the synthetic fixture in a transaction, impersonates users exactly as PostgREST does (`SET LOCAL ROLE authenticated` + `request.jwt.claims`), then RAISEs, which rolls back | **pass: 38/38 checks on staging, 0 failed.** Covers brand and agency isolation, stranger, deactivated, anon, secrets, client scope, viewer and member writes, smuggling, immutable brand_id, S1/S2/S4/S5, approvals, storage folders and paths, FTS retrieval, executions. Post-check: 0 agencies, 0 brands, 0 synthetic users, 0 objects persisted. **Not covered:** PostgREST HTTP layer, GoTrue sign-up emails, Storage API, Realtime delivery |
| 2026-11-02 | 17D | **Staging** Supabase advisors | `supabase db advisors --linked` | 0 errors. WARN: `touch_updated_at` mutable search_path; 3 SECURITY DEFINER RPCs executable by authenticated (intended, authorization checked inside and tested); 10× `auth_rls_initplan`, 5× multiple permissive policies (perf). Fixes prepared as migration 0006, **awaiting separate approval** |
| 2026-11-02 | 17I/17J | adpost-web (mock/unit) | SEO skill registry (8 tests: 40 skills, agent/tool consistency, fake-metric guard, nothing live, limits, provenance, generated-doc drift) + SSRF guard `urlSafety.ts` (38 tests: schemes, credentials, ports, internal hosts, private/obfuscated IPv4, IPv6 incl. mapped/NAT64, split DNS, redirect-to-metadata, hop/size caps, timeouts) | pass. Full suite 293 passed + 1 opt-in skipped; tsc 0; build ok; 0 vulns. **Unit level only; no real site fetched** |

## 2026-11-02: master prompt v5.0 (AI provider connection manager)
- `npm test`: **425 passed + 1 opt-in skipped** (41 files). `tsc --noEmit`: 0 errors. `vite build`: ok.
- New suites:
  - `test/db/aiProviders.db.test.ts` (19, real Postgres);
  - `test/ai/adapters.test.ts` (23), `routing.test.ts` (23), `execution.test.ts` (17), `seoTools.test.ts` (15), `handlers.test.ts` (12) and `bundleSecurity.test.ts` (3);
  - `data/local/ai.test.ts` (13) and `pages/settings/aiSettings.test.tsx` (7).
- Mutation check: running the RLS matrix without migration 0007 (`PG_MIGRATION_SKIP=0007`) fails the table-coverage guard, as intended.
- **Level:** all mock or local Postgres. **No staging test of the AI tables and no live provider call has been made.** The provider adapters are verified against recorded-shape responses only.

## 2026-11-05: multi-agency hierarchy
- Baseline before changes: 425 passed + 1 opt-in. One run of three had 1 failure; it was not reproduced in later runs and is flagged as possibly flaky.
- After: **468 passed + 1 opt-in skipped** (45 files). `tsc --noEmit`: 0 errors. `vite build`: ok. No lint script exists in the repo.
- New suites:
  - `test/db/hierarchy.db.test.ts` (15, PGlite): exact seed counts 3 / 5 / 4 / 1 / 10, idempotency, opt-in guard, RLS isolation, URL rules;
  - `data/local/agencies.test.ts` (11);
  - `pages/agencies/agencies.test.tsx` (12, UI on the sample dataset);
  - `data/local/chatScope.test.ts` (2);
  - `handlers.test.ts` (+3).
- **Level:** local only (mock adapter and PGlite). Nothing ran against staging; no real-browser QA this session.

## 2026-11-05: demo websites (20) and local browser QA
- `npm test`: **483 passed + 1 opt-in skipped**. Two concurrent runs also passed 483/483 each. `tsc`: 0 errors; build ok.
- New and updated tests:
  - DB (PGlite): 20 demo websites, 2 per client, 1 primary per client, production/staging domains, no integrations, never auditable, reserved domain enforced, `is_demo` immutable, re-seed idempotent and preserving a user website and its primary flag, client isolation.
  - Local adapter: the same checks, plus the upgrade of stored browser data.
  - UI: the HAMPTONS selector shows exactly "All HAMPTONS websites / HAMPTONS — Production (Demo) / HAMPTONS — Staging (Demo)"; changing client resets the website.
  - SSRF guard: rejects `.example`, `.test` and `.invalid`. The SEO tools make no request for demo hosts.
- **Real browser (headless Edge over CDP, http://localhost:5173): 38/38 checks.**
  - Covered: the POD, TRADE BAGS, HAMPTONS, LIPSKY and GoldStar ATM website screens, selector options, environment and primary labels, client-change reset, and a demo-scoped chat labelled simulated.
  - The earlier login, agency, client, website and chat flows still pass, and isolation denials work.
  - 0 console errors, 0 failed requests, 0 requests to `.example`/`.test` hosts.

## 2026-11-13: master prompt v6.0 (roles)
- `npm test`: **524 passed + 1 opt-in skipped** (48 files). `tsc`: 0 errors. Build ok.
- **DB (PGlite, migrations 0001–0009 + dev seed): 100 tests.** `roles.db.test.ts` (22) covers every prohibited scenario in RLS_ROLE_TEST_MATRIX.md.
- **Server logic (fakes):**
  - `handlers.test.ts`: 20, including 5 Client User run rules.
  - `invites.test.ts`: 10 (delivery is marked `sent` only on Auth acceptance; refusals cover RLS-hidden, wrong token, expired, accepted, origin and malformed input).
- **Local adapter and UI:** `agencies.test.ts` (16), `agencies.test.tsx` (16), plus the access, routing and sample-upgrade updates.
- **Real browser (headless Edge over CDP, http://localhost:5173, mock adapter): 13/13 checks.**
  - Super Admin: overview, agencies, users and audit.
  - The reconciled ADPOST and GoldStarATM clients.
  - ADPOST Admin: denied `/platform` and VCA; can use agency users.
  - LIPSKY Client User: limited nav, denied platform and agency users.
  - POD read-only client: no Agent Chat.
  - My profile.
  - 0 console errors.
- **Fixed from QA:** the platform overview counted websites of archived clients (30 vs. 24 on the agency rows). Fixed in the local adapter and in `platform_overview()` (0009).
- **Level:** local only. Nothing ran against staging. No email was sent. These are not live security verification.

## 2026-11-19: Milestone 1 (new laptop, Node 26.13.1, npm 11.20.0, Windows 11)
- **Before the fixes:**
  - `tsc`: 1 error, `vite.config.ts(5,36) TS2591 node:url` (`@types/node` was undeclared).
  - `npm test`: 592 passed, 1 failed, 1 skipped. The failure was `agencies.test.tsx` "a read-only Client User …", deterministic on this machine (a stale-element race).
- **After the fixes:**
  - `npm run typecheck`: 0 errors.
  - `npm test`: **593 passed + 1 opt-in skipped** (57 files), identical across 3 full runs. `agencies.test.tsx` passed 5/5 isolated runs.
  - `npm run build`: ok. `npm audit`: 0 vulnerabilities.
- **Skipped:** `src/test/db/stagingRls.db.test.ts` (opt-in: needs `STAGING_RLS_RESULT_FILE` from a staging run).
- **Not run:**
  - Legacy root build and typecheck (root `node_modules` not installed on the laptop).
  - Laravel PHPUnit (B-001: no PHP/Docker).
  - Any staging or live test, and any real-browser QA.

## 2026-11-19: Phase 17E E1–E5 (laptop)
- `npm run typecheck`: 0 errors.
- `npm test`: **623 passed + 1 opt-in skipped** (59 files). New: `src/data/supabase/auth.test.ts` (26) and `src/data/local/auth.test.ts` (4).
- `npm run build`: ok. `npm audit`: 0 vulnerabilities.
- Mutation checks: removing the generation guard, the password re-authentication, the reset no-enumeration rule or the restore suspension check each fails at least one test.
- **Level:** fake ports only. No Supabase request was made.

## 2026-11-20: Milestone 2, Phase 17E UI and role-aware routing (laptop, Node 26.13.1)
- `npm run typecheck`: 0 errors.
- `npm test`: **687 passed + 1 opt-in skipped** (63 files), identical across 3 full runs.
  - New: `src/app/redirects.test.ts` (15), `src/app/roles.test.tsx` (18), `src/pages/auth/auth.test.tsx` (19), `src/pages/invitations.test.tsx` (7).
  - Extended: `src/data/local/agencies.test.ts` (+2), `src/data/local/auth.test.ts` (+1), `src/data/supabase/auth.test.ts` (+1), `src/test/db/roles.db.test.ts` (+1, PGlite), `agencies.test.tsx` (Client User agency routes now redirect).
- Scenarios covered: valid and invalid sign-in, unconfirmed email, expired session, explicit sign-out, sign-out failure, suspension while signed in, stale stored session, password reset request, expired reset link, reset completion, registration with confirmation, invitation acceptance (new account via `?next=`), expired client and agency invitations, wrong account, revoked client membership, revoked agency role, Super Admin / Admin / Client User route access, cross-agency and cross-client denial, direct URL navigation, open redirects and redirect loops, 403 landmarks and focus.
- `npm run build`: ok. `npm audit`: 0 vulnerabilities.
- **Test fixes during the milestone:** two new tests matched a stale heading under full parallel load (the same race class as Milestone 1). They now wait for the new route. The reset page briefly showed "Checking your reset link" after a successful reset; it now shows "Your password was changed" until the redirect.
- **Level:** mock adapter, scripted auth backend and PGlite. No Supabase request was made. No real-browser QA.
