-- Phase 17 security hardening (review 2026-11-02). Additive: earlier migrations are unchanged.
-- Verified against real Postgres (PGlite) by apps/adpost-web/src/test/db/rls.db.test.ts,
-- including the worst case where the migration role does NOT have BYPASSRLS.

-- ── R1: no FORCE RLS ───────────────────────────────────────────────────────
-- Fixed at the source in 20261025000002_rls.sql (see the note there). This
-- re-asserts it for any table added since, and is a no-op otherwise.
do $$
declare t text;
begin
    for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I no force row level security', t);
    end loop;
end $$;

-- ── S8: deactivated accounts lose all access ───────────────────────────────
alter table public.profiles add column deactivated_at timestamptz;

create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
    select coalesce((select p.deactivated_at is null from public.profiles p where p.id = auth.uid()), false);
$$;

-- Every access helper derives from these three, so the deactivation check reaches all of them.
create or replace function app.is_agency_staff_for_agency(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (
        select 1 from public.agency_memberships am
        where am.agency_id = p_agency_id and am.user_id = auth.uid()
    );
$$;

create or replace function app.is_agency_admin(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (
        select 1 from public.brands b
        join public.agency_memberships am on am.agency_id = b.agency_id
        where b.id = p_brand_id and am.user_id = auth.uid()
    );
$$;

create or replace function app.brand_role(p_brand_id uuid) returns text
language sql stable security definer set search_path = '' as $$
    select bm.role from public.brand_memberships bm
    where bm.brand_id = p_brand_id and bm.user_id = auth.uid() and app.is_active_user();
$$;

/** Can the caller grant, change or remove the 'owner' role in this brand? */
create or replace function app.can_manage_owners(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or coalesce(app.brand_role(p_brand_id) = 'owner', false);
$$;

/** NULL instead of an error for malformed ids (storage paths). */
create or replace function app.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
    return p::uuid;
exception when others then
    return null;
end $$;

-- ── R2: profile bootstrap trigger ──────────────────────────────────────────
-- Only the display name comes from user-editable metadata, and it grants nothing.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into public.profiles (id, name, email)
    values (
        new.id,
        left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 120),
        lower(new.email)
    );
    return new;
end $$;

revoke all on all functions in schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on function app.handle_new_user() from authenticated;
grant usage on schema app to supabase_auth_admin;
grant execute on function app.handle_new_user() to supabase_auth_admin;

-- ── S6: anon gets no table access at all (defence in depth over RLS) ──────
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ── S3: tenancy columns are immutable ──────────────────────────────────────
create or replace function app.prevent_tenant_change() returns trigger
language plpgsql set search_path = '' as $$
begin
    if new.brand_id is distinct from old.brand_id then
        raise exception 'brand_id cannot be changed' using errcode = '42501';
    end if;
    return new;
end $$;

do $$
declare t text;
begin
    for t in select c.table_name from information_schema.columns c
             join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
             where c.table_schema = 'public' and c.column_name = 'brand_id' loop
        execute format('create trigger %I_tenant_lock before update on public.%I for each row execute function app.prevent_tenant_change()', t, t);
    end loop;
end $$;

-- Column-level UPDATE grants: users may change only the fields the UI edits.
revoke update on public.brands from authenticated;
grant update (name, status, description, timezone, currency, color) on public.brands to authenticated;

-- S4: profile email/deactivation are not self-editable.
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

revoke update on public.brand_memberships from authenticated;
grant update (role, client_id, department) on public.brand_memberships to authenticated;

revoke update on public.approval_requests from authenticated;
grant update (status, decided_by, decided_at, decision_note) on public.approval_requests to authenticated;

revoke update on public.messages from authenticated;

-- Deactivated users cannot read even their own membership rows.
drop policy brand_memberships_select on public.brand_memberships;
create policy brand_memberships_select on public.brand_memberships for select to authenticated
    using ((user_id = auth.uid() and app.is_active_user()) or app.is_brand_staff(brand_id));
drop policy agency_memberships_select on public.agency_memberships;
create policy agency_memberships_select on public.agency_memberships for select to authenticated
    using ((user_id = auth.uid() and app.is_active_user()) or app.is_agency_staff_for_agency(agency_id));

-- ── S1: admins cannot touch the owner role ─────────────────────────────────
drop policy brand_memberships_insert on public.brand_memberships;
drop policy brand_memberships_update on public.brand_memberships;
drop policy brand_memberships_delete on public.brand_memberships;

create policy brand_memberships_insert on public.brand_memberships for insert to authenticated
    with check (app.can_admin_brand(brand_id) and (role <> 'owner' or app.can_manage_owners(brand_id))
        and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.brand_id = brand_memberships.brand_id)));
create policy brand_memberships_update on public.brand_memberships for update to authenticated
    using (app.can_admin_brand(brand_id) and (role <> 'owner' or app.can_manage_owners(brand_id)))
    with check (app.can_admin_brand(brand_id) and (role <> 'owner' or app.can_manage_owners(brand_id))
        and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.brand_id = brand_memberships.brand_id)));
create policy brand_memberships_delete on public.brand_memberships for delete to authenticated
    using (app.can_admin_brand(brand_id) and (role <> 'owner' or app.can_manage_owners(brand_id)));

-- ── S2: invitations are created and accepted only through the RPCs below ──
drop policy invitations_admin on public.invitations;
create policy invitations_select on public.invitations for select to authenticated using (app.can_admin_brand(brand_id));
-- Admins cancel pending invitations; nothing else is updatable directly.
create policy invitations_cancel on public.invitations for update to authenticated
    using (app.can_admin_brand(brand_id) and status = 'pending')
    with check (app.can_admin_brand(brand_id) and status = 'cancelled');
revoke insert, delete on public.invitations from authenticated;
revoke update on public.invitations from authenticated;
grant update (status) on public.invitations to authenticated;

/** Admin creates an invitation; returns the raw token ONCE (only its hash is stored). */
create or replace function public.create_invitation(p_brand_id uuid, p_email text, p_role text, p_client_id uuid default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
    v_email text := lower(trim(p_email));
    v_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_id uuid;
    v_expires timestamptz := now() + interval '7 days';
begin
    if not app.can_admin_brand(p_brand_id) then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_role not in ('owner', 'admin', 'manager', 'member', 'viewer', 'client') then
        raise exception 'invalid role' using errcode = '22023';
    end if;
    if p_role = 'owner' and not app.can_manage_owners(p_brand_id) then
        raise exception 'only owners can invite owners' using errcode = '42501';
    end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'invalid email' using errcode = '22023';
    end if;
    if (p_role = 'client') <> (p_client_id is not null)
       or (p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id and c.brand_id = p_brand_id)) then
        raise exception 'client invitations must name a client of this brand' using errcode = '22023';
    end if;
    if exists (select 1 from public.brand_memberships bm join public.profiles p on p.id = bm.user_id
               where bm.brand_id = p_brand_id and p.email = v_email) then
        raise exception 'already a member' using errcode = '23505';
    end if;
    insert into public.invitations (brand_id, email, role, client_id, invited_by, token_hash, expires_at)
    values (p_brand_id, v_email, p_role, p_client_id, auth.uid(), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires)
    returning id into v_id;
    insert into public.audit_logs (brand_id, actor_id, action, subject_type, subject_id)
    values (p_brand_id, auth.uid(), 'invitation.sent', 'invitation', v_id);
    return query select v_id, v_token, v_expires;
end $$;

/** Signed-in user previews an invitation by token (needed before accepting). */
create or replace function public.preview_invitation(p_token text)
returns table (brand_name text, brand_slug text, role text, email text, status text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
    select b.name, b.slug, i.role, i.email,
           case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
           i.expires_at
    from public.invitations i join public.brands b on b.id = i.brand_id
    where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and auth.uid() is not null;
$$;

/** Accept: the invitation email must equal the caller's VERIFIED auth email (never profile data). */
create or replace function public.accept_invitation(p_token text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
    inv public.invitations;
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if auth.uid() is null or not app.is_active_user() then
        raise exception 'not signed in' using errcode = '42501';
    end if;
    select * into inv from public.invitations
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
    if not found then
        raise exception 'invitation not found' using errcode = 'P0002';
    end if;
    if inv.status <> 'pending' or inv.expires_at < now() then
        raise exception 'invitation is %', case when inv.status = 'pending' then 'expired' else inv.status end using errcode = '22023';
    end if;
    if v_email = '' or v_email <> inv.email
       or not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
        raise exception 'invitation was sent to a different email address' using errcode = '42501';
    end if;
    insert into public.brand_memberships (brand_id, user_id, role, client_id)
    values (inv.brand_id, auth.uid(), inv.role, inv.client_id)
    on conflict (brand_id, user_id) do nothing;
    update public.invitations set status = 'accepted' where id = inv.id;
    insert into public.audit_logs (brand_id, actor_id, action, subject_type, subject_id)
    values (inv.brand_id, auth.uid(), 'invitation.accepted', 'invitation', inv.id);
    return (select slug from public.brands where id = inv.brand_id);
end $$;

revoke execute on function public.create_invitation(uuid, text, text, uuid) from public, anon;
revoke execute on function public.preview_invitation(text) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.create_invitation(uuid, text, text, uuid) to authenticated;
grant execute on function public.preview_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;

-- ── S5: users cannot forge agent output in messages ────────────────────────
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
    with check (app.can_write_brand(brand_id) and author_type = 'user' and author_user_id = auth.uid()
        and author_agent_id is null and execution_id is null and mode is null and proposals = '[]'::jsonb
        and exists (select 1 from public.conversations c where c.id = conversation_id and c.brand_id = messages.brand_id));

-- Tasks: a user-created task names its creator; an agent-attributed task must come from an
-- agent message (applying a proposal) in the same brand.
drop policy tasks_write on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.projects p where p.id = project_id and p.brand_id = tasks.brand_id)
        and ((created_by_type = 'user' and created_by_id = auth.uid())
             or (created_by_type = 'agent' and exists (select 1 from public.messages m
                 where m.id = source_message_id and m.brand_id = tasks.brand_id and m.author_type = 'agent'))));
create policy tasks_update on public.tasks for update to authenticated
    using (app.can_write_brand(brand_id))
    with check (app.can_write_brand(brand_id)
        and exists (select 1 from public.projects p where p.id = project_id and p.brand_id = tasks.brand_id));
create policy tasks_delete on public.tasks for delete to authenticated using (app.can_write_brand(brand_id));
-- Authorship columns are fixed after insert (column grants; a table-level grant would cover every column).
revoke update on public.tasks from authenticated;
grant update (project_id, title, description, status, priority, assignee_user_id, assignee_agent_id, due_date) on public.tasks to authenticated;
revoke update on public.conversations from authenticated;
grant update (title, archived, summary) on public.conversations to authenticated;

-- ── Approvals: same rules as the local adapter (work.ts) ───────────────────
drop policy approvals_insert on public.approval_requests;
drop policy approvals_decide on public.approval_requests;
create policy approvals_insert on public.approval_requests for insert to authenticated
    with check (app.can_write_brand(brand_id) and status = 'pending'
        and decided_by is null and decided_at is null and decision_note is null
        and ((requested_by_type = 'user' and requested_by_id = auth.uid())
             or (requested_by_type = 'agent' and execution_id is not null
                 and exists (select 1 from public.agent_executions e where e.id = execution_id and e.brand_id = approval_requests.brand_id))));
-- Old row must be pending. Admins decide; the requester or an admin may cancel.
create policy approvals_update on public.approval_requests for update to authenticated
    using (status = 'pending' and (app.can_admin_brand(brand_id)
        or (app.can_write_brand(brand_id) and requested_by_type = 'user' and requested_by_id = auth.uid())))
    with check (decided_by = auth.uid() and (
        status = 'cancelled'
        or (status in ('approved', 'rejected') and app.can_admin_brand(brand_id)
            and not (requested_by_type = 'user' and requested_by_id = auth.uid()))));

-- ── S7: storage ────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = 1048576,
    allowed_mime_types = array['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf']
where id = 'brand-knowledge';
update storage.buckets set file_size_limit = 20971520, allowed_mime_types = array['text/csv', 'application/pdf']
where id = 'report-exports';

drop policy knowledge_objects_read on storage.objects;
drop policy knowledge_objects_write on storage.objects;
drop policy knowledge_objects_delete on storage.objects;
create policy knowledge_objects_read on storage.objects for select to authenticated
    using (bucket_id = 'brand-knowledge' and app.is_brand_staff(app.try_uuid((storage.foldername(name))[1])));
create policy knowledge_objects_write on storage.objects for insert to authenticated
    with check (bucket_id = 'brand-knowledge' and app.can_write_brand(app.try_uuid((storage.foldername(name))[1])));
create policy knowledge_objects_delete on storage.objects for delete to authenticated
    using (bucket_id = 'brand-knowledge' and app.can_write_brand(app.try_uuid((storage.foldername(name))[1])));
