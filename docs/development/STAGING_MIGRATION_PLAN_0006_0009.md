# Staging Migration Plan: 0006–0009 (milestones O–Q)

**Status:** reviewed, **awaiting explicit owner approval**. Nothing in this plan has been applied.
**Target:** `adpost-staging` (`ppwkxlwxzutigepaizob`) only. Production is out of scope.
**Tool:** Supabase CLI 2.121.0, already linked.

## 1. What would be applied (verified by dry run, 2026-11-13)
`npx supabase@2.121.0 db push --dry-run` reports exactly these, with **no seeds** and **no roles**:

| Migration | Lines | Purpose |
|---|---|---|
| `20261102000006_advisor_fixes.sql` | 56 | Splits five `FOR ALL` write policies (Supabase advisor warnings) |
| `20261102000007_ai_providers.sql` | 491 | AI provider connections, models, routing, usage/budgets (secret *references* only) |
| `20261105000008_agency_client_website.sql` | 324 | Agencies → clients (brands) → websites hierarchy, provisioning RPCs |
| `20261113000009_roles_access.sql` | 446 | Super Admin / Admin / Client User model, visibility scopes, invitations, audit, bootstrap |

The dev sample seed (`supabase/seeds/dev/sample_hierarchy.sql`) is **not** part of this push. Seeding staging would be a separate decision.

## 2. Review findings
- **No data-destroying statements:** no `drop table`, `drop column`, `truncate` or row deletes in migration bodies.
  - The deletes and updates that do appear are inside RPC bodies.
  - The only top-level updates backfill `archived_at` for rows already archived.
- **Dropped and recreated objects:**
  - policies are recreated in the same migration;
  - check constraints are replaced by wider ones;
  - `brands_slug_key` becomes per-agency `(agency_id, slug)`;
  - `create_invitation(uuid,text,text,uuid)` becomes a 5-argument version. Nothing deployed calls the old signature: the UI still uses the local adapter.
- **New constraints that existing rows must satisfy** (risk if staging has non-conforming rows):
  - agency and brand slug format;
  - website URL and domain format;
  - archived/status consistency;
  - one primary website per client.
- **Privilege changes:**
  - `insert/update/delete` on `agency_memberships` is revoked from `authenticated`;
  - `bootstrap_super_admin` is not executable by app users;
  - `platform_audit_events` is read-only to Super Admins.
- **Validation so far:** all four migrations apply cleanly on PGlite (Postgres 17) on top of 0001–0005, with 100 DB tests. That is local, not staging.

## 3. Procedure (after approval)
1. **Backup** (local, git-ignored `*.dump`):
   ```
   npx supabase@2.121.0 db dump --linked -f staging-before-0006.dump
   npx supabase@2.121.0 db dump --linked --data-only -f staging-data-before-0006.dump
   ```
2. **Pre-flight read-only checks** in the SQL editor. Each must return 0 rows:
   ```sql
   select id, slug from public.brands where slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(slug) > 64;
   select id, slug from public.agencies where slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
   select id, website_url, domain from public.websites;   -- inspect vs. the new URL/domain checks
   select id, status, archived_at from public.brands where (status = 'archived') <> (archived_at is not null);
   ```
   If any row fails, stop and report it. Do not edit data without approval.
3. **Apply:** `npx supabase@2.121.0 db push` (applies 0006 → 0009 in order; each in its own transaction).
4. **Verify:**
   - `migration list --linked` shows 0001–0009 remote.
   - Run the Supabase security and performance advisors.
   - Run the staging RLS checks of `RLS_ROLE_TEST_MATRIX.md` with dedicated test users (`*.example.test` addresses). Those users need the owner's approval, as before.
5. **Record:** update SESSION_HANDOFF, TEST_RESULTS and GITHUB_SYNC_LOG. Commit and push docs only.

## 4. Not included (separate approvals)
- First Super Admin bootstrap (`select app.bootstrap_super_admin('<email>')`). The owner runs it, or approves it explicitly.
- Deploying `agent-execute`, `ai-connection-test` or `user-invite` Edge Functions; setting `ALLOWED_ORIGINS`; SMTP.
- Seeding the sample hierarchy or demo websites on staging.
- Any provider API keys or paid AI usage.
- Netlify, `main`, production.

## 5. Rollback
- Supabase migrations are forward-only. The rollback path is a **forward fix migration**.
- In an emergency, restore from the step 1 dump. A restore is destructive and needs its own approval.
- **No remote reset is ever run.**

## 6. Approval requested
Reply with one of:
- **"Approve 0006–0009 on staging"**: steps 1–5 above.
- **"Approve 0006–0008 only"**: the 0009 role model is deferred. `db push` has no target-version option, so 0009 would be moved out of the folder for that push only, and a dry run would confirm exactly 0006–0008.
- **Hold.**

## 7. Precheck results (2026-11-13, read-only)
- Git: branch clean, local = remote = `23af499`. Linked project ref: `ppwkxlwxzutigepaizob`.
- `migration list --linked`: remote 0001–0005; local-only 0006–0009. `db push --dry-run`: exactly 0006–0009, no seeds, no roles.
- Exact row counts (single read-only SELECT through `db query --linked`):
  - `agent_templates` = 6 (from 0003; not modified by 0006–0009).
  - **Every other table checked = 0:** auth.users, profiles, agencies, agency_memberships, brands, brand_memberships, clients, websites, invitations, conversations, messages, agent_instances, projects, tasks, audit_logs, integrations, storage.objects.
- Constraint compatibility:
  - 0 bad slugs and 0 bad names.
  - No websites, so the new URL, domain and primary rules have nothing to violate.
- 31 public tables, all with RLS. None of the 0007–0009 tables exist yet.
- Extensions: pgcrypto (`extensions`) and supabase_vault are present. 0009 uses only `extensions.digest` / `extensions.gen_random_bytes`.
- Backup: there is no user data to preserve. `db dump` needs Docker, which is not installed on this machine. Recovery is by forward-fix migration; the 6 templates are re-creatable from 0003. No remote reset.
- Local: 100/100 DB tests pass (migrations 0001–0009 on PGlite).
