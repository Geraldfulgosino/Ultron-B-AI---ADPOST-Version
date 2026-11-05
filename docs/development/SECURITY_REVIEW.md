# Security Review: adpost-web (Phase 14, local)

Scope: the standalone app in `apps/adpost-web` running on the **local adapter**. This review does **not** cover a deployed or Supabase-backed system. Those require the Phase 17 RLS test plan (SUPABASE_INTEGRATION_PLAN.md §8) against a real project.

## Important: local auth is a simulation
The local adapter keeps the signed-in user id in `sessionStorage`. Anyone with devtools can change it, and the whole local "database" lives in the browser. **Local mode provides no security boundary.** Its authorization rules exist so that UI flows and tenant-isolation behaviour can be tested and mirrored into RLS. Real enforcement arrives with Supabase JWTs + RLS (Phase 17). Never put real customer data into local mode.

## Checks performed

| Area | Result |
|------|--------|
| Tenant isolation | Every adapter method resolves access through `Scope` (`require`/`rows`/`row`/`owned`). Unknown and foreign brands both raise AccessDenied, so brand existence never leaks. Foreign record ids within an allowed brand raise NotFound. Covered by isolation tests in every data test file. |
| Client-role scoping | Client users see only rows of their `clientId` (clients, websites, integrations, analytics, insights, reports, intelligence). Staff-only tables (AI, chat, work, knowledge, studio, automation) are denied entirely. |
| Role checks | Viewer is read-only; manager+ writes; owner/admin administer; admins cannot grant the owner role; the last owner is protected; nobody approves their own request. |
| Browser-supplied ids | Website→client, task→project/assignee, approval→task, conversation→agent and studio→website links are all validated against the same brand. |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` (grep). All user/agent text renders through React escaping with `whitespace-pre-wrap`. |
| Open redirect | `?next=` only accepts same-app relative paths (`safeNext`, tested). |
| CSV injection | Text cells starting with `= + - @ tab CR` are prefixed with `'` (tested). |
| PDF | Text escaped for PDF literals; non-Latin-1 replaced. |
| Secrets | No secrets in tracked files (pattern scan for API keys, JWTs, private keys, Slack/GitHub tokens; no `.env`/`.pem`/`.key` tracked). Integration credentials and the full n8n webhook URL are never returned to the UI (tested). LLM keys live only in the planned Edge Function. |
| Network | The local adapter makes **no** network calls (grep for fetch/XHR/beacon). Syncs, webhooks and AI runs are simulated and labelled. |
| Passwords (local) | Fixture accounts use one synthetic dev password. Registered users' passwords are stored as salted SHA-256 (hashed locally, still a simulation; Supabase Auth replaces it). |
| Agent safety | External-effect actions (publish, deploy, webhook) are only ever proposals → human approval. Orchestration is bounded (6 turns, depth 3, token budget, each agent once per round). Agent context is limited to the agent's read tools. |
| Dependencies | `npm audit`: 0 vulnerabilities in the root and in `apps/adpost-web`. Versions are pinned exactly in `apps/adpost-web`. |

## Fixed during this review
- Registered users could not sign in after a reload, because credentials weren't persisted. They are now persisted, hashed, in a separate key.
- Stored snapshots from older schemas loaded silently. They are now versioned (`DB_SCHEMA_VERSION`) and discarded on mismatch, plus there is a "Reset local demo data" control.
- Dialogs had no focus trap. Tab and Shift+Tab now cycle within the modal.
- There was no skip link. Added "Skip to content" pointing at `<main id="main">`.
- A route crash showed a blank screen. Added a route `errorElement` with a friendly error page.

## Open items (need a real backend)
- RLS policies are parse-checked only. Execute the §8 RLS test plan on staging (Phase 17).
- Rate limiting for exports and agent runs (legacy throttles) must move to Edge Functions.
- Invitation tokens are stored raw locally. The schema stores `token_hash` only.
- No browser-level visual or a11y audit (axe, Lighthouse) has been run yet. jsdom tests only.

---

# Security Review: Phase 17 database hardening (2026-11-02)

**Method:** static review of `supabase/migrations/*`, then execution on **real Postgres** (PGlite = Postgres compiled to WASM) with an emulation of the Supabase platform (`apps/adpost-web/src/test/db/pg.ts`): roles `anon`/`authenticated`/`service_role`/`supabase_auth_admin`, `auth.uid()`/`auth.jwt()` defined as Supabase defines them, `auth.users`, `storage.*`, default grants, and the `supabase_realtime` publication. Migrations run as a **non-superuser role without BYPASSRLS** (the worst case).

**Status: validated locally, not yet deployed or verified on staging.** The emulation covers SQL and RLS semantics, not the PostgREST, GoTrue, Storage or Realtime servers.

| ID | Finding | Fix | Evidence |
|---|---|---|---|
| R1 | `FORCE ROW LEVEL SECURITY` bound the table owner, which the SECURITY DEFINER code runs as. **Reproduced:** migration 0003 (template seed) failed, and the sign-up trigger could not insert profiles | FORCE removed in 0002 (never applied anywhere) and re-asserted in 0005; client roles are never owners | `migrations.db.test.ts` (FORCE re-applied → sign-up fails) |
| R2 | The `auth.users` trigger runs in schema `app` after function execute was revoked | Explicit `usage`/`execute` for `supabase_auth_admin`; direct calls by users denied | Sign-up as `supabase_auth_admin` creates a profile |
| S1 | Membership UPDATE checked only the new row, so an **admin could demote or remove the owner** | USING and WITH CHECK both require `can_manage_owners` for owner rows | `rls.db.test.ts` S1 |
| S2 | `invitations` was `for all` with no role cap, so an **admin could invite themselves as owner** | Direct insert/delete revoked. `create_invitation` / `preview_invitation` / `accept_invitation` RPCs store a SHA-256 token hash and require the **verified** auth email (not profile data) | Invitations suite |
| S3 | `brand_id` and `brands.agency_id`/`slug` were updatable, so rows could move between brands | `prevent_tenant_change` trigger on all 25 brand tables; column-level UPDATE grants | brand_id immutability test |
| S4 | Users could change their own `profiles.email` | Only `name` is updatable | S4 test |
| S5 | Users could insert messages carrying fake agent proposals or executions, or tasks claiming agent authorship | Tightened insert checks; authorship columns are not updatable | S5 and task tests |
| S6 | `anon` held Supabase's default table grants | All table privileges revoked from `anon`; default privileges too | anon gets 42501 on every table |
| S7 | Storage cast `::uuid` raised on bad paths; buckets had no limits | `app.try_uuid`; 1 MB / 20 MB limits and MIME allow-lists | Storage suite |
| S8 | No account deactivation | `profiles.deactivated_at`, checked inside every helper (including own-membership reads) | Deactivation test |
| — | Approvals could be self-approved, re-decided, or recorded under another decider | Mirrors `work.ts`: admins decide only pending rows, never their own, as themselves; requesters may cancel | Approvals suite |

**Mutation check:** with `PG_MIGRATION_SKIP=security_hardening`, 18 of the 34 RLS tests fail. So the suite detects each fix being absent, and isn't passing vacuously.

**Still open (needs staging):**
- Run the same matrix through PostgREST with real JWTs.
- Storage API upload, download and signed URLs.
- Realtime delivery filtering per subscriber.
- Auth email flows (confirmation, recovery, invitation emails).
- Rate limits.
- `pgvector`.

**Staging update (2026-11-02):** migrations 0001–0005 are applied to `ppwkxlwxzutigepaizob`. The same RLS checks passed **on staging** (38/38, rollback-only). Correction to R1: on Supabase, `postgres` has BYPASSRLS, so FORCE would not have broken staging. The fix is kept because it is correct on any Postgres. The Supabase advisors report 0 errors; their warnings are handled by migration 0006 (prepared, awaiting approval). The invitation RPCs being executable by `authenticated` is accepted by design.

# Security Review: AI provider connection manager (2026-11-02, local)
Scope: migration 0007, the shared AI runtime, the two Edge Functions (not deployed) and the settings UI. See AI_CREDENTIAL_SECURITY.md.

**Controls**
- No credential storage: slot names only, with an allow-list that must match the provider.
- Credentials reach fixed provider origins only, and redirects are refused.
- Errors are sanitized.
- Status, verification, usage, health and audit columns are server-written only.
- Agency staff manage connections; brand admins assign.
- Brand and agency isolation for connections, assignments, usage and audit.
- Cross-provider fallback needs both organization and brand consent.
- The tool gateway re-authorizes every call, and web or knowledge content is wrapped as untrusted.
- SEO fetches are limited to brand hosts and go through `safeFetch` (SSRF).
- Per-user rate limit, idempotency, and team-round bounds.

**Accepted or residual risks**
- `ai_usage_events` aggregation for budgets runs in the function: up to 50k rows per agency per month are read. Move it to SQL views before heavy use.
- Budget checks are not atomic across concurrent requests, so parallel turns can overshoot by at most one request each. Provider-side limits remain the hard stop.
- DNS rebinding in Edge Functions (see SEO_EXECUTION_SECURITY.md).
- `Deno.resolveDns` availability on the Supabase Edge runtime is unverified. If it fails, SEO fetches are refused (fail closed).

**Not yet verified**
- PostgREST behaviour of the 0007 policies on staging.
- Deployed function auth.
- Any live provider response.

# Security Review: agency/client/website hierarchy (2026-11-05, local)
- Isolation reuses the brand-level RLS (client = brand). Migration 0008 adds only tighter or additive rules:
  - per-agency client slugs;
  - client creation by agency owners/admins through `create_client`;
  - agency status changes by platform admins only (trigger);
  - an `agency_manager` role that can write but not administer;
  - website URL normalization that rejects credentials and non-http(s) schemes;
  - conversation website scope guarded to the same client.
- `is_agency_admin` was narrowed to owner/admin roles. This is behaviour-preserving, because those were the only agency roles before 0008.
- AI credential and organization-policy management (0007, unapplied) is limited to agency owners/admins.
- Platform admins get the directory and counts only, with no client data access by that role.
- SEO fetches are limited to active websites that have a URL, and to the scoped website when set.
- Verified locally by PGlite negative tests: cross-agency and cross-client reads and writes; manipulated brand, client and website ids; manager escalation; job-function escalation.
- Not yet verified on staging (approval pending).
