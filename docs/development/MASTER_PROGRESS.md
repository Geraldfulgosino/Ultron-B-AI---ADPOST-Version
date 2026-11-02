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
