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
