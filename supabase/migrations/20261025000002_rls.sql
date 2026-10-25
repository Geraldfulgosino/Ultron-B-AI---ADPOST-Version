-- Row Level Security. PREPARED ONLY; unverified until Phase 17.
-- Mirrors apps/adpost-web/src/data/access.ts. Change both together.

-- ── Helper functions ───────────────────────────────────────────────────────

create or replace function app.is_agency_staff_for_agency(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.agency_memberships am
        where am.agency_id = p_agency_id and am.user_id = auth.uid()
    );
$$;

create or replace function app.is_agency_admin(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.brands b
        join public.agency_memberships am on am.agency_id = b.agency_id
        where b.id = p_brand_id and am.user_id = auth.uid()
    );
$$;

create or replace function app.brand_role(p_brand_id uuid) returns text
language sql stable security definer set search_path = '' as $$
    select bm.role from public.brand_memberships bm
    where bm.brand_id = p_brand_id and bm.user_id = auth.uid();
$$;

create or replace function app.client_scope(p_brand_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
    select bm.client_id from public.brand_memberships bm
    where bm.brand_id = p_brand_id and bm.user_id = auth.uid() and bm.role = 'client';
$$;

create or replace function app.can_read_brand(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or app.brand_role(p_brand_id) is not null;
$$;

create or replace function app.is_brand_staff(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or coalesce(app.brand_role(p_brand_id) <> 'client', false);
$$;

create or replace function app.can_write_brand(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id)
        or coalesce(app.brand_role(p_brand_id) in ('owner', 'admin', 'manager', 'member'), false);
$$;

create or replace function app.can_admin_brand(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or coalesce(app.brand_role(p_brand_id) in ('owner', 'admin'), false);
$$;

/** Client-scoped read: staff see all brand rows; client users see only their client's rows. */
create or replace function app.can_read_client_row(p_brand_id uuid, p_client_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_brand_staff(p_brand_id)
        or (app.brand_role(p_brand_id) = 'client' and app.client_scope(p_brand_id) = p_client_id);
$$;

revoke all on all functions in schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- ── Enable RLS everywhere ──────────────────────────────────────────────────

do $$
declare t text;
begin
    for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I enable row level security', t);
        execute format('alter table public.%I force row level security', t);
    end loop;
end $$;

-- Secrets tables intentionally have NO policies: only the service role (Edge Functions) can touch them.
--   public.integration_secrets, public.n8n_connection_secrets

-- ── Tenancy ────────────────────────────────────────────────────────────────

create policy agencies_select on public.agencies for select to authenticated
    using (app.is_agency_staff_for_agency(id)
        or exists (select 1 from public.brands b where b.agency_id = agencies.id and app.can_read_brand(b.id)));

create policy brands_select on public.brands for select to authenticated using (app.can_read_brand(id));
create policy brands_insert on public.brands for insert to authenticated with check (app.is_agency_staff_for_agency(agency_id));
create policy brands_update on public.brands for update to authenticated using (app.can_admin_brand(id)) with check (app.can_admin_brand(id));

create policy profiles_select on public.profiles for select to authenticated
    using (id = auth.uid() or exists (
        select 1 from public.brand_memberships mine
        join public.brand_memberships theirs on theirs.brand_id = mine.brand_id
        where mine.user_id = auth.uid() and theirs.user_id = profiles.id and app.is_brand_staff(mine.brand_id)
    ));
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy agency_memberships_select on public.agency_memberships for select to authenticated
    using (user_id = auth.uid() or app.is_agency_staff_for_agency(agency_id));

create policy brand_memberships_select on public.brand_memberships for select to authenticated
    using (user_id = auth.uid() or app.is_brand_staff(brand_id));
-- Admins manage members, but only owners/agency staff may grant or hold-change the owner role.
create policy brand_memberships_insert on public.brand_memberships for insert to authenticated
    with check (app.can_admin_brand(brand_id) and (role <> 'owner' or app.brand_role(brand_id) = 'owner' or app.is_agency_admin(brand_id)));
create policy brand_memberships_update on public.brand_memberships for update to authenticated
    using (app.can_admin_brand(brand_id))
    with check (app.can_admin_brand(brand_id) and (role <> 'owner' or app.brand_role(brand_id) = 'owner' or app.is_agency_admin(brand_id)));
create policy brand_memberships_delete on public.brand_memberships for delete to authenticated
    using (app.can_admin_brand(brand_id) and (role <> 'owner' or app.brand_role(brand_id) = 'owner' or app.is_agency_admin(brand_id)));

create policy invitations_admin on public.invitations for all to authenticated
    using (app.can_admin_brand(brand_id)) with check (app.can_admin_brand(brand_id));

-- ── Client-scoped tables ───────────────────────────────────────────────────

create policy clients_select on public.clients for select to authenticated using (app.can_read_client_row(brand_id, id));
create policy clients_insert on public.clients for insert to authenticated with check (app.can_write_brand(brand_id));
create policy clients_update on public.clients for update to authenticated using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));
create policy clients_delete on public.clients for delete to authenticated using (app.can_admin_brand(brand_id));

create policy websites_select on public.websites for select to authenticated using (app.can_read_client_row(brand_id, client_id));
create policy websites_insert on public.websites for insert to authenticated
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.clients c where c.id = client_id and c.brand_id = websites.brand_id));
create policy websites_update on public.websites for update to authenticated
    using (app.can_write_brand(brand_id))
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.clients c where c.id = client_id and c.brand_id = websites.brand_id));
create policy websites_delete on public.websites for delete to authenticated using (app.can_admin_brand(brand_id));

-- Integrations: readable per client scope; created/updated only by Edge Functions (OAuth), deletable by admins.
create policy integrations_select on public.integrations for select to authenticated using (app.can_read_client_row(brand_id, client_id));
create policy integrations_delete on public.integrations for delete to authenticated using (app.can_admin_brand(brand_id));

-- Analytics: read-only for users; written by sync Edge Functions with the service role.
create policy analytics_daily_select on public.analytics_daily_metrics for select to authenticated using (app.can_read_client_row(brand_id, client_id));
create policy analytics_queries_select on public.analytics_search_queries for select to authenticated using (app.can_read_client_row(brand_id, client_id));
create policy analytics_pages_select on public.analytics_landing_pages for select to authenticated using (app.can_read_client_row(brand_id, client_id));

create policy seo_insights_select on public.seo_insights for select to authenticated using (app.can_read_client_row(brand_id, client_id));
create policy seo_insights_insert on public.seo_insights for insert to authenticated with check (app.can_write_brand(brand_id));
create policy seo_insights_update on public.seo_insights for update to authenticated using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));

-- ── Staff-only tables ──────────────────────────────────────────────────────

create policy n8n_connections_select on public.n8n_connections for select to authenticated using (app.can_admin_brand(brand_id));
create policy n8n_connections_write on public.n8n_connections for all to authenticated
    using (app.can_admin_brand(brand_id)) with check (app.can_admin_brand(brand_id));
create policy n8n_deliveries_select on public.n8n_deliveries for select to authenticated using (app.can_admin_brand(brand_id));
create policy n8n_deliveries_delete on public.n8n_deliveries for delete to authenticated using (app.can_admin_brand(brand_id));

create policy audit_logs_select on public.audit_logs for select to authenticated using (app.can_admin_brand(brand_id));

create policy agent_templates_select on public.agent_templates for select to authenticated using (true);

create policy agent_instances_select on public.agent_instances for select to authenticated using (app.is_brand_staff(brand_id));
create policy agent_instances_write on public.agent_instances for all to authenticated
    using (app.can_admin_brand(brand_id)) with check (app.can_admin_brand(brand_id));

create policy instruction_versions_select on public.agent_instruction_versions for select to authenticated using (app.is_brand_staff(brand_id));
create policy instruction_versions_insert on public.agent_instruction_versions for insert to authenticated
    with check (app.can_admin_brand(brand_id) and created_by = auth.uid());

create policy conversations_select on public.conversations for select to authenticated using (app.is_brand_staff(brand_id));
create policy conversations_insert on public.conversations for insert to authenticated
    with check (app.can_write_brand(brand_id) and created_by = auth.uid());
create policy conversations_update on public.conversations for update to authenticated
    using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));

create policy messages_select on public.messages for select to authenticated using (app.is_brand_staff(brand_id));
-- Users may only author messages as themselves; agent/system messages come from Edge Functions.
create policy messages_insert on public.messages for insert to authenticated
    with check (app.can_write_brand(brand_id) and author_type = 'user' and author_user_id = auth.uid()
        and exists (select 1 from public.conversations c where c.id = conversation_id and c.brand_id = messages.brand_id));

create policy executions_select on public.agent_executions for select to authenticated using (app.is_brand_staff(brand_id));

create policy projects_select on public.projects for select to authenticated using (app.is_brand_staff(brand_id));
create policy projects_write on public.projects for all to authenticated
    using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));

create policy tasks_select on public.tasks for select to authenticated using (app.is_brand_staff(brand_id));
create policy tasks_write on public.tasks for all to authenticated
    using (app.can_write_brand(brand_id))
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.projects p where p.id = project_id and p.brand_id = tasks.brand_id));

create policy approvals_select on public.approval_requests for select to authenticated using (app.is_brand_staff(brand_id));
create policy approvals_insert on public.approval_requests for insert to authenticated
    with check (app.can_write_brand(brand_id) and status = 'pending');
-- Only admins decide, and they record themselves as the decider.
create policy approvals_decide on public.approval_requests for update to authenticated
    using (app.can_admin_brand(brand_id))
    with check (app.can_admin_brand(brand_id) and (decided_by is null or decided_by = auth.uid()));

create policy knowledge_documents_select on public.knowledge_documents for select to authenticated using (app.is_brand_staff(brand_id));
create policy knowledge_documents_write on public.knowledge_documents for all to authenticated
    using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));
create policy knowledge_chunks_select on public.knowledge_chunks for select to authenticated using (app.is_brand_staff(brand_id));

-- ── Storage ────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values ('brand-knowledge', 'brand-knowledge', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('report-exports', 'report-exports', false) on conflict do nothing;

create policy knowledge_objects_read on storage.objects for select to authenticated
    using (bucket_id = 'brand-knowledge' and app.is_brand_staff(((storage.foldername(name))[1])::uuid));
create policy knowledge_objects_write on storage.objects for insert to authenticated
    with check (bucket_id = 'brand-knowledge' and app.can_write_brand(((storage.foldername(name))[1])::uuid));
create policy knowledge_objects_delete on storage.objects for delete to authenticated
    using (bucket_id = 'brand-knowledge' and app.can_write_brand(((storage.foldername(name))[1])::uuid));
-- report-exports: written by the report-export Edge Function; read via signed URLs only (no select policy).
