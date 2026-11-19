# Phase 17E: Supabase Authentication Adapter (plan)

**Written:** 2026-11-19, after Milestone 1 (`53261fd`). **Mode:** local code and tests only. No staging access, no accounts and no email until the owner approves.

## Goal
Real sign-in against Supabase Auth (`ppwkxlwxzutigepaizob`) behind `VITE_DATA_PROVIDER=supabase`, with mock mode unchanged. 17E covers **identity and session**. **Authorization data** (roles, memberships, landing page, invitations) comes from RLS-protected rows read by the 17F data adapter. That is why `SUPABASE_ADAPTER_READY` stays `false` until both 17E and 17F pass the security gate in PHASE17_STAGING_RUNBOOK.md.

## Design decisions
1. **`currentSession()` stays synchronous.** `createSupabaseAuth()` awaits `auth.getSession()` and loads the profile before React mounts. Pages keep their current code.
2. **A narrow port, not the SDK, inside the adapter.**
   - `SupabaseAuth` depends on `AuthPort` (`src/data/supabase/authPort.ts`). The port exposes user ids and error codes, **never tokens**.
   - `supabaseAuthPort(client)` is the only code that touches supabase-js, and it is type-checked against the real SDK.
   - Unit tests use an in-memory fake port, so they need no network and no keys.
3. **The session becomes observable:** `AuthApi.onSessionChange(listener)`.
   - Supabase: `onAuthStateChange` (`SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`, `PASSWORD_RECOVERY`).
   - Local: sign-in, sign-out and profile changes.
   - `BackendProvider` subscribes, so expiry, sign-out in another tab and suspension reach the UI.
4. **Suspension** (`profiles.deactivated_at`) is checked at sign-in, at restore and on every token refresh. A suspended user is signed out and gets the same message as in mock mode. RLS (`app.is_active()`) already denies every read, so the adapter check is defense in depth.
5. **No account enumeration:**
   - Sign-in uses one message for an unknown email and a wrong password.
   - Password reset always reports "if an account exists, we sent a link".
   - Self-registration does not reveal whether an email is already registered.
6. **Password recovery:** `requestPasswordReset(email)` sends a link to `<origin>/reset-password`, then `completePasswordReset(newPassword)` runs in the recovery session.
   - Mock mode: the request is accepted with a note that no email is sent. Completing a reset is refused.
7. **Password change** re-authenticates with the current password first, because Supabase `updateUser` alone does not verify it.
8. **Errors** map to the existing classes: `AuthError` and `ValidationError`, plus `PendingConfirmationError` when sign-up needs email confirmation. Raw provider messages are never shown.

## Work items
| # | Item | Needs approval | Status |
|---|---|---|---|
| E1 | Contract: `onSessionChange`, `requestPasswordReset`, `completePasswordReset`; local implementations | No | **Done** (local: reset request accepted without email, completion refused, suspension ends the session) |
| E2 | `AuthPort` and `supabaseAuthPort(client)` | No | **Done** (`src/data/supabase/authPort.ts`, type-checked against supabase-js 2.118) |
| E3 | `SupabaseAuth` adapter: sign-in, restore, sign-out, register, profile, change password, reset, suspension, change events | No | **Done** (`src/data/supabase/auth.ts`) |
| E4 | Unit tests with a fake port: every rule above, plus a check that no token reaches the adapter or UI state | No | **Done**: 26 tests in `src/data/supabase/auth.test.ts`, 4 in `src/data/local/auth.test.ts`. Mutation-checked (generation guard, re-auth, reset leak, restore suspension) |
| E5 | `BackendProvider` subscribes to `onSessionChange` | No | **Done** |
| E6 | UI: `/forgot-password` form and `/reset-password` page; the sign-up confirmation notice | No | **Done** (2026-11-20), plus expired-link and session-ended notices and `/access-pending` |
| E7 | Role-aware landing in Supabase mode: `users.home()` from `platform_admins`, `agency_memberships` and `brand_memberships` (17F) | No (code) | UI and local rules **done** (several clients → `/brands`, none → `/access-pending`); Supabase query with 17F |
| E8 | Invitation acceptance: sign up or sign in, confirm email, then `preview_invitation` / `accept_invitation` / `accept_agency_invitation` RPCs (17F) | No (code) | UI **done** (`?next=` through sign-in and registration, expired and wrong-account states); RPC calls with 17F |
| E9 | Membership revocation in the UI: an `AccessDeniedError` from RLS sends the user to `/home`; Realtime on memberships later (17G) | No | **Done**: the open page turns into a 403 whose link goes to `/home` (then `/access-pending` when nothing is left) |
| E10 | Client Users kept out of agency routes: redirect from `/a/:agency[/clients\|/settings\|/users]` to their client | Owner approved (Decision A, 2026-11-20) | **Done**: routes, data layer (`AgencyAccess.workspace`), RLS verified on PGlite |
| E11 | Staging verification: apply 0006–0010, configure Auth (site URL, redirect URLs, SMTP), create test users, bootstrap the first Super Admin, run the RLS matrix with real JWTs | **Yes, each step** | Blocked |

## Owner decisions and approvals
- **E10:** decided 2026-11-20 (Decision A): Client Users are limited to their client portal. Implemented.
- **Auth configuration on staging:** site URL, allowed redirect URLs (`http://127.0.0.1:5173/**`, `http://localhost:5173/**`), email confirmation on, custom SMTP for invitations and resets.
- **Test users:** create them in the dashboard, or allow sign-up through the API.
- **First Super Admin:** you run `select app.bootstrap_super_admin('<email>')` after 0009 is applied.
- **Laptop:** install the Supabase CLI and log in yourself before any remote step.

## Acceptance criteria
- Mock mode is unchanged: the full suite passes and `tsc` is clean.
- `SupabaseAuth` passes the unit tests for:
  - success and failure of every method;
  - suspension at sign-in, restore and refresh;
  - the non-enumerating messages;
  - recovery flow guards;
  - re-authentication on password change;
  - no tokens in returned objects.
- Supabase mode stays behind `SUPABASE_ADAPTER_READY = false` until 17F and the staging gate pass.
