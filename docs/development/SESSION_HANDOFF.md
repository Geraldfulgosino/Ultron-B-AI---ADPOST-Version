# Session Handoff

**Updated:** 2026-11-02 (Phase 17: staging DB live and verified; SEO and AI foundations local)
**Project root:** `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`
**Branch:** `feature/adpost-react-supabase-ai` (pushed; `main` untouched at `13bc3d0`)
**Supabase:** `adpost-staging`, ref `ppwkxlwxzutigepaizob`; the CLI 2.121.0 is logged in and linked (`supabase/.temp/` is git-ignored).
**Applied to staging:** migrations 0001–0005. **Not applied:** 0006_advisor_fixes (awaiting approval).
**Last synced commit:** see GITHUB_SYNC_LOG.md

## Status by milestone
| Milestone | State |
|---|---|
| 17A client/config/provider factory | Validated locally (Supabase mode shows a status screen; the app is not mounted on Supabase yet) |
| 17D schema + RLS | **Deployed and verified on staging**: catalog checks, 38/38 rollback-only RLS checks, advisors 0 errors |
| 0006 advisor fixes | Implemented and validated locally (full matrix unchanged); **awaiting approval** |
| 17E auth adapter | Not implemented (next) |
| 17F data adapters | Not implemented |
| 17G live AI chat | Designed (AI_RUNTIME_ARCHITECTURE.md, AI_MODEL_PROVIDER_PLAN.md); **awaiting model API authorization** |
| 17I Claude SEO | Upstream audited (`6be93f4`, MIT); 40-skill registry and generated doc; no skill executes yet |
| 17J SEO execution | SSRF-safe fetcher unit-tested; Edge Function not built |
| 17K GA4/GSC | Awaiting Google OAuth credentials |
| Durable worker | Designed; needs paid infrastructure approval |

## Tests (where they ran)
- **Staging:** migration push; catalog queries; a 38-check RLS script (rollback-only, nothing persisted); advisors.
- **Local real Postgres (PGlite):** 40 DB tests.
- **Mock/unit (jsdom/node):** all others. Total 293 passed + 1 opt-in.
- Not yet run: PostgREST HTTP layer, GoTrue sign-up/reset emails, Storage API, Realtime delivery, any live model call.

## Owner decisions needed
1. Approve migration `20261102000006_advisor_fixes.sql` (performance and search-path only; RLS behaviour unchanged locally).
2. Authorize a model API account (Anthropic and/or OpenAI) with a provider-side spend cap, then set it with `supabase secrets set`. Never paste it in chat.
3. Staging test users for 17E: either allow Claude to create synthetic auth users through the sign-up API (needs "Confirm email" off on staging, or custom SMTP), or the owner creates them under Dashboard → Authentication → Add user (auto-confirm).

## Next exact task (no approval needed)
Build the Supabase auth adapter (17E) behind the existing `AuthApi` contract: session bootstrap before render, password reset and update, a `/reset-password` route, membership loading, deactivation and revocation handling. Then the contract suite against staging once test users exist.
