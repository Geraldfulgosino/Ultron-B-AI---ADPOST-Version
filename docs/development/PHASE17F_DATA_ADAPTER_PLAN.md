# Phase 17F: Supabase Data Adapter (plan and status)

**Written:** 2026-11-20 (Milestone 3). **Mode:** local code and tests only. Nothing connects to staging; `SUPABASE_ADAPTER_READY` stays `false` in `src/main.tsx`.

## Goal
Real data behind `VITE_DATA_PROVIDER=supabase`, with the same `BrandApi` contract the UI already uses (`src/data/contracts.ts`), enforced by RLS. Mock mode stays the default and keeps working for local tests.

## Design
1. **A narrow port, not the SDK, inside the repositories.** `DbPort` (`src/data/supabase/dbPort.ts`) describes PostgREST-shaped requests: table, columns, filters, order, range, count, insert, update, delete, RPC.
   - `supabaseDbPort(client)` is the only code that calls supabase-js. It returns error codes and HTTP statuses only, never raw messages, and never touches a token.
   - Identifiers (tables, columns, functions) must be plain lowercase names; search terms escape `%`, `_` and `\`.
2. **Repositories** (`src/data/supabase/repositories.ts`) for agencies, clients (`brands`), websites, memberships, profiles, integration connections, conversations, messages, projects and tasks.
   - Rows map to the existing domain types (`src/domain/types.ts`). Integration connections reuse the Edge Function types (`supabase/functions/_shared/integrations/types.ts`). No second data model.
   - Repositories are bound to the signed-in user id from the auth adapter, never to a value from the URL.
3. **RLS is the authority.** A record RLS hides is reported as `AccessDeniedError`: the same answer for "missing" and "not yours", so other tenants' ids cannot be probed. Listing a client or agency the caller cannot see is denied, not an empty list.
4. **No silent fallbacks.** A transport failure is a `ServiceError` (new in `src/data/errors.ts`), shown with Retry. An update that touches 0 rows is `AccessDeniedError`, never success. Nothing falls back to mock or cached data.
5. **Writes send only the columns the migrations grant** to `authenticated`. `is_demo` is never sent. Integrations are read-only in the browser: their writes go through the integration Edge Functions (0010 revokes insert and update).
6. **Insert, then read.** Inserts use a client-generated UUID, insert without RETURNING, then select the row. Finding of this milestone: the `brands` and `conversations` read policies look the row up by id through a helper function, which does not see a row inserted by the same statement, so `insert … returning` (PostgREST `return=representation`) is refused with 42501. This would have failed on staging.
7. **Pagination.** Offset pages with totals (`Page<T>`, default 25, max 100) for agencies, clients, profiles, conversations, projects and tasks; keyset pages for messages (newest page first, `before` = oldest loaded `createdAt`).
8. **Landing page.** `resolveHome(repos)` applies the same rules as the local adapter's `users.home()` using only rows RLS returns.

## Work items
| # | Item | Needs approval | Status |
|---|---|---|---|
| F1 | `DbPort` and `supabaseDbPort(client)` | No | **Done** (6 unit tests with a recording supabase-js stub) |
| F2 | Postgres test port (`src/test/db/pgPort.ts`): same requests as SQL under the user's JWT claims, RLS on | No | **Done** |
| F3 | Repositories: agencies, clients, websites, memberships, profiles, integrations, conversations, messages, projects, tasks | No | **Done** |
| F4 | Repository authorization tests on PGlite (Super Admin, Admin, Client User, no membership, revocation, suspension, invitations, pagination, failures) | No | **Done**: 20 tests in `src/test/db/repositories.db.test.ts`; mutation-checked |
| F5 | `resolveHome` (E7 in Supabase mode) and invitation RPCs (E8: `preview_invitation`, `accept_invitation`, `accept_agency_invitation`) | No | **Done** (tested on PGlite) |
| F6 | `SupabaseBackend`: compose `BrandApi` from the repositories area by area (workspace, agencies, users, clients, websites, members, invitations, chat, work, integrations) | No | Next |
| F7 | Areas with server-side logic (agents, AI, SEO insights, reports, studio, knowledge, automation): Edge Function clients, or an explicit "not available yet" error. Never mock data | No (code) | Planned |
| F8 | Run `src/test/contract/backendContract.ts` against `SupabaseBackend` on PGlite | No | Planned (needs F6) |
| F9 | Boot path in `main.tsx`: create the client, restore the session (`createSupabaseAuth`), then mount; loading and error screens | No (code) | Planned; stays behind `SUPABASE_ADAPTER_READY = false` |
| F10 | Staging verification with real JWTs (after 0006–0010 are applied) | **Yes** | Blocked |

## Acceptance before enabling Supabase mode
- F6–F8 done; the backend contract suite passes against `SupabaseBackend` on PGlite.
- The staging RLS matrix passes with real JWTs (F10, after owner approval).
- The full suite, `tsc` and the build pass; mock mode unchanged.
