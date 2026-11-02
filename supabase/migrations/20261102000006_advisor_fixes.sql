-- Supabase advisor fixes (staging advisors run 2026-11-02). No behaviour change intended;
-- the full RLS matrix (local + staging rollback-only) must pass unchanged.

-- function_search_path_mutable
alter function app.touch_updated_at() set search_path = '';

-- auth_rls_initplan: evaluate auth.uid() once per statement, not once per row.
do $$
declare p record; q text; c text;
begin
    for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
             where schemaname in ('public', 'storage')
               and (qual ~ 'auth\.uid\(\)' or with_check ~ 'auth\.uid\(\)') loop
        q := regexp_replace(p.qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
        c := regexp_replace(p.with_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
        if p.qual is not null and p.with_check is not null then
            execute format('alter policy %I on %I.%I using (%s) with check (%s)', p.policyname, p.schemaname, p.tablename, q, c);
        elsif p.qual is not null then
            execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q);
        else
            execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c);
        end if;
    end loop;
end $$;

-- multiple_permissive_policies: FOR ALL write policies overlapped the SELECT policy.
-- Split them per action with identical expressions; SELECT keeps its single policy.
drop policy agent_instances_write on public.agent_instances;
create policy agent_instances_insert on public.agent_instances for insert to authenticated with check (app.can_admin_brand(brand_id));
create policy agent_instances_update on public.agent_instances for update to authenticated using (app.can_admin_brand(brand_id)) with check (app.can_admin_brand(brand_id));
create policy agent_instances_delete on public.agent_instances for delete to authenticated using (app.can_admin_brand(brand_id));

drop policy knowledge_documents_write on public.knowledge_documents;
create policy knowledge_documents_insert on public.knowledge_documents for insert to authenticated with check (app.can_write_brand(brand_id));
create policy knowledge_documents_update on public.knowledge_documents for update to authenticated using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));
create policy knowledge_documents_delete on public.knowledge_documents for delete to authenticated using (app.can_write_brand(brand_id));

drop policy n8n_connections_write on public.n8n_connections;
create policy n8n_connections_insert on public.n8n_connections for insert to authenticated with check (app.can_admin_brand(brand_id));
create policy n8n_connections_update on public.n8n_connections for update to authenticated using (app.can_admin_brand(brand_id)) with check (app.can_admin_brand(brand_id));
create policy n8n_connections_delete on public.n8n_connections for delete to authenticated using (app.can_admin_brand(brand_id));

drop policy projects_write on public.projects;
create policy projects_insert on public.projects for insert to authenticated with check (app.can_write_brand(brand_id));
create policy projects_update on public.projects for update to authenticated using (app.can_write_brand(brand_id)) with check (app.can_write_brand(brand_id));
create policy projects_delete on public.projects for delete to authenticated using (app.can_write_brand(brand_id));

drop policy web_changes_write on public.web_changes;
create policy web_changes_insert on public.web_changes for insert to authenticated
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.websites w where w.id = website_id and w.brand_id = web_changes.brand_id));
create policy web_changes_update on public.web_changes for update to authenticated
    using (app.can_write_brand(brand_id))
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.websites w where w.id = website_id and w.brand_id = web_changes.brand_id));
create policy web_changes_delete on public.web_changes for delete to authenticated using (app.can_write_brand(brand_id));
