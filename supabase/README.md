# Supabase (prepared, not connected)

These migrations are **not applied** to any Supabase project. Connecting is Phase 17 and needs the owner's authorization. See `docs/development/SUPABASE_INTEGRATION_PLAN.md`.

- `migrations/20261025000001_schema.sql`: tables, constraints, indexes, triggers.
- `migrations/20261025000002_rls.sql`: RLS helper functions, policies, storage buckets.
- `migrations/20261025000003_agent_templates.sql`: global agent template seed (generated; `npm run gen:sql`).
- `migrations/20261102000004_realtime.sql`: adds chat, execution and approval tables to the Realtime publication.

Staging setup steps and the risks to check first: `docs/development/PHASE17_STAGING_RUNBOOK.md`.

The RLS helpers mirror `apps/adpost-web/src/data/access.ts`. Change both together.

The SQL has been parse-checked (Postgres 18 parser) but not executed against Postgres yet. Expect fixes when it first runs in a staging project.
