-- Three-role access model (master prompt v6.0): Super Admin, Admin, Client User.
-- PREPARED AND VALIDATED LOCALLY ONLY (PGlite). NOT applied to staging: needs owner approval.
-- Tests: apps/adpost-web/src/test/db/roles.db.test.ts
--
-- Stable role identifiers and their storage (no new identity tables; one auth user, many memberships):
--   super_admin  = row in public.platform_admins (granted only by a super admin or the one-time bootstrap)
--   admin        = public.agency_memberships.role in ('agency_owner', 'agency_admin')
--   client_user  = public.brand_memberships.role = 'client' (read-only by default; explicit permissions)
-- Agency staff below admin (agency_manager) and brand staff roles (owner..viewer) are unchanged.
-- Every helper re-reads membership, account and agency status on each query, so revocation,
-- suspension and deactivation apply immediately, regardless of any JWT a client still holds.

-- ── Agency suspension ──────────────────────────────────────────────────────
alter table public.agencies drop constraint agencies_status_check;
alter table public.agencies add constraint agencies_status_check check (status in ('active', 'inactive', 'suspended', 'archived'));
alter table public.agencies drop constraint agencies_archived_consistent;
alter table public.agencies add constraint agencies_archived_consistent check ((status = 'archived') = (archived_at is not null));

create or replace function app.agency_open(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select coalesce((select a.status <> 'suspended' from public.agencies a where a.id = p_agency_id), false);
$$;

create or replace function app.brand_agency_open(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.brands b join public.agencies a on a.id = b.agency_id where b.id = p_brand_id and a.status <> 'suspended');
$$;

-- ── Core helpers: Super Admin is platform-wide; suspended agencies lock everyone else out ─
create or replace function app.is_agency_staff_for_agency(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_platform_admin() or (app.is_active_user() and app.agency_open(p_agency_id) and exists (
        select 1 from public.agency_memberships am where am.agency_id = p_agency_id and am.user_id = auth.uid()));
$$;

create or replace function app.is_agency_admin_for_agency(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_platform_admin() or (app.is_active_user() and app.agency_open(p_agency_id) and exists (
        select 1 from public.agency_memberships am
        where am.agency_id = p_agency_id and am.user_id = auth.uid() and am.role in ('agency_owner', 'agency_admin')));
$$;

create or replace function app.is_agency_admin(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_platform_admin() or (app.is_active_user() and exists (
        select 1 from public.brands b
        join public.agencies a on a.id = b.agency_id and a.status <> 'suspended'
        join public.agency_memberships am on am.agency_id = b.agency_id
        where b.id = p_brand_id and am.user_id = auth.uid() and am.role in ('agency_owner', 'agency_admin')));
$$;

create or replace function app.is_agency_manager(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (
        select 1 from public.brands b
        join public.agencies a on a.id = b.agency_id and a.status <> 'suspended'
        join public.agency_memberships am on am.agency_id = b.agency_id
        where b.id = p_brand_id and am.user_id = auth.uid() and am.role = 'agency_manager');
$$;

create or replace function app.brand_role(p_brand_id uuid) returns text
language sql stable security definer set search_path = '' as $$
    select bm.role from public.brand_memberships bm
    where bm.brand_id = p_brand_id and bm.user_id = auth.uid() and app.is_active_user() and app.brand_agency_open(p_brand_id);
$$;

-- ── Client Users ───────────────────────────────────────────────────────────
-- A client user may now cover the whole client (client_id null) or one legacy inner client.
alter table public.brand_memberships drop constraint brand_memberships_check;
alter table public.brand_memberships add constraint brand_memberships_client_scope check (role = 'client' or client_id is null);
-- Read-only by default; collaboration only through explicit permissions (client users only).
alter table public.brand_memberships add column permissions text[] not null default '{}'
    check (permissions <@ array['ai_chat', 'comment_tasks', 'download_reports']::text[]);
alter table public.brand_memberships add constraint brand_memberships_permissions_client_only check (role = 'client' or permissions = '{}');
grant update (permissions) on public.brand_memberships to authenticated;

create or replace function app.client_permission(p_brand_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.brand_memberships bm
        where bm.brand_id = p_brand_id and bm.user_id = auth.uid() and bm.role = 'client' and p_permission = any (bm.permissions))
        and app.is_active_user() and app.brand_agency_open(p_brand_id);
$$;

create or replace function app.can_read_client_row(p_brand_id uuid, p_client_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    -- coalesce: never NULL (a NULL would pass an 'if not ...' check in PL/pgSQL callers).
    select coalesce(app.is_brand_staff(p_brand_id)
        or (app.brand_role(p_brand_id) = 'client' and (app.client_scope(p_brand_id) is null or app.client_scope(p_brand_id) = p_client_id)), false);
$$;

-- ── Conversation visibility (explicit scopes, enforced by RLS) ─────────────
alter table public.conversations add column visibility text not null default 'agency_internal'
    check (visibility in ('agency_internal', 'client_shared', 'user_private'));

/**
 * agency_internal: staff of the client (incl. agency admins/managers and super admins).
 * client_shared:   staff + the client's users who hold the ai_chat permission.
 * user_private:    only its creator (administrators do not see it automatically).
 */
create or replace function app.can_read_conversation(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.conversations c where c.id = p_conversation_id and (
        (c.visibility = 'user_private' and c.created_by = auth.uid() and app.can_read_brand(c.brand_id))
        or (c.visibility <> 'user_private' and app.is_brand_staff(c.brand_id))
        or (c.visibility = 'client_shared' and app.brand_role(c.brand_id) = 'client' and app.client_permission(c.brand_id, 'ai_chat'))));
$$;

create or replace function app.can_post_in_conversation(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.can_read_conversation(p_conversation_id) and exists (select 1 from public.conversations c where c.id = p_conversation_id and not c.archived and (
        app.can_write_brand(c.brand_id)
        or (c.visibility = 'client_shared' and app.client_permission(c.brand_id, 'ai_chat'))
        or (c.visibility = 'user_private' and c.created_by = auth.uid())));
$$;

drop policy conversations_select on public.conversations;
drop policy conversations_insert on public.conversations;
drop policy conversations_update on public.conversations;
create policy conversations_select on public.conversations for select to authenticated using (app.can_read_conversation(id));
create policy conversations_insert on public.conversations for insert to authenticated
    with check (created_by = (select auth.uid()) and (
        app.can_write_brand(brand_id)
        or (visibility = 'client_shared' and app.client_permission(brand_id, 'ai_chat'))));
create policy conversations_update on public.conversations for update to authenticated
    using (app.can_write_brand(brand_id) and (visibility <> 'user_private' or created_by = (select auth.uid())))
    with check (app.can_write_brand(brand_id) and (visibility <> 'user_private' or created_by = (select auth.uid())));
grant update (visibility) on public.conversations to authenticated;

drop policy messages_select on public.messages;
drop policy messages_insert on public.messages;
create policy messages_select on public.messages for select to authenticated using (app.can_read_conversation(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
    with check (author_type = 'user' and author_user_id = (select auth.uid())
        and author_agent_id is null and execution_id is null and mode is null and proposals = '[]'::jsonb
        and app.can_post_in_conversation(conversation_id)
        and exists (select 1 from public.conversations c where c.id = conversation_id and c.brand_id = messages.brand_id));

-- Execution logs: staff only, and only for conversations they may read.
drop policy executions_select on public.agent_executions;
create policy executions_select on public.agent_executions for select to authenticated
    using (app.is_brand_staff(brand_id) and (conversation_id is null or app.can_read_conversation(conversation_id)));

-- Client-facing agents: client users with ai_chat see these (never instructions, which stay staff-only).
alter table public.agent_instances add column client_facing boolean not null default false;
drop policy agent_instances_select on public.agent_instances;
create policy agent_instances_select on public.agent_instances for select to authenticated
    using (app.is_brand_staff(brand_id) or (client_facing and app.client_permission(brand_id, 'ai_chat')));

-- ── Projects, tasks and comments shared with the client ────────────────────
alter table public.projects add column client_visible boolean not null default false;
drop policy projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
    using (app.is_brand_staff(brand_id) or (client_visible and app.brand_role(brand_id) = 'client'));
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
    using (app.is_brand_staff(brand_id) or (app.brand_role(brand_id) = 'client'
        and exists (select 1 from public.projects p where p.id = project_id and p.brand_id = tasks.brand_id and p.client_visible)));

create table public.task_comments (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    task_id uuid not null references public.tasks (id) on delete cascade,
    author_id uuid not null references public.profiles (id),
    body text not null check (length(trim(body)) between 1 and 4000),
    created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;
create trigger task_comments_tenant_lock before update on public.task_comments for each row execute function app.prevent_tenant_change();
create policy task_comments_select on public.task_comments for select to authenticated
    using (exists (select 1 from public.tasks t where t.id = task_id and t.brand_id = task_comments.brand_id)
        and (app.is_brand_staff(brand_id) or (app.brand_role(brand_id) = 'client' and exists (select 1 from public.tasks t
            join public.projects p on p.id = t.project_id where t.id = task_id and p.client_visible))));
create policy task_comments_insert on public.task_comments for insert to authenticated
    with check (author_id = (select auth.uid())
        and exists (select 1 from public.tasks t where t.id = task_id and t.brand_id = task_comments.brand_id)
        and (app.can_write_brand(brand_id) or (app.client_permission(brand_id, 'comment_tasks') and exists (select 1 from public.tasks t
            join public.projects p on p.id = t.project_id where t.id = task_id and p.client_visible))));
revoke all on public.task_comments from anon;
revoke update, delete on public.task_comments from authenticated;

-- ── Profiles visible to the administrators who manage those users ──────────
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
    using (id = (select auth.uid()) or app.is_platform_admin()
        or exists (select 1 from public.brand_memberships mine join public.brand_memberships theirs on theirs.brand_id = mine.brand_id
                   where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id and app.is_brand_staff(mine.brand_id))
        or exists (select 1 from public.brand_memberships theirs where theirs.user_id = profiles.id and app.can_admin_brand(theirs.brand_id))
        or exists (select 1 from public.agency_memberships theirs where theirs.user_id = profiles.id and app.is_agency_admin_for_agency(theirs.agency_id)));

-- ── Platform audit trail (written only by the RPCs below) ──────────────────
create table public.platform_audit_events (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.profiles (id) on delete set null,
    action text not null,
    target_type text not null,
    target_id uuid,
    agency_id uuid references public.agencies (id) on delete set null,
    brand_id uuid references public.brands (id) on delete set null,
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
    created_at timestamptz not null default now()
);
create index platform_audit_events_created_idx on public.platform_audit_events (created_at desc);
alter table public.platform_audit_events enable row level security;
revoke all on public.platform_audit_events from anon, authenticated;
grant select on public.platform_audit_events to authenticated;
grant all on public.platform_audit_events to service_role;
create policy platform_audit_select on public.platform_audit_events for select to authenticated
    using (app.is_platform_admin() or (agency_id is not null and app.is_agency_admin_for_agency(agency_id)));

create or replace function app.platform_audit(p_action text, p_target_type text, p_target_id uuid, p_agency_id uuid, p_brand_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
    insert into public.platform_audit_events (actor_id, action, target_type, target_id, agency_id, brand_id, details)
    values (auth.uid(), p_action, p_target_type, p_target_id, p_agency_id, p_brand_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ── Super Admin management ─────────────────────────────────────────────────
create table app.platform_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
revoke all on app.platform_settings from public, anon, authenticated;

/**
 * One-time bootstrap of the FIRST Super Admin. Not callable by app users (no grant to
 * authenticated); the project owner runs it once from the Supabase SQL editor (service role).
 * Requires an existing, email-confirmed auth user. Closes itself permanently afterwards.
 */
create or replace function app.bootstrap_super_admin(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
    if exists (select 1 from app.platform_settings where key = 'super_admin_bootstrap' and value = 'closed')
       or exists (select 1 from public.platform_admins) then
        raise exception 'bootstrap is closed: a super admin already exists' using errcode = '42501';
    end if;
    select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null;
    if v_user is null then raise exception 'no confirmed auth user with that email' using errcode = 'P0002'; end if;
    insert into public.platform_admins (user_id) values (v_user);
    insert into app.platform_settings (key, value) values ('super_admin_bootstrap', 'closed')
        on conflict (key) do update set value = 'closed', updated_at = now();
    insert into public.platform_audit_events (actor_id, action, target_type, target_id, details)
    values (null, 'super_admin.bootstrap', 'user', v_user, jsonb_build_object('method', 'sql_bootstrap'));
    return v_user;
end $$;
revoke all on function app.bootstrap_super_admin(text) from public, anon, authenticated;

create or replace function public.grant_super_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'only super admins can grant super admin' using errcode = '42501'; end if;
    if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deactivated_at is null) then
        raise exception 'unknown or deactivated user' using errcode = 'P0002';
    end if;
    insert into public.platform_admins (user_id) values (p_user_id) on conflict do nothing;
    perform app.platform_audit('super_admin.granted', 'user', p_user_id, null, null);
end $$;

create or replace function public.revoke_super_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'only super admins can revoke super admin' using errcode = '42501'; end if;
    if (select count(*) from public.platform_admins) <= 1 and exists (select 1 from public.platform_admins where user_id = p_user_id) then
        raise exception 'cannot remove the last super admin' using errcode = '42501';
    end if;
    delete from public.platform_admins where user_id = p_user_id;
    perform app.platform_audit('super_admin.revoked', 'user', p_user_id, null, null);
end $$;

/** Account suspension (global). Super admins only; never yourself. Enforced on every query. */
create or replace function public.set_user_suspended(p_user_id uuid, p_suspended boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'only super admins suspend accounts' using errcode = '42501'; end if;
    if p_user_id = auth.uid() then raise exception 'you cannot suspend yourself' using errcode = '42501'; end if;
    if p_suspended and exists (select 1 from public.platform_admins where user_id = p_user_id) then
        raise exception 'revoke super admin before suspending this account' using errcode = '42501';
    end if;
    update public.profiles set deactivated_at = case when p_suspended then coalesce(deactivated_at, now()) else null end where id = p_user_id;
    perform app.platform_audit(case when p_suspended then 'user.suspended' else 'user.reactivated' end, 'user', p_user_id, null, null);
end $$;

-- Defence in depth: app users never write agency memberships directly (RLS already has no write policy).
revoke insert, update, delete on public.agency_memberships from authenticated;

/** Agency roles are assigned only by super admins (admins cannot create admins). */
create or replace function public.assign_agency_role(p_agency_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'only super admins assign agency roles' using errcode = '42501'; end if;
    if p_role not in ('agency_owner', 'agency_admin', 'agency_manager') then raise exception 'invalid agency role' using errcode = '22023'; end if;
    insert into public.agency_memberships (agency_id, user_id, role) values (p_agency_id, p_user_id, p_role)
        on conflict (agency_id, user_id) do update set role = excluded.role;
    perform app.platform_audit('agency_role.assigned', 'user', p_user_id, p_agency_id, null, jsonb_build_object('role', p_role));
end $$;

create or replace function public.revoke_agency_role(p_agency_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'only super admins revoke agency roles' using errcode = '42501'; end if;
    delete from public.agency_memberships where agency_id = p_agency_id and user_id = p_user_id;
    perform app.platform_audit('agency_role.revoked', 'user', p_user_id, p_agency_id, null);
end $$;

-- ── Invitations: statuses, client permissions, agency-admin invitations ────
alter table public.invitations drop constraint invitations_status_check;
alter table public.invitations add constraint invitations_status_check check (status in ('pending', 'sent', 'accepted', 'expired', 'cancelled', 'revoked', 'failed'));
alter table public.invitations add column permissions text[] not null default '{}'
    check (permissions <@ array['ai_chat', 'comment_tasks', 'download_reports']::text[]);
alter table public.invitations add column delivery_error text;

drop function public.create_invitation(uuid, text, text, uuid);
create or replace function public.create_invitation(p_brand_id uuid, p_email text, p_role text, p_client_id uuid default null, p_permissions text[] default '{}')
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
    v_email text := lower(trim(p_email));
    v_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_id uuid;
    v_expires timestamptz := now() + interval '7 days';
begin
    if not app.can_admin_brand(p_brand_id) then raise exception 'not allowed' using errcode = '42501'; end if;
    if p_role not in ('owner', 'admin', 'manager', 'member', 'viewer', 'client') then raise exception 'invalid role' using errcode = '22023'; end if;
    if p_role = 'owner' and not app.can_manage_owners(p_brand_id) then raise exception 'only owners can invite owners' using errcode = '42501'; end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email' using errcode = '22023'; end if;
    if p_role <> 'client' and (p_client_id is not null or coalesce(cardinality(p_permissions), 0) > 0) then
        raise exception 'client scope and permissions apply to client users only' using errcode = '22023';
    end if;
    if p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id and c.brand_id = p_brand_id) then
        raise exception 'client invitations must name a client of this brand' using errcode = '22023';
    end if;
    if exists (select 1 from public.brand_memberships bm join public.profiles p on p.id = bm.user_id where bm.brand_id = p_brand_id and p.email = v_email) then
        raise exception 'already a member' using errcode = '23505';
    end if;
    -- Idempotent: an open invitation for the same email and client is revoked and replaced.
    update public.invitations set status = 'revoked' where brand_id = p_brand_id and email = v_email and status in ('pending', 'sent');
    insert into public.invitations (brand_id, email, role, client_id, invited_by, token_hash, expires_at, permissions)
    values (p_brand_id, v_email, p_role, p_client_id, auth.uid(), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires, coalesce(p_permissions, '{}'))
    returning id into v_id;
    insert into public.audit_logs (brand_id, actor_id, action, subject_type, subject_id) values (p_brand_id, auth.uid(), 'invitation.created', 'invitation', v_id);
    return query select v_id, v_token, v_expires;
end $$;

create or replace function public.accept_invitation(p_token text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
    inv public.invitations;
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if auth.uid() is null or not app.is_active_user() then raise exception 'not signed in' using errcode = '42501'; end if;
    select * into inv from public.invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
    if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
    if inv.status not in ('pending', 'sent') or inv.expires_at < now() then
        raise exception 'invitation is %', case when inv.status in ('pending', 'sent') then 'expired' else inv.status end using errcode = '22023';
    end if;
    if v_email = '' or v_email <> inv.email
       or not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
        raise exception 'invitation was sent to a different email address' using errcode = '42501';
    end if;
    -- Existing identities gain a membership; nothing is granted twice.
    insert into public.brand_memberships (brand_id, user_id, role, client_id, permissions)
    values (inv.brand_id, auth.uid(), inv.role, inv.client_id, case when inv.role = 'client' then inv.permissions else '{}' end)
    on conflict (brand_id, user_id) do nothing;
    update public.invitations set status = 'accepted' where id = inv.id;
    insert into public.audit_logs (brand_id, actor_id, action, subject_type, subject_id) values (inv.brand_id, auth.uid(), 'invitation.accepted', 'invitation', inv.id);
    return (select slug from public.brands where id = inv.brand_id);
end $$;

create table public.agency_invitations (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    role text not null check (role in ('agency_admin', 'agency_manager')),
    token_hash text not null unique,
    invited_by uuid references public.profiles (id) on delete set null,
    status text not null default 'pending' check (status in ('pending', 'sent', 'accepted', 'expired', 'revoked', 'failed')),
    delivery_error text,
    expires_at timestamptz not null,
    accepted_at timestamptz,
    created_at timestamptz not null default now()
);
alter table public.agency_invitations enable row level security;
revoke all on public.agency_invitations from anon, authenticated;
grant select (id, agency_id, email, role, invited_by, status, delivery_error, expires_at, accepted_at, created_at) on public.agency_invitations to authenticated;
grant all on public.agency_invitations to service_role;
create policy agency_invitations_select on public.agency_invitations for select to authenticated
    using (app.is_platform_admin() or app.is_agency_admin_for_agency(agency_id));

create or replace function public.create_agency_invitation(p_agency_id uuid, p_email text, p_role text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
    v_email text := lower(trim(p_email));
    v_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_id uuid;
    v_expires timestamptz := now() + interval '7 days';
begin
    if not app.is_platform_admin() then raise exception 'only super admins invite agency administrators' using errcode = '42501'; end if;
    if p_role not in ('agency_admin', 'agency_manager') then raise exception 'invalid agency role' using errcode = '22023'; end if;
    update public.agency_invitations set status = 'revoked' where agency_id = p_agency_id and email = v_email and status in ('pending', 'sent');
    insert into public.agency_invitations (agency_id, email, role, token_hash, invited_by, expires_at)
    values (p_agency_id, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), v_expires) returning id into v_id;
    perform app.platform_audit('agency_invitation.created', 'invitation', v_id, p_agency_id, null, jsonb_build_object('role', p_role));
    return query select v_id, v_token, v_expires;
end $$;

create or replace function public.accept_agency_invitation(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
    inv public.agency_invitations;
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if auth.uid() is null or not app.is_active_user() then raise exception 'not signed in' using errcode = '42501'; end if;
    select * into inv from public.agency_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
    if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
    if inv.status not in ('pending', 'sent') or inv.expires_at < now() then raise exception 'invitation is not open' using errcode = '22023'; end if;
    if v_email = '' or v_email <> inv.email
       or not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
        raise exception 'invitation was sent to a different email address' using errcode = '42501';
    end if;
    insert into public.agency_memberships (agency_id, user_id, role) values (inv.agency_id, auth.uid(), inv.role)
        on conflict (agency_id, user_id) do nothing;
    update public.agency_invitations set status = 'accepted', accepted_at = now() where id = inv.id;
    perform app.platform_audit('agency_invitation.accepted', 'invitation', inv.id, inv.agency_id, null);
    return (select slug from public.agencies where id = inv.agency_id);
end $$;

create or replace function public.revoke_agency_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'only super admins revoke agency invitations' using errcode = '42501'; end if;
    update public.agency_invitations set status = 'revoked' where id = p_invitation_id and status in ('pending', 'sent', 'failed');
    perform app.platform_audit('agency_invitation.revoked', 'invitation', p_invitation_id, null, null);
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function public.create_invitation(uuid, text, text, uuid, text[]), public.accept_invitation(text),
    public.grant_super_admin(uuid), public.revoke_super_admin(uuid), public.set_user_suspended(uuid, boolean),
    public.assign_agency_role(uuid, uuid, text), public.revoke_agency_role(uuid, uuid),
    public.create_agency_invitation(uuid, text, text), public.accept_agency_invitation(text), public.revoke_agency_invitation(uuid)
    from public, anon;
grant execute on function public.create_invitation(uuid, text, text, uuid, text[]), public.accept_invitation(text),
    public.grant_super_admin(uuid), public.revoke_super_admin(uuid), public.set_user_suspended(uuid, boolean),
    public.assign_agency_role(uuid, uuid, text), public.revoke_agency_role(uuid, uuid),
    public.create_agency_invitation(uuid, text, text), public.accept_agency_invitation(text), public.revoke_agency_invitation(uuid)
    to authenticated;
revoke execute on function app.platform_audit(text, text, uuid, uuid, uuid, jsonb) from public, authenticated;
grant execute on function app.agency_open(uuid), app.brand_agency_open(uuid), app.client_permission(uuid, text),
    app.can_read_conversation(uuid), app.can_post_in_conversation(uuid) to authenticated;

-- Platform totals: websites count only for clients that are not archived (matches the agency pages).
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if;
    return jsonb_build_object(
        'agencies', (select count(*) from public.agencies where status <> 'archived'),
        'clients', (select count(*) from public.brands where status <> 'archived'),
        'websites', (select count(*) from public.websites w join public.brands b on b.id = w.brand_id where w.status <> 'archived' and b.status <> 'archived'),
        'demo_websites', (select count(*) from public.websites w join public.brands b on b.id = w.brand_id where w.status <> 'archived' and b.status <> 'archived' and w.is_demo),
        'active_users', (select count(*) from public.profiles where deactivated_at is null),
        'connected_integrations', (select count(*) from public.integrations where status = 'connected'),
        'integration_errors', (select count(*) from public.integrations where status = 'error')
    );
end $$;
