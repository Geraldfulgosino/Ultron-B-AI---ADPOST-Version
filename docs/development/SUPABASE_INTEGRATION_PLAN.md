# Supabase Integration Plan

Status: **prepared locally, not connected** (B-002). Nothing here has been validated against a live project.

## 1. Schema (Postgres) — `supabase/migrations/`
Core: `agencies`, `brands`, `profiles` (1:1 `auth.users`), `agency_memberships`, `brand_memberships`, `invitations`.
Legacy parity: `clients`, `websites`, `integrations` (credentials in Vault / server-only column), `analytics_daily_metrics`, `analytics_search_queries`, `analytics_landing_pages`, `seo_insights`, `reports`, `n8n_connections`, `n8n_deliveries`, `audit_logs`.
AI: `agent_templates` (global, read-only to users), `agent_instances`, `agent_instruction_versions`, `conversations`, `conversation_participants`, `messages`, `agent_executions` (tokens, cost, mode, status).
Work: `projects`, `tasks`, `approval_requests`.
Knowledge: `knowledge_documents`, `knowledge_chunks` (`pgvector` embedding, Phase 13).

Every brand-owned table has: `id uuid pk`, `brand_id uuid not null references brands on delete cascade`, `created_at`, `updated_at`, an index on `(brand_id, …)`.

## 2. RLS model
Helper functions (`security definer`, `stable`, `search_path = ''`):
- `app.is_agency_admin(brand_id)`: the user holds an agency role on the brand's agency.
- `app.brand_role(brand_id) → text`: the user's role in the brand, or null.
- `app.can_read_brand(brand_id)`: `brand_role is not null or is_agency_admin`.
- `app.can_write_brand(brand_id)`: role in (`owner`,`admin`,`manager`,`member`) or agency admin.
- `app.can_admin_brand(brand_id)`: role in (`owner`,`admin`) or agency admin.

Policy pattern per brand-owned table: `select using (app.can_read_brand(brand_id))`, `insert/update with check (app.can_write_brand(brand_id))`, `delete using (app.can_admin_brand(brand_id))`. `client` role reads are restricted further to rows linked to its `client_id`.
These rules are mirrored 1:1 by `apps/adpost-web/src/data/access.ts` (ADR-003). Change both together.

## 3. Storage
Bucket `brand-knowledge` (private). Path `{brand_id}/{document_id}/{filename}`. Policy: `app.can_read_brand((storage.foldername(name))[1]::uuid)`.
Bucket `report-exports` (private, signed URLs, 24 h expiry).

## 4. Edge Functions (contracts)
| Function | Input | Notes |
|----------|-------|-------|
| `agent-execute` | `{ conversationId, agentInstanceId, messageId }` | Holds LLM keys; enforces limits; writes `agent_executions` |
| `orchestrate-group` | `{ conversationId, messageId }` | Bounded loop per ADR-008 |
| `ga4-sync` / `gsc-sync` | `{ integrationId }` | Ports Laravel sync jobs; queued via `pg_cron`/queue |
| `report-export` | `{ brandId, filters, format: csv|pdf }` | Writes to `report-exports` bucket |
| `n8n-dispatch` | `{ connectionId, event }` | Signed webhooks; never called from browser |

## 5. Realtime
Channels: `messages:brand_id=eq.{id}` (chat), `agent_executions` status, `approval_requests`. Realtime respects RLS.

## 6. Auth
Email/password plus magic link at first. `profiles` row created by trigger on `auth.users` insert. Invitations accepted via an Edge Function that checks the email matches.

## 7. Phase 17 cut-over checklist (requires authorization)
1. Create the project and apply migrations to a **staging** project only.
2. Run the RLS test plan (§8) with real JWTs for 2 brands × each role.
3. Implement Supabase adapters against the existing contracts. Run the same contract test suite against them.
4. Data migration script MySQL → Postgres (organizations → brands) on a copy, never production.
5. Owner sign-off before any production data move.

## 8. RLS security test plan
For each brand-owned table: user in brand A cannot select, insert, update or delete brand B rows. A `viewer` cannot write. A `client` sees only its own client's rows. An agency admin can read both brands. An anonymous user sees nothing. Storage: cross-brand path read is denied.
