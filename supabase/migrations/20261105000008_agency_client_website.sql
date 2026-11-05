-- Multi-agency, client and website management (2026-11-05).
-- PREPARED AND VALIDATED LOCALLY ONLY (PGlite). NOT applied to staging: needs owner approval.
-- Tests: apps/adpost-web/src/test/db/hierarchy.db.test.ts
--
-- Mapping (owner-confirmed 2026-11-05): Platform → Agency (agencies) → Client (brands) → Website.
--  * "Client" in the product is the existing `brands` table, so every brand-scoped RLS policy,
--    agent, chat, knowledge document and AI assignment already isolates clients.
--  * The older inner `clients` table stays (client-portal users, legacy rows) but is optional:
--    websites, integrations and analytics may now omit client_id.
--  * Additive: no table or column is dropped, no existing policy is weakened.

-- ── Platform administrators ────────────────────────────────────────────────
-- Granted only by migration/service role. Platform admins create and archive agencies;
-- they do NOT get access to agency or client data unless they are also members.
create table public.platform_admins (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;
grant all on public.platform_admins to service_role;
create policy platform_admins_select_self on public.platform_admins for select to authenticated using (user_id = (select auth.uid()));

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (select 1 from public.platform_admins p where p.user_id = auth.uid());
$$;

-- ── Agencies ───────────────────────────────────────────────────────────────
alter table public.agencies
    add column description text not null default '' check (length(description) <= 2000),
    add column logo_url text check (logo_url ~ '^https://[^\s]{1,2000}$'),
    add column status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
    add column timezone text not null default 'UTC' check (length(timezone) between 1 and 64),
    add column default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
    add column contact_email text check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254),
    add column updated_at timestamptz not null default now(),
    add column archived_at timestamptz,
    add constraint agencies_name_len check (length(trim(name)) between 1 and 120),
    add constraint agencies_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
    add constraint agencies_archived_consistent check ((status = 'archived') = (archived_at is not null));

-- ── Agency roles: managers read and write every client, but do not administer ─
alter table public.agency_memberships drop constraint agency_memberships_role_check;
alter table public.agency_memberships add constraint agency_memberships_role_check
    check (role in ('agency_owner', 'agency_admin', 'agency_manager'));

-- Job functions are labels for assignment and filtering. They grant NO permissions.
alter table public.agency_memberships add column job_function text
    check (job_function in ('client_manager', 'seo_specialist', 'web_developer', 'employee', 'other'));
alter table public.brand_memberships add column job_function text
    check (job_function in ('client_manager', 'seo_specialist', 'web_developer', 'employee', 'other'));
grant update (job_function) on public.brand_memberships to authenticated;

-- Agency-level owners/admins act as owners on every client of the agency (unchanged meaning:
-- before this migration those were the only agency roles). Managers are handled separately.
create or replace function app.is_agency_admin(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (
        select 1 from public.brands b
        join public.agency_memberships am on am.agency_id = b.agency_id
        where b.id = p_brand_id and am.user_id = auth.uid() and am.role in ('agency_owner', 'agency_admin')
    );
$$;

create or replace function app.is_agency_manager(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (
        select 1 from public.brands b
        join public.agency_memberships am on am.agency_id = b.agency_id
        where b.id = p_brand_id and am.user_id = auth.uid() and am.role = 'agency_manager'
    );
$$;

create or replace function app.can_read_brand(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or app.is_agency_manager(p_brand_id) or app.brand_role(p_brand_id) is not null;
$$;

create or replace function app.is_brand_staff(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or app.is_agency_manager(p_brand_id) or coalesce(app.brand_role(p_brand_id) <> 'client', false);
$$;

create or replace function app.can_write_brand(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin(p_brand_id) or app.is_agency_manager(p_brand_id)
        or coalesce(app.brand_role(p_brand_id) in ('owner', 'admin', 'manager', 'member'), false);
$$;
-- can_admin_brand is intentionally unchanged: agency managers are not client administrators.

-- Agencies: visible to platform admins (directory only), agency members, and members of any client.
drop policy agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
    using (app.is_platform_admin() or app.is_agency_staff_for_agency(id)
        or exists (select 1 from public.brands b where b.agency_id = agencies.id and app.can_read_brand(b.id)));
-- Agency profile edits by platform admins and that agency's owners/admins; status only by platform admins (trigger).
create policy agencies_update on public.agencies for update to authenticated
    using (app.is_platform_admin() or app.is_agency_admin_for_agency(id))
    with check (app.is_platform_admin() or app.is_agency_admin_for_agency(id));
revoke insert, update, delete on public.agencies from authenticated;
grant update (name, description, logo_url, status, timezone, default_currency, contact_email) on public.agencies to authenticated;

create or replace function app.agency_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new.status is distinct from old.status and current_user <> 'service_role' and not app.is_platform_admin() then
        raise exception 'only platform administrators can change an agency status' using errcode = '42501';
    end if;
    if new.status = 'archived' and old.status <> 'archived' then new.archived_at := now(); end if;
    if new.status <> 'archived' then new.archived_at := null; end if;
    new.updated_at := now();
    return new;
end $$;
create trigger agencies_guard before update on public.agencies for each row execute function app.agency_guard();

-- ── Clients (brands) ───────────────────────────────────────────────────────
alter table public.brands drop constraint brands_status_check;
alter table public.brands
    add column display_name text check (length(display_name) <= 120),
    add column industry text check (length(industry) <= 120),
    add column logo_url text check (logo_url ~ '^https://[^\s]{1,2000}$'),
    add column primary_contact_name text check (length(primary_contact_name) <= 120),
    add column primary_contact_email text check (primary_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(primary_contact_email) <= 254),
    add column archived_at timestamptz,
    add constraint brands_status_check check (status in ('active', 'inactive', 'archived')),
    add constraint brands_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
    add constraint brands_name_len check (length(trim(name)) between 1 and 120);
update public.brands set archived_at = updated_at where status = 'archived' and archived_at is null;
alter table public.brands add constraint brands_archived_consistent check ((status = 'archived') = (archived_at is not null));
-- Client slugs are unique within an agency (the same slug may exist in another agency).
alter table public.brands drop constraint brands_slug_key;
alter table public.brands add constraint brands_agency_slug_key unique (agency_id, slug);
grant update (display_name, industry, logo_url, primary_contact_name, primary_contact_email) on public.brands to authenticated;

create or replace function app.brand_archive_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
    if new.status = 'archived' and (tg_op = 'INSERT' or old.status <> 'archived') then new.archived_at := now(); end if;
    if new.status <> 'archived' then new.archived_at := null; end if;
    if tg_op = 'UPDATE' and new.agency_id is distinct from old.agency_id then
        raise exception 'a client cannot move to another agency' using errcode = '42501';
    end if;
    return new;
end $$;
create trigger brands_archive_stamp before insert or update on public.brands for each row execute function app.brand_archive_stamp();

-- Only agency owners/admins add clients (managers and client roles cannot).
drop policy brands_insert on public.brands;
create policy brands_insert on public.brands for insert to authenticated with check (app.is_agency_admin_for_agency(agency_id));

-- ── Websites ───────────────────────────────────────────────────────────────
alter table public.websites drop constraint websites_platform_check;
alter table public.websites drop constraint websites_status_check;
alter table public.websites
    alter column client_id drop not null,
    alter column domain drop not null,
    alter column platform set default 'unknown',
    add column website_url text,
    add column environment text not null default 'production' check (environment in ('production', 'staging', 'development')),
    add column is_primary boolean not null default false,
    add column description text not null default '' check (length(description) <= 2000),
    add column archived_at timestamptz,
    add constraint websites_platform_check check (platform in ('wordpress', 'shopify', 'custom', 'other', 'unknown')),
    add constraint websites_status_check check (status in ('active', 'inactive', 'archived')),
    add constraint websites_name_len check (length(trim(name)) between 1 and 120),
    -- Stored normalized: lowercase scheme and host, no credentials, http(s) only.
    add constraint websites_url_format check (website_url ~ '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[0-9]{1,5})?(/[^\s]*)?$' and length(website_url) <= 2048),
    add constraint websites_domain_format check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');
update public.websites set archived_at = updated_at where status = 'archived' and archived_at is null;
alter table public.websites add constraint websites_archived_consistent check ((status = 'archived') = (archived_at is not null));
-- At most one primary, non-archived website per client.
create unique index websites_one_primary_idx on public.websites (brand_id) where is_primary and archived_at is null;
grant update (website_url, environment, is_primary, description) on public.websites to authenticated;

/** Normalize URL → domain, keep archive stamps consistent, move the primary flag atomically. */
create or replace function app.website_normalize() returns trigger
language plpgsql set search_path = '' as $$
declare v_host text;
begin
    if new.website_url is not null then
        new.website_url := trim(new.website_url);
        -- Lowercase scheme and host only; the path keeps its case. Input without a scheme is left
        -- unchanged so the format check rejects it (never silently turned into a draft).
        if new.website_url ~ '^[A-Za-z]+://[^/?#]+' then
            new.website_url := lower(substring(new.website_url from '^[A-Za-z]+://[^/?#]+')) || coalesce(substring(new.website_url from '^[A-Za-z]+://[^/?#]+(.*)$'), '');
        end if;
        if new.website_url ~ '^https?://[^/]*@' then
            raise exception 'website URLs must not contain credentials' using errcode = '23514';
        end if;
        v_host := substring(new.website_url from '^https?://([^/:?#]+)');
        if new.domain is not null and lower(new.domain) <> v_host then
            raise exception 'domain must match the website URL host' using errcode = '23514';
        end if;
        new.domain := v_host;
    elsif new.domain is not null then
        new.domain := lower(trim(new.domain));
    end if;
    if new.status = 'archived' and (tg_op = 'INSERT' or old.status <> 'archived') then new.archived_at := now(); end if;
    if new.status <> 'archived' then new.archived_at := null; end if;
    if new.status = 'archived' then new.is_primary := false; end if;
    if new.is_primary and (tg_op = 'INSERT' or not old.is_primary) then
        update public.websites set is_primary = false where brand_id = new.brand_id and is_primary and id <> new.id;
    end if;
    return new;
end $$;
create trigger websites_normalize before insert or update on public.websites for each row execute function app.website_normalize();

-- client_id is optional now; when present it must belong to the same client (brand).
drop policy websites_insert on public.websites;
drop policy websites_update on public.websites;
create policy websites_insert on public.websites for insert to authenticated
    with check (app.can_write_brand(brand_id)
        and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.brand_id = websites.brand_id)));
create policy websites_update on public.websites for update to authenticated
    using (app.can_write_brand(brand_id))
    with check (app.can_write_brand(brand_id)
        and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.brand_id = websites.brand_id)));

-- Website-owned data may omit the legacy inner client. Client-portal users only see rows of
-- their own client, so rows without one stay hidden from them (can_read_client_row).
alter table public.integrations alter column client_id drop not null;
alter table public.analytics_daily_metrics alter column client_id drop not null;
alter table public.analytics_search_queries alter column client_id drop not null;
alter table public.analytics_landing_pages alter column client_id drop not null;
alter table public.seo_insights alter column client_id drop not null;

/** A website may be crawled or audited only with a verified-format URL and active status. */
create or replace function app.website_is_auditable(p_website_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.websites w where w.id = p_website_id and w.website_url is not null and w.status = 'active'
        and app.can_write_brand(w.brand_id));
$$;

-- ── Conversations may be scoped to one website ─────────────────────────────
alter table public.conversations add column website_id uuid references public.websites (id) on delete set null;
create or replace function app.conversation_website_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new.website_id is not null and not exists (select 1 from public.websites w where w.id = new.website_id and w.brand_id = new.brand_id) then
        raise exception 'the website does not belong to this client' using errcode = '42501';
    end if;
    return new;
end $$;
create trigger conversations_website_guard before insert or update on public.conversations for each row execute function app.conversation_website_guard();

-- ── Provisioning: the six agents for a client ──────────────────────────────
create or replace function app.provision_brand_agents(p_brand_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare t record; v_agent uuid; v_version uuid; v_name text; n integer := 0;
begin
    select name into v_name from public.brands where id = p_brand_id;
    if v_name is null then raise exception 'unknown client' using errcode = '42501'; end if;
    for t in select * from public.agent_templates order by key loop
        if exists (select 1 from public.agent_instances a where a.brand_id = p_brand_id and a.template_key = t.key) then continue; end if;
        insert into public.agent_instances (brand_id, template_key, display_name, handle, model_provider, model, tools)
        values (p_brand_id, t.key, t.name, t.handle, 'simulated', 'sim-deterministic-1', t.default_tools) returning id into v_agent;
        insert into public.agent_instruction_versions (brand_id, agent_instance_id, version, instructions, note, created_by)
        values (p_brand_id, v_agent, 1, replace(t.default_instructions, '{brand}', v_name), 'Initial version', auth.uid()) returning id into v_version;
        update public.agent_instances set active_instruction_version_id = v_version where id = v_agent;
        n := n + 1;
    end loop;
    return n;
end $$;

-- ── RPCs ───────────────────────────────────────────────────────────────────
/** Platform admins create an agency; the caller becomes its owner. */
create or replace function public.create_agency(p_name text, p_slug text, p_description text default '', p_timezone text default 'UTC', p_currency text default 'USD')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
    if not app.is_platform_admin() then raise exception 'only platform administrators can create agencies' using errcode = '42501'; end if;
    insert into public.agencies (name, slug, description, timezone, default_currency)
    values (trim(p_name), lower(trim(p_slug)), coalesce(p_description, ''), coalesce(p_timezone, 'UTC'), upper(coalesce(p_currency, 'USD')))
    returning id into v_id;
    insert into public.agency_memberships (agency_id, user_id, role) values (v_id, auth.uid(), 'agency_owner');
    return v_id;
end $$;

/** Agency owners/admins add a client; its six agents are provisioned. */
create or replace function public.create_client(p_agency_id uuid, p_name text, p_slug text, p_description text default '', p_industry text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
    if not app.is_agency_admin_for_agency(p_agency_id) then raise exception 'only agency administrators can add clients' using errcode = '42501'; end if;
    if exists (select 1 from public.agencies a where a.id = p_agency_id and a.status = 'archived') then
        raise exception 'the agency is archived' using errcode = '42501';
    end if;
    insert into public.brands (agency_id, name, slug, description, industry)
    values (p_agency_id, trim(p_name), lower(trim(p_slug)), coalesce(p_description, ''), nullif(trim(coalesce(p_industry, '')), ''))
    returning id into v_id;
    perform app.provision_brand_agents(v_id);
    return v_id;
end $$;

/** Platform directory totals (counts only, no tenant data). */
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not app.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if;
    return jsonb_build_object(
        'agencies', (select count(*) from public.agencies where status <> 'archived'),
        'clients', (select count(*) from public.brands where status <> 'archived'),
        'websites', (select count(*) from public.websites where status <> 'archived'),
        'active_users', (select count(*) from public.profiles where deactivated_at is null),
        'connected_integrations', (select count(*) from public.integrations where status = 'connected'),
        'integration_errors', (select count(*) from public.integrations where status = 'error')
    );
end $$;

revoke all on function public.create_agency(text, text, text, text, text), public.create_client(uuid, text, text, text, text), public.platform_overview() from public, anon;
grant execute on function public.create_agency(text, text, text, text, text), public.create_client(uuid, text, text, text, text), public.platform_overview() to authenticated;
revoke execute on function app.provision_brand_agents(uuid), app.agency_guard(), app.brand_archive_stamp(), app.website_normalize(), app.conversation_website_guard() from public, authenticated;
grant execute on function app.is_platform_admin(), app.is_agency_manager(uuid), app.website_is_auditable(uuid) to authenticated;
