# Supabase (prepared, not connected)

These migrations are **not applied** to any Supabase project. Connecting is Phase 17 and needs the owner's authorization. See `docs/development/SUPABASE_INTEGRATION_PLAN.md`.

- `migrations/20261025000001_schema.sql`: tables, constraints, indexes, triggers.
- `migrations/20261025000002_rls.sql`: RLS helper functions, policies, storage buckets.

The RLS helpers mirror `apps/adpost-web/src/data/access.ts`. Change both together.

The SQL has not been executed against Postgres yet. Expect fixes when it first runs in a staging project.
