-- Realtime (SUPABASE_INTEGRATION_PLAN.md §5). PREPARED ONLY; not applied.
-- postgres_changes delivers a row only to subscribers whose SELECT policy allows it,
-- so these channels inherit the brand isolation defined in 20261025000002_rls.sql.
-- Clients subscribe with a brand filter, e.g. `brand_id=eq.<uuid>`, to keep traffic small.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.agent_executions;
alter publication supabase_realtime add table public.approval_requests;
