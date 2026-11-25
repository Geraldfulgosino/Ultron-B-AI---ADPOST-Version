# ADPOST Edition — Master Progress

## Baseline (Phase 00, 2026-10-25)

**Project root:** `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`
**Remote:** `https://github.com/Geraldfulgosino/Ultron-B-AI---ADPOST-Version.git`
**Branch:** `feature/adpost-react-supabase-ai`, tracking origin; `main` = same commit `13bc3d0` at audit time.

### What exists (verified by inspection)

- Laravel 13 / PHP 8.4 modular monolith. Domains: Analytics, Audit, Automation, Clients, Identity, Integrations, Invitations, Organizations, Reports, Seo.
- 20 migrations (MySQL 8.4), 41 PHPUnit test files with ~370 test methods.
- React 19 + Inertia v2 frontend: 21 pages under `resources/js/pages`, 6 UI primitives (Badge, Button, Card, Input, Label, Textarea), `AppLayout` sidebar shell.
- Routes: org-scoped (`/{organization}/...`) dashboard, settings, members, invitations, clients, websites, integrations (Google OAuth + sync), reports (preview + CSV + PDF export), n8n bridge, SEO dashboard, SEO insights review workflow.

### Host toolchain

| Tool | Available | Impact |
|------|-----------|--------|
| git 2.55 | yes | commits/push OK |
| node 24.19 / npm 11.17 | yes | frontend typecheck/build/tests OK |
| php | **no** | Laravel PHPUnit suite cannot run on this host |
| docker | **no** | Compose stack cannot start on this host |
| gh CLI | no | not needed; git push over HTTPS works |

### Baseline verification

- `npm ci` → OK. `npm run typecheck` → 0 errors. `npm run build` → OK.
- `npm audit` reported 9 vulns (7 high, 2 critical) in dev deps (axios, vite, postcss, shell-quote, …). Fixed with non-breaking `npm audit fix` → 0 vulns; typecheck + build re-verified.
- PHPUnit: **not run** (no PHP/Docker). Recorded as blocker B-001.

### Blockers

| ID | Blocker | Workaround |
|----|---------|-----------|
| B-001 | No PHP/Docker on host; Laravel suite unverifiable this session | Do not modify Laravel PHP code; new work lives in standalone frontend with its own Vitest suite |
| B-002 | Live Supabase not authorized | Local typed adapters + SQL migrations prepared for Phase 17 |
| B-003 | Netlify deploy not authorized | Phase 18 deferred |

## Milestone log

| Date | Phase | Milestone | Commit | Pushed |
|------|-------|-----------|--------|--------|
| 2026-10-25 | 00 | Audit baseline + npm audit fix | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 01 | ADRs + Supabase integration plan | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 02 | Standalone React foundation | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 03 | Local backend abstractions + Supabase schema | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 04 | Auth + authorization interfaces | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 05 | ADPOST multi-brand workspaces | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 06 | Phase 06a parity data layer | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 06 | Existing feature migration and parity (UI) | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 07 | AI agent registry | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 08 | Individual AI agent chat | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 09 | AI team collaboration and orchestration | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 10 | Phase 10 data layer | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 10 | Projects, tasks, and human approvals | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 11 | SEO intelligence and analytics | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 12 | Web Design and Web Development workflows | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 13 | Knowledge and brand memory | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 14 | Local QA, security, and regression testing | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 15 | Free-tier deployment preparation | see GITHUB_SYNC_LOG.md | see log |
| 2026-10-25 | 16 | Future subscription architecture | see GITHUB_SYNC_LOG.md | see log |

## Session summary (2026-10-25)
Phases 00–16 completed locally and pushed to `feature/adpost-react-supabase-ai`. Phases 17–18 are blocked pending authorization. The standalone app is in `apps/adpost-web` (see its README); the Supabase schema, RLS and seed are in `supabase/migrations`; the backend contract suite is in `apps/adpost-web/src/test/contract`. The legacy Laravel app is unchanged.

## UI enhancement: global dark mode (2026-10-26)
- Light / dark / system theme with a sidebar switch directly above the user profile. It applies instantly, persists in localStorage and follows the OS until the user picks a theme (ADR-009).
- About 390 hard-coded color classes in 33 files moved onto semantic tokens; light mode is visually unchanged. The chart series uses `#6366f1` in dark mode, which passes the dataviz validator on the dark card surface.
- Fixed a pre-existing Chromium-only crash when opening a chat thread (ChatView effect cleanup), found during the first real-browser check.

## Local QA + Phase 17 preparation (2026-11-02)
- Resumed from `c6a64e8` and re-verified it before changing anything: 197/197 tests, build ok, 0 vulnerabilities.
- Real-browser QA in headless Edge covered brand switching, role-based navigation and 403 deep links for six accounts, agent and team chat end to end, form validation, mobile layout and the drawer, and the theme toggle with persistence. Details are in TEST_RESULTS.md.
- Accessibility (axe-core, WCAG 2.1 AA) found six issues, all fixed, and every scanned view now passes in both themes:
  - Sidebar label contrast.
  - The `/register` link was distinguished by colour only.
  - The chart table's scroll region wasn't focusable.
  - Two low-contrast texts.
  - Mobile drawer focus and Escape handling.
- 200/200 tests, including three new regression tests.
- Phase 17 prep: added `PHASE17_STAGING_RUNBOOK.md` (project config, auth redirects, env vars, migration order, RLS test matrix, storage, Edge Function order, adapter plan, and known SQL risks R1–R5) and the prepared migration `20261102000004_realtime.sql`. Nothing was connected or applied.

## Phase 17 — Supabase (started 2026-11-02, staging `adpost-staging` / `ppwkxlwxzutigepaizob`)
| Milestone | Status |
|---|---|
| 17A Client foundation | **Validated locally.** `@supabase/supabase-js` 2.118.0 (MIT, no install scripts). Env validation, project-ref guard, secret-key refusal, `mock`/`supabase` provider factory, connection status screen. Mock mode unchanged |
| 17B/C Schema + RLS hardening | **Validated locally on real Postgres** (PGlite 0.5.10, Apache-2.0, dev-only). R1 reproduced and fixed; R2 and S1–S8 fixed (SECURITY_REVIEW.md); 37 DB tests; mutation check passes. **Not deployed to staging** |
| First remote migration | **Awaiting:** CLI login (owner), then a dry run, then owner approval |
| 17D–K Adapters, auth, realtime, storage, AI, SEO, work | Not implemented |
| 17D Staging migrations | **Deployed and verified on staging** (`3463589`): 0001–0005 applied after owner approval; catalog checks; 38/38 rollback-only RLS checks on staging; advisors 0 errors. 0006 (advisor fixes) prepared and awaiting approval |
| 17I Claude SEO | Upstream audited at `6be93f4` (MIT). 40-skill registry in code, with generated SEO_SKILL_REGISTRY.md. Capability map written. **No skill runs yet** |
| 17J SEO execution | SSRF-safe fetcher (`urlSafety.ts`, 38 tests). Edge Function not built |
| 17G AI runtime | Architecture, provider plan and test plan documented. **Not implemented; no model credentials** |

## Master prompt v5.0: AI provider connection manager (2026-11-02)
| Milestone | Status | Commit |
|---|---|---|
| M1 Architecture audit | Done: existing simulated provider, local engine and orchestrator kept as mock mode; gaps documented in AI_PROVIDER_ARCHITECTURE.md | docs |
| M2 Provider database models | Migration 0007 **validated locally** (PGlite, 19 new DB tests, RLS matrix extended to 31 tables). **Not applied to staging: awaiting approval** | `b10ef28`, `2eb9ad8` |
| M3 Settings UI | Providers, add/detail (test, rotate, disable, remove, health), models, agent routing, usage; mock adapter mirrors RLS | `5768a48` |
| M4 Secret management | Slot-name references, server resolver allow-list, rotation flow; BYOK deliberately disabled | `b10ef28` |
| M5 Anthropic adapter | Implemented; tested with simulated responses; **no live call** | `b10ef28` |
| M6 OpenAI adapter | Implemented; tested with simulated responses; **no live call** | `b10ef28` |
| M7 Provider switching | Assignment-driven routing in the server runtime and the local engine; no code change needed | `b10ef28`, `5768a48` |
| M8 Agent chat runtime | `agent-execute` implemented (auth, ownership, rate limit, idempotency, SSE, cancel); **not deployed** | `2eb9ad8` |
| M9 Team chat runtime | Bounded, provider-independent orchestrator with consolidation | `b10ef28` |
| M10 SEO tools | Page audit, robots.txt, sitemap and llms.txt executable through the tool gateway (SSRF-safe, brand hosts only) | `b10ef28` |
| M11 Usage and budgets | Budgets and ceilings enforced pre-call; usage events; usage dashboard | `b10ef28`, `5768a48` |
| M12 Staging integration | **Awaiting approval** (apply 0007, deploy two functions) | — |
| M13 Real API smoke tests | **Awaiting credentials, budget and approval** | — |
| M14 Production readiness | Not started (no deployment authorized) | — |

## Multi-agency, client and website management (2026-11-05; pushed 2026-11-13, see GITHUB_SYNC_LOG.md)
| Milestone | Status | Commit |
|---|---|---|
| Phase 0 audit + mapping | Done; owner confirmed Client = Brand, synthetic analytics test-only | — |
| M1 schema 0008 + dev seed | Validated on PGlite (15 new DB tests; all 74 DB tests pass). **Not applied to staging** | `0841ef1` |
| M2 local multi-agency UI | Directory, agency overview, clients, settings, websites, selector, canonical URLs; dev app on the exact sample seed | `606a78a` |
| M3 AI scope | Website-scoped conversations, context and server tool hosts | `f0254cd` |
| Next | Agency-level AI team; agency membership UI; Supabase adapters; staging (approval) | — |
See MULTI_AGENCY_ARCHITECTURE.md.

## Master prompt v6.0: Super Admin / Admin / Client User (2026-11-13)
| Milestone | Status | Commit |
|---|---|---|
| Role model, RLS, invitations, audit, bootstrap (migration 0009) | Validated on PGlite (100 DB tests). **Not applied to staging** | `1f6dec7` |
| Hierarchy reconciliation (owner answers) | Done in the SQL dev seed and local sample (one-time, rename/archive only) | `1f6dec7` |
| Super Admin platform, agency users, Client User portal, My profile | Local adapter + UI, tested; browser QA 13/13 | `f582e17` |
| Server: Client User agent runs; `user-invite` function | Implemented and tested with fakes; **not deployed** | `e9574dc` |
| Docs | ROLE_ARCHITECTURE, PERMISSION_MATRIX, SUPER_ADMIN_DESIGN, AGENCY_ADMIN_DESIGN, CLIENT_PORTAL_ACCESS, USER_INVITATION_FLOW, RLS_ROLE_TEST_MATRIX, STAGING_MIGRATION_PLAN_0006_0009 | docs commit |
| Milestones O–Q (staging) | **Plan ready, awaiting explicit approval** | — |

## Master prompt v7.0: first real website integration, Lugenix (2026-11-13)
| Phase | Status | Commit |
|---|---|---|
| 01 Baseline | Verified. The Lugenix records claimed in the prompt are not in the repository or on staging. Staging is empty | — |
| 02 Pilot workspace | Pilot seed prepared and tested. **Not applied**. Agency decision pending | docs commit |
| 03 Live data mode | Provider switch exists (`VITE_DATA_PROVIDER`). **17E/17F adapters not implemented** | — |
| 04 Reusable integration system | Types, registry, status model, sync service, repository | `ccbc803`, `f2d4130` |
| 05 WordPress | Connector implemented and tested. **Public API live-verified** (read-only, nothing stored) | `ccbc803` |
| 06 GA4 | Connector and OAuth implemented, fake-tested. **No Google call made** | `783ce3c`, `f2d4130` |
| 07 Search Console | Connector, property coverage and opportunities implemented, fake-tested. **No Google call made** | `783ce3c`, `f2d4130` |
| 08 Crawler | Implemented and tested. **Live 40-page read-only crawl** | `d5ff731` |
| 09 Persistence | Migration 0010 validated on PGlite. **Not applied** | `c894bab` |
| 10 Integrations UI | Honest mock UI, plus the browser client for the functions | `89f4e03` |
| 11–14 Dashboard, SEO skills, AI context, reports on real data | Not started (they depend on 17F and staging data) | — |
| 15 n8n | Not started (optional) | — |
| 16 Security | See INTEGRATION_SECURITY.md (one NULL-helper bug found and fixed) | `c894bab` |
| 17 Tests | 593 passed + 1 opt-in skipped (57 files); tsc clean; build ok | — |

## Milestone 1: new laptop baseline recovery (2026-11-19)
**Project root (laptop):** `C:\Users\GeraldFulgosino\Documents\Ultron-B-AI---ADPOST-Version`. Recovered at `d289290`, with local and remote identical.

| Item | Result |
|---|---|
| Read-only recovery audit | Done. Git, docs, architecture, Supabase, roles, AI, SEO skills, Lugenix and environment all audited. No code changes |
| `@types/node` | Declared in `apps/adpost-web` (24.19.2, exact). It was previously resolved from the repo-root `node_modules`, so a fresh checkout failed `tsc` |
| Node requirement | `engines.node >= 24.0.0`. Node 24 and 26 LTS supported |
| Client User test | Root cause: a stale-element race in the test (it matched the previous route's 403 heading). Fixed with `expectDenied()`, plus a regression check on `/a/adpost/users`. Security behaviour unchanged |
| Verification | tsc 0 errors; 593 passed + 1 opt-in skipped; build ok; 0 vulnerabilities |
| Findings for 17E | Client Users can open their own agency's workspace shell (data scoped, read-only). In-shell 403 lacks `<main>` |
| Commit | `53261fd`, pushed and verified |
| 17E E1–E5 | Auth contract additions, `AuthPort`, `SupabaseAuth` adapter, 30 new tests; not connected (see PHASE17E_AUTH_ADAPTER_PLAN.md) |

## Milestone 2: Phase 17E authentication UI and role-aware routing (2026-11-20)
| Item | Result |
|---|---|
| Owner decisions | A: Client Users land on their client, no agency administration. B: Lugenix stays a separate agency (pilot seed already matches). C: local only, no staging writes |
| Auth pages | `/forgot-password`, `/reset-password`, registration confirmation notice, expired-link and session-ended notices, `/access-pending` |
| Role landing | Super Admin → `/platform`; Admin → their agency; Client User → their client, or `/brands` for several; no membership → `/access-pending` |
| Decision A enforcement | Agency routes and `/agencies` redirect Client Users home; `agencies.overview/clients` refuse them in the data layer; RLS verified on PGlite |
| Return URLs | `safeNext()`: same-app paths only, never an auth page |
| Accessibility | All status pages have `<main id="main">` and a focused heading; in-shell 403 reachable by the skip link; field errors linked |
| Verification | tsc 0 errors; 687 passed + 1 opt-in skipped; build ok; 0 vulnerabilities; no browser QA |
| Commit | see GITHUB_SYNC_LOG.md |

## Milestone 3: Phase 17F repositories (2026-11-20)
| Item | Result |
|---|---|
| `DbPort` | Narrow PostgREST-shaped port; `supabaseDbPort(client)` is the only supabase-js data code |
| Repositories | Agencies, clients, websites, memberships, profiles, integration connections (read-only), conversations, messages, projects, tasks; `resolveHome()`; invitation RPCs |
| Authorization | RLS decides; hidden = `AccessDeniedError`; outages = `ServiceError`; 0-row updates are denied, never success; no mock fallback |
| Pagination | Offset pages with totals (max 100); keyset pages for messages |
| Finding | `insert … returning` refused on `brands`/`conversations` (id-based read policies); fixed with client-generated ids and insert-then-read |
| Tests | 20 PGlite repository tests + 6 port unit tests; mutation-checked. Full suite 713 passed + 1 opt-in skipped |
| Still gated | `SUPABASE_ADAPTER_READY = false`; F6–F9 next; F10 needs staging approval |
| Commit | see GITHUB_SYNC_LOG.md |

## Milestone 4: Phase 17F application wiring and boot path (2026-11-20)
| Item | Result |
|---|---|
| `SupabaseBackend` | Full `Backend` contract over the repositories; roles from the shared access rules |
| Live areas | Workspace, agencies, users/roles, inner clients, websites, members, invitations, integrations (list, disconnect), agents (read), chat, projects, tasks, comments |
| Guarded areas | Analytics, insights, reports, automation, intelligence, studio, knowledge, AI settings, approvals: access check, then `NotAvailableError` |
| Contract suite | Runs against both adapters; Supabase on PGlite passes 8/8 (mutation-checked) |
| Isolation tests | 11 on the sample hierarchy: Super Admin, Admin cross-agency, Client User cross-client and agency admin, conversations, agents of other clients, credentials, notifications |
| Migration 0011 | `platform_admins` readable by Super Admins (finding); local only |
| Boot | `supabaseBoot.tsx`: config → client → session → roles → router; still gated |
| Verification | 739 passed + 1 opt-in skipped; tsc 0; build ok; 0 vulnerabilities |

## Milestone 5: ADPOST/POD GA4 + GSC readiness (2026-11-20)
| Item | Result |
|---|---|
| Pilot seed | `adpost_pod_pilot.sql`: ADPOST → {ADPOST, POD} → one production website each; owner-supplied URLs only; guarded and idempotent (9 tests) |
| Property ownership | One Google property per website: app check before any Google call + migration 0012 unique index (tests fail without it) |
| Audit trail | Authorization, property selection, connect and disconnect write `platform_audit_events`, without secrets |
| Comparisons | `compare.ts`: GA4 and GSC current vs previous, ratios from totals, per website only |
| OAuth callback | `/oauth/google/callback` route; code and state forwarded once, then removed from the URL |
| Staging checklist | STAGING_RELEASE_CHECKLIST.md: preflight, compatibility, RLS, backup, auth, Super Admin, OAuth URLs, secrets, pilot, property selection, smoke tests, rollback, approval phrases |
| Verification | 763 passed + 1 opt-in skipped; tsc 0; build ok; 0 vulnerabilities |

## VCA demonstration data (2026-11-25, local mock adapter only)
| Phase | Status |
|---|---|
| 1 Recover state | Done. Rebased on the laptop's 17E/17F and ADPOST/POD work (79941c0), no force-push |
| 2–3 Dataset and synthetic analytics | Done: 4 clients on their existing demo websites, 90 days, splits that sum to totals, weekly queries and pages |
| 4 Dashboard | Done: 7/28/30/90 ranges, website filter, GA4 and GSC KPIs with deltas, breakdowns, simulated notice |
| 5 Integrations | Done: simulated GA4/GSC with history, freshness, simulated failure. WordPress not simulated (platform unknown) |
| 6–8 SEO Overview, Insights, Intelligence | Done: devices and countries, query movers, 12 insights per client, explainable health score, competitors (simulated) |
| 9 Reports | Done: report sections plus CSV/PDF demo notice and watermark |
| 10–12 Agents, chat, team chat | Done: 9 simulated conversations and 24 executions per client |
| 13–14 Work, knowledge | Done: sprint, 8 tasks, 3 approvals, 5 documents per client |
| 15–16 Isolation, safety | Done: deterministic, idempotent, owned ids, confirm-gated reset |
| 17 Browser QA | **Not run** (Chrome connection timed out) |
| 18 Tests | 792 passed + 1 opt-in skipped; tsc 0; build ok; 0 vulnerabilities |
