# Session Handoff

**Updated:** 2026-11-02 (resume session: local QA + Phase 17 preparation)
**Project root:** `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`
**Branch:** `feature/adpost-react-supabase-ai` (pushed; `main` untouched at `13bc3d0`)
**Last completed milestone:** Phases 00–16, global dark mode, real-browser and accessibility QA, Phase 17 staging runbook
**Last synced commit:** see GITHUB_SYNC_LOG.md (source of truth: `git log origin/feature/adpost-react-supabase-ai -1`)

## Test status (2026-11-02)
- adpost-web: `tsc` 0 errors · **200/200** Vitest tests · build ok · `npm audit` 0 vulnerabilities.
- Real-browser QA (headless Edge, desktop and 390 px mobile, both themes):
  - Checked: brand switching, role navigation and 403 deep links for six accounts, agent and team chat end to end, form validation, mobile drawer, theme persistence.
  - axe-core WCAG 2.1 AA: **0 violations** on 22 routes plus the open-table, open-drawer and open-thread states.
  - Six issues were found and fixed (see TEST_RESULTS.md).
- Supabase SQL: four migrations parse with the Postgres 18 parser. **Never executed.**
- Legacy frontend: unchanged this session. Laravel PHPUnit: **not run** (B-001).

## Blockers
- B-001: no PHP/Docker on host.
- B-002: Supabase not authorized (Phase 17).
- B-003: Netlify not authorized (Phase 18).

## Open items
- Not tested: Lighthouse, Firefox/Safari, real phones, a screen-reader walkthrough.
- RLS policies need the runbook §5 test matrix on staging. Check SQL risks R1 (FORCE RLS with definer helpers) and R2 (auth trigger privileges) first.
- The `AuthApi` contract needs password reset and a `/reset-password` route before live auth (runbook §6.3).
- By design: a viewer can open `/settings` (all fields disabled) even though the sidebar hides it for non-admins.
- Live model pricing is intentionally unset (`MODEL_CATALOG` rates are null).

## Next exact task
**Owner action (first step that needs authorization):** create the Supabase project `adpost-staging` and share only its URL and anon key. See `PHASE17_STAGING_RUNBOOK.md` §0.
Then, each step confirmed separately:
1. `supabase db push` the four migrations.
2. Check R1 and R2.
3. Seed the test matrix.
4. Add the `@supabase/supabase-js` adapter (after a security review).
5. Add `supabase.contract.test.ts` and the RLS suite.
