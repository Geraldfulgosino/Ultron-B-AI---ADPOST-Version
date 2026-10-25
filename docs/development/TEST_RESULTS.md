# Test Results

| Date | Phase | Suite | Command | Result |
|------|-------|-------|---------|--------|
| 2026-10-25 | 00 | Legacy TS | `npm run typecheck` | pass (0 errors) |
| 2026-10-25 | 00 | Legacy build | `npm run build` | pass |
| 2026-10-25 | 00 | npm audit | `npm audit` | 9 → 0 vulns after `npm audit fix` |
| 2026-10-25 | 00 | Laravel PHPUnit | `php artisan test` | **not run** — no PHP/Docker on host (B-001) |
| 2026-10-25 | 02 | adpost-web | typecheck + vitest + build | pass — tsc 0 errors, 6/6 tests, build ok |
