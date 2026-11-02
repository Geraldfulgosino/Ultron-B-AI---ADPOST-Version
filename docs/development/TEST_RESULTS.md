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
