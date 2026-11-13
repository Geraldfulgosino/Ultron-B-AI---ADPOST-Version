# RLS Role Test Matrix

**Where:** `apps/adpost-web/src/test/db/roles.db.test.ts` (22 tests). Migrations 0001–0009 and the dev seed are applied to PGlite (embedded Postgres 17). Each test runs as a real `authenticated` role with JWT claims.

**What this is:** local verification of the SQL policies. It is **not** live staging verification. No test here has run against `adpost-staging`.

| # | Scenario | Expected | Test |
|---|---|---|---|
| 1 | VCA Admin reads ADPOST records | 0 rows | cross-agency › VCA Admin cannot read ADPOST |
| 2 | ADPOST Admin manages another agency's users | error | cross-agency › another agency's users |
| 3 | LIPSKY user reads CMS documents, files, conversations | 0 rows; LIPSKY websites visible | cross-client › LIPSKY vs CMS |
| 4 | POD client changes the URL to FMF | nothing | cross-client › URL change |
| 5 | Foreign ids smuggled into insert/update | rejected | cross-client › smuggled ids |
| 6 | Client User creates an Admin, invites, grants roles | error | escalation › Client User |
| 7 | Admin creates a Super Admin or invites agency admins | error | escalation › Admin |
| 8 | Sign-up metadata `role=super_admin` | no role | escalation › metadata |
| 9 | Admin invites into other agencies' clients; permissions on non-client roles | error | escalation › invites |
| 10 | Super Admin reads every agency and client and creates clients | ok | Super Admin › reads all |
| 11 | Super Admin reads others' private conversations | 0 rows | Super Admin › private |
| 12 | Grant/revoke Super Admin; never the last; audited | ok / error / audited | Super Admin › grant/revoke |
| 13 | Agency suspension locks out Admins and clients; Super Admin restores | 0 rows → restored | Super Admin › suspension |
| 14 | Suspended account with the same JWT | 0 rows on next query | suspension › account |
| 15 | Revoked membership | reads stop immediately | suspension › membership |
| 16 | Client User write attempts (default) | denied | portal › read-only |
| 17 | Client reads internal/private conversations; client_shared without ai_chat | denied | portal › conversations |
| 18 | Client sees non-client-facing agents or instructions | denied | portal › agents |
| 19 | Private conversation seen by other staff or the agency admin | denied | portal › private |
| 20 | Non-client-visible projects/tasks; comments without comment_tasks | denied | portal › projects |
| 21 | Invitation with an unconfirmed or mismatched email; repeat acceptance | denied; one membership | portal › invitation |
| 22 | Bootstrap: second use, call by app users | denied after first; not executable | bootstrap (fresh DB) |

## Related suites
- `hierarchy.db.test.ts`, `rls.db.test.ts`: tenant isolation across 33 brand tables, plus hierarchy counts.
- `src/test/ai/handlers.test.ts`: Client User agent-run rules on the server (5 tests).
- `src/test/ai/invites.test.ts`: invitation delivery rules (10 tests).
- `src/data/local/*.test.ts`, `src/pages/agencies/agencies.test.tsx`: the mock adapter and the UI.

## Still required on staging (after approval)
Repeat rows 1–22 against `adpost-staging` with real Auth users (`PHASE17_STAGING_RUNBOOK.md` approach). Until then, report these rules as **locally tested**, not live-verified.
