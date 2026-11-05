-- AI provider connection manager (master prompt v5.0, milestone 2).
-- PREPARED AND VALIDATED LOCALLY ONLY (PGlite). NOT applied to staging: needs owner approval.
-- Tests: apps/adpost-web/src/test/db/aiProviders.db.test.ts
--
-- Design rules
--  * No credential value is ever stored in a table. A connection holds only a
--    logical secret-slot name (e.g. ANTHROPIC_API_KEY) that the Edge Function
--    resolves from Supabase secrets against an allow-list.
--  * Dynamic per-tenant keys (BYOK) are NOT enabled: authentication_method only
--    accepts 'platform_secret' (and 'none' for the offline simulator). A later,
--    separately reviewed migration may add a vault-backed method.
--  * Health, status and usage columns are written only by server code
--    (service_role). A saved connection is never "connected" until a server test says so.
--  * Organization = agency. Only agency staff create, edit, rotate or remove
--    connections; brand admins assign them to their brand's agents.

-- ── Provider catalog (global, read-only for users) ─────────────────────────
create table public.ai_providers (
    provider_code text primary key check (provider_code ~ '^[a-z][a-z0-9_]{1,31}$'),
    display_name text not null,
    enabled boolean not null default true,
    auth_methods text[] not null,
    requires_separate_billing boolean not null default true,
    capability_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(capability_metadata) = 'object'),
    docs_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.ai_providers (provider_code, display_name, auth_methods, requires_separate_billing, capability_metadata, docs_url) values
    ('simulated', 'Simulated (offline)', array['none'], false, '{"streaming": false, "tools": false, "note": "Deterministic offline stand-in. Never a live model."}', null),
    ('anthropic', 'Anthropic API', array['platform_secret'], true, '{"streaming": true, "tools": true, "model_listing": true}', 'https://docs.anthropic.com/en/api/overview'),
    ('openai', 'OpenAI API', array['platform_secret'], true, '{"streaming": true, "tools": true, "model_listing": true}', 'https://platform.openai.com/docs/api-reference');

-- ── Connections (metadata only) ────────────────────────────────────────────
create table public.ai_provider_connections (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    brand_id uuid references public.brands (id) on delete cascade,
    provider_code text not null references public.ai_providers (provider_code),
    display_name text not null check (length(trim(display_name)) between 1 and 80),
    authentication_method text not null check (authentication_method in ('platform_secret', 'none')),
    -- Logical slot name only. Provider-prefixed so a slot cannot be pointed at another provider.
    credential_reference text check (credential_reference ~ '^(ANTHROPIC|OPENAI)_API_KEY(_[A-Z0-9]{1,32})?$'),
    api_organization text check (api_organization ~ '^[A-Za-z0-9_-]{1,64}$'),
    api_project text check (api_project ~ '^[A-Za-z0-9_-]{1,64}$'),
    default_model text check (default_model ~ '^[A-Za-z0-9._:/-]{1,128}$'),
    max_output_tokens integer not null default 1024 check (max_output_tokens between 64 and 32000),
    monthly_budget_usd numeric(10, 2) check (monthly_budget_usd >= 0),
    max_cost_per_request_usd numeric(10, 4) check (max_cost_per_request_usd >= 0),
    monthly_request_limit integer check (monthly_request_limit > 0),
    enabled boolean not null default true,
    connection_status text not null default 'not_configured' check (connection_status in (
        'not_configured', 'configured', 'testing', 'connected', 'invalid_credentials', 'permission_denied',
        'insufficient_credits', 'rate_limited', 'unavailable', 'disabled')),
    last_tested_at timestamptz,
    last_error_category text,
    verified_models text[] not null default '{}',
    created_by uuid references public.profiles (id),
    updated_by uuid references public.profiles (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique nulls not distinct (agency_id, brand_id, display_name),
    check ((authentication_method = 'none') = (provider_code = 'simulated')),
    check (authentication_method <> 'none' or credential_reference is null),
    check (credential_reference is null
        or (provider_code = 'anthropic' and credential_reference like 'ANTHROPIC\_%')
        or (provider_code = 'openai' and credential_reference like 'OPENAI\_%'))
);
create index ai_provider_connections_agency_idx on public.ai_provider_connections (agency_id);
create index ai_provider_connections_brand_idx on public.ai_provider_connections (brand_id) where brand_id is not null;

-- ── Model catalog (per agency; capabilities and prices only when verified) ─
create table public.ai_provider_models (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    provider_code text not null references public.ai_providers (provider_code),
    provider_model_id text not null check (provider_model_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
    display_name text not null,
    capability_flags text[] not null default '{}'
        check (capability_flags <@ array['text', 'streaming', 'tools', 'structured_output', 'vision', 'reasoning']::text[]),
    context_window integer check (context_window > 0),
    max_output_tokens integer check (max_output_tokens > 0),
    active boolean not null default true,
    source text not null check (source in ('provider_api', 'admin')),
    input_usd_per_mtok numeric(12, 6) check (input_usd_per_mtok >= 0),
    output_usd_per_mtok numeric(12, 6) check (output_usd_per_mtok >= 0),
    pricing_source text,
    pricing_verified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (agency_id, provider_code, provider_model_id),
    -- A price is either fully sourced or absent: never a guess.
    check ((input_usd_per_mtok is null and output_usd_per_mtok is null)
        or (input_usd_per_mtok is not null and output_usd_per_mtok is not null and pricing_source is not null and pricing_verified_at is not null))
);

-- ── Routing defaults: one organization row (brand_id null) and per-brand rows ─
create table public.ai_routing_policies (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    brand_id uuid references public.brands (id) on delete cascade,
    default_connection_id uuid references public.ai_provider_connections (id) on delete set null,
    default_model text check (default_model ~ '^[A-Za-z0-9._:/-]{1,128}$'),
    -- Explicit consent before any fallback may send data to a different provider.
    allow_cross_provider_fallback boolean not null default false,
    monthly_budget_usd numeric(10, 2) check (monthly_budget_usd >= 0),
    per_user_monthly_budget_usd numeric(10, 2) check (per_user_monthly_budget_usd >= 0),
    max_cost_per_request_usd numeric(10, 4) check (max_cost_per_request_usd >= 0),
    monthly_request_limit integer check (monthly_request_limit > 0),
    monthly_token_limit bigint check (monthly_token_limit > 0),
    updated_by uuid references public.profiles (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique nulls not distinct (agency_id, brand_id)
);

-- ── Agent → provider/model assignment ──────────────────────────────────────
create table public.ai_agent_model_assignments (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    agent_instance_id uuid not null unique references public.agent_instances (id) on delete cascade,
    connection_id uuid not null references public.ai_provider_connections (id) on delete restrict,
    -- Denormalized by trigger so chat can show the provider without reading connection metadata.
    provider_code text not null,
    model_id text not null check (model_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
    generation_config jsonb not null default '{}'::jsonb check (jsonb_typeof(generation_config) = 'object'),
    fallback_policy text not null default 'disabled'
        check (fallback_policy in ('disabled', 'retry_same', 'secondary_model', 'secondary_provider')),
    fallback_connection_id uuid references public.ai_provider_connections (id) on delete set null,
    fallback_model_id text check (fallback_model_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
    enabled boolean not null default true,
    updated_by uuid references public.profiles (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (fallback_policy not in ('secondary_model', 'secondary_provider') or fallback_model_id is not null),
    check (fallback_policy <> 'secondary_provider' or fallback_connection_id is not null)
);
create index ai_agent_model_assignments_brand_idx on public.ai_agent_model_assignments (brand_id);
create index ai_agent_model_assignments_conn_idx on public.ai_agent_model_assignments (connection_id);

-- ── Usage (immutable, server-written, provider-reported numbers) ───────────
create table public.ai_usage_events (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    user_id uuid references public.profiles (id) on delete set null,
    agent_instance_id uuid references public.agent_instances (id) on delete set null,
    conversation_id uuid references public.conversations (id) on delete set null,
    execution_id uuid references public.agent_executions (id) on delete set null,
    connection_id uuid references public.ai_provider_connections (id) on delete set null,
    provider_code text not null,
    model_id text not null,
    request_id text,
    input_tokens integer not null default 0 check (input_tokens >= 0),
    output_tokens integer not null default 0 check (output_tokens >= 0),
    total_tokens integer generated always as (input_tokens + output_tokens) stored,
    reported_cost numeric(12, 6),
    estimated_cost numeric(12, 6),
    currency char(3) not null default 'USD',
    pricing_version text,
    execution_status text not null check (execution_status in ('succeeded', 'failed', 'cancelled', 'limited')),
    error_category text,
    latency_ms integer check (latency_ms >= 0),
    created_at timestamptz not null default now(),
    check (estimated_cost is null or pricing_version is not null)
);
create index ai_usage_events_brand_idx on public.ai_usage_events (brand_id, created_at desc);
create index ai_usage_events_agency_idx on public.ai_usage_events (agency_id, created_at desc);
create index ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);

-- ── Health checks (server-written) ─────────────────────────────────────────
create table public.ai_provider_health_checks (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    brand_id uuid references public.brands (id) on delete cascade,
    connection_id uuid not null references public.ai_provider_connections (id) on delete cascade,
    tested_by uuid references public.profiles (id) on delete set null,
    result text not null check (result in ('success', 'failure')),
    failure_category text,
    latency_ms integer check (latency_ms >= 0),
    models_reported integer check (models_reported >= 0),
    created_at timestamptz not null default now()
);
create index ai_provider_health_checks_conn_idx on public.ai_provider_health_checks (connection_id, created_at desc);

-- ── Audit trail of configuration changes (trigger-written) ─────────────────
create table public.ai_audit_events (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    brand_id uuid references public.brands (id) on delete cascade,
    actor_id uuid references public.profiles (id) on delete set null,
    action text not null,
    subject_type text not null,
    subject_id uuid,
    changed_columns text[] not null default '{}',
    created_at timestamptz not null default now()
);
create index ai_audit_events_agency_idx on public.ai_audit_events (agency_id, created_at desc);

-- Executions record which connection actually served them.
alter table public.agent_executions
    add column connection_id uuid references public.ai_provider_connections (id) on delete set null,
    add column provider_request_id text,
    add column error_category text,
    add column fallback_used boolean not null default false,
    -- Duplicate prevention: a retried or double-submitted request returns the stored execution.
    add column idempotency_key text check (idempotency_key ~ '^[A-Za-z0-9:._-]{8,200}$');
create unique index agent_executions_idempotency_idx on public.agent_executions (brand_id, idempotency_key) where idempotency_key is not null;

-- ── Helpers ────────────────────────────────────────────────────────────────
/** Agency owners and admins (not managers): the only users who manage AI credentials and organization policy. */
create or replace function app.is_agency_admin_for_agency(p_agency_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_active_user() and exists (
        select 1 from public.agency_memberships am
        where am.agency_id = p_agency_id and am.user_id = auth.uid() and am.role in ('agency_owner', 'agency_admin')
    );
$$;

/** Agency staff of the owning agency, or an admin of the scoped brand (any agency brand for agency-wide rows). */
create or replace function app.can_view_ai_config(p_agency_id uuid, p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select app.is_agency_admin_for_agency(p_agency_id)
        or case when p_brand_id is not null then app.can_admin_brand(p_brand_id)
                else exists (select 1 from public.brands b where b.agency_id = p_agency_id and app.can_admin_brand(b.id)) end;
$$;

/** True when the connection may serve agents of this brand (same agency; agency-wide or the same brand). */
create or replace function app.ai_connection_in_scope(p_connection_id uuid, p_brand_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.ai_provider_connections c join public.brands b on b.id = p_brand_id
        where c.id = p_connection_id and c.agency_id = b.agency_id and (c.brand_id is null or c.brand_id = p_brand_id)
    );
$$;

create or replace function app.ai_scope_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'UPDATE' then
        if new.agency_id is distinct from old.agency_id or new.brand_id is distinct from old.brand_id then
            raise exception 'agency_id/brand_id cannot be changed' using errcode = '42501';
        end if;
    end if;
    if new.brand_id is not null and not exists (select 1 from public.brands b where b.id = new.brand_id and b.agency_id = new.agency_id) then
        raise exception 'brand does not belong to this agency' using errcode = '42501';
    end if;
    return new;
end $$;

create trigger ai_provider_connections_scope before insert or update on public.ai_provider_connections
    for each row execute function app.ai_scope_guard();
create trigger ai_routing_policies_scope before insert or update on public.ai_routing_policies
    for each row execute function app.ai_scope_guard();

/** Changing the credential slot or provider settings invalidates the last verification. */
create or replace function app.ai_connection_reset_status() returns trigger
language plpgsql set search_path = '' as $$
begin
    if current_user = 'service_role' then return new; end if;  -- the test function records results
    if tg_op = 'INSERT' then
        new.connection_status := case when new.provider_code = 'simulated' or new.credential_reference is not null then 'configured' else 'not_configured' end;
        new.last_tested_at := null; new.last_error_category := null; new.verified_models := '{}';
    elsif new.credential_reference is distinct from old.credential_reference
        or new.api_organization is distinct from old.api_organization
        or new.api_project is distinct from old.api_project
        or (new.enabled and not old.enabled) then
        new.connection_status := case when new.provider_code = 'simulated' or new.credential_reference is not null then 'configured' else 'not_configured' end;
        new.last_tested_at := null; new.last_error_category := null; new.verified_models := '{}';
    end if;
    if not new.enabled then new.connection_status := 'disabled'; end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
    return new;
end $$;
create trigger ai_provider_connections_status before insert or update on public.ai_provider_connections
    for each row execute function app.ai_connection_reset_status();

/** Assignment integrity: agent, connection and fallback must all be in the brand's scope. */
create or replace function app.ai_assignment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_provider text; v_fallback_provider text; v_allow boolean;
begin
    if tg_op = 'UPDATE' and (new.brand_id is distinct from old.brand_id or new.agent_instance_id is distinct from old.agent_instance_id) then
        raise exception 'brand_id/agent_instance_id cannot be changed' using errcode = '42501';
    end if;
    if not exists (select 1 from public.agent_instances a where a.id = new.agent_instance_id and a.brand_id = new.brand_id) then
        raise exception 'agent does not belong to this brand' using errcode = '42501';
    end if;
    if not app.ai_connection_in_scope(new.connection_id, new.brand_id) then
        raise exception 'connection is not available to this brand' using errcode = '42501';
    end if;
    select provider_code into v_provider from public.ai_provider_connections where id = new.connection_id;
    new.provider_code := v_provider;
    if new.fallback_connection_id is not null then
        if not app.ai_connection_in_scope(new.fallback_connection_id, new.brand_id) then
            raise exception 'fallback connection is not available to this brand' using errcode = '42501';
        end if;
        select provider_code into v_fallback_provider from public.ai_provider_connections where id = new.fallback_connection_id;
        if v_fallback_provider is distinct from v_provider then
            -- Both the organization and the brand must have opted in to cross-provider fallback.
            select coalesce(bool_and(p.allow_cross_provider_fallback), false) and count(*) = 2 into v_allow
            from public.ai_routing_policies p join public.brands b on b.agency_id = p.agency_id
            where b.id = new.brand_id and (p.brand_id is null or p.brand_id = new.brand_id);
            if not v_allow then
                raise exception 'cross-provider fallback is not authorized for this brand' using errcode = '42501';
            end if;
        end if;
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    return new;
end $$;
create trigger ai_agent_model_assignments_guard before insert or update on public.ai_agent_model_assignments
    for each row execute function app.ai_assignment_guard();

/** A default connection must be usable at the policy's level (agency-wide for the organization row). */
create or replace function app.ai_policy_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new.default_connection_id is not null then
        if new.brand_id is null then
            if not exists (select 1 from public.ai_provider_connections c
                           where c.id = new.default_connection_id and c.agency_id = new.agency_id and c.brand_id is null) then
                raise exception 'organization default must be an agency-wide connection' using errcode = '42501';
            end if;
        elsif not app.ai_connection_in_scope(new.default_connection_id, new.brand_id) then
            raise exception 'connection is not available to this brand' using errcode = '42501';
        end if;
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    return new;
end $$;
create trigger ai_routing_policies_guard before insert or update on public.ai_routing_policies
    for each row execute function app.ai_policy_guard();

-- updated_at maintenance (existing helper).
create trigger ai_providers_touch before update on public.ai_providers for each row execute function app.touch_updated_at();
create trigger ai_provider_connections_touch before update on public.ai_provider_connections for each row execute function app.touch_updated_at();
create trigger ai_provider_models_touch before update on public.ai_provider_models for each row execute function app.touch_updated_at();
create trigger ai_routing_policies_touch before update on public.ai_routing_policies for each row execute function app.touch_updated_at();
create trigger ai_agent_model_assignments_touch before update on public.ai_agent_model_assignments for each row execute function app.touch_updated_at();

/** Configuration audit: who changed what (column names only, never values). */
create or replace function app.ai_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    v_row jsonb := to_jsonb(coalesce(new, old));
    v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
    v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
    v_agency uuid;
    v_brand uuid := (v_row ->> 'brand_id')::uuid;
    v_cols text[];
begin
    v_agency := coalesce((v_row ->> 'agency_id')::uuid, (select b.agency_id from public.brands b where b.id = v_brand));
    -- Cascading deletes of a brand or agency remove its audit trail too; nothing to record.
    if v_agency is null or not exists (select 1 from public.agencies a where a.id = v_agency)
        or (v_brand is not null and not exists (select 1 from public.brands b where b.id = v_brand)) then
        return coalesce(new, old);
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_cols
    from (select jsonb_object_keys(v_old || v_new) as k) keys
    where k not in ('updated_at', 'updated_by', 'created_at') and (v_old -> k) is distinct from (v_new -> k);
    insert into public.ai_audit_events (agency_id, brand_id, actor_id, action, subject_type, subject_id, changed_columns)
    values (v_agency, v_brand, auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid,
            case when tg_op = 'UPDATE' then v_cols else '{}' end);
    return coalesce(new, old);
end $$;
create trigger ai_provider_connections_audit after insert or update or delete on public.ai_provider_connections
    for each row execute function app.ai_audit();
create trigger ai_agent_model_assignments_audit after insert or update or delete on public.ai_agent_model_assignments
    for each row execute function app.ai_audit();
create trigger ai_routing_policies_audit after insert or update or delete on public.ai_routing_policies
    for each row execute function app.ai_audit();
create trigger ai_provider_models_audit after insert or update or delete on public.ai_provider_models
    for each row execute function app.ai_audit();

-- Tenant lock on brand_id for the brand-only tables (same as 0005 for older tables).
create trigger ai_usage_events_tenant_lock before update on public.ai_usage_events for each row execute function app.prevent_tenant_change();
create trigger ai_provider_health_checks_tenant_lock before update on public.ai_provider_health_checks for each row execute function app.prevent_tenant_change();
create trigger ai_audit_events_tenant_lock before update on public.ai_audit_events for each row execute function app.prevent_tenant_change();

-- ── Row level security ─────────────────────────────────────────────────────
alter table public.ai_providers enable row level security;
alter table public.ai_provider_connections enable row level security;
alter table public.ai_provider_models enable row level security;
alter table public.ai_routing_policies enable row level security;
alter table public.ai_agent_model_assignments enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_provider_health_checks enable row level security;
alter table public.ai_audit_events enable row level security;

create policy ai_providers_select on public.ai_providers for select to authenticated using (app.is_active_user());

create policy ai_connections_select on public.ai_provider_connections for select to authenticated
    using (app.can_view_ai_config(agency_id, brand_id));
create policy ai_connections_insert on public.ai_provider_connections for insert to authenticated
    with check (app.is_agency_admin_for_agency(agency_id));
create policy ai_connections_update on public.ai_provider_connections for update to authenticated
    using (app.is_agency_admin_for_agency(agency_id)) with check (app.is_agency_admin_for_agency(agency_id));
create policy ai_connections_delete on public.ai_provider_connections for delete to authenticated
    using (app.is_agency_admin_for_agency(agency_id));

-- Brand staff read the catalog (model pickers, chat indicator); agency staff curate it.
create policy ai_models_select on public.ai_provider_models for select to authenticated
    using (app.is_agency_staff_for_agency(agency_id)
        or exists (select 1 from public.brands b where b.agency_id = ai_provider_models.agency_id and app.is_brand_staff(b.id)));
create policy ai_models_insert on public.ai_provider_models for insert to authenticated
    with check (app.is_agency_admin_for_agency(agency_id));
create policy ai_models_update on public.ai_provider_models for update to authenticated
    using (app.is_agency_admin_for_agency(agency_id)) with check (app.is_agency_admin_for_agency(agency_id));
create policy ai_models_delete on public.ai_provider_models for delete to authenticated
    using (app.is_agency_admin_for_agency(agency_id));

create policy ai_policies_select on public.ai_routing_policies for select to authenticated
    using (app.can_view_ai_config(agency_id, brand_id));
create policy ai_policies_insert on public.ai_routing_policies for insert to authenticated
    with check (case when brand_id is null then app.is_agency_admin_for_agency(agency_id) else app.can_admin_brand(brand_id) end);
create policy ai_policies_update on public.ai_routing_policies for update to authenticated
    using (case when brand_id is null then app.is_agency_admin_for_agency(agency_id) else app.can_admin_brand(brand_id) end)
    with check (case when brand_id is null then app.is_agency_admin_for_agency(agency_id) else app.can_admin_brand(brand_id) end);
create policy ai_policies_delete on public.ai_routing_policies for delete to authenticated
    using (case when brand_id is null then app.is_agency_admin_for_agency(agency_id) else app.can_admin_brand(brand_id) end);

create policy ai_assignments_select on public.ai_agent_model_assignments for select to authenticated
    using (app.is_brand_staff(brand_id));
create policy ai_assignments_insert on public.ai_agent_model_assignments for insert to authenticated
    with check (app.can_admin_brand(brand_id));
create policy ai_assignments_update on public.ai_agent_model_assignments for update to authenticated
    using (app.can_admin_brand(brand_id)) with check (app.can_admin_brand(brand_id));
create policy ai_assignments_delete on public.ai_agent_model_assignments for delete to authenticated
    using (app.can_admin_brand(brand_id));

-- Usage: admins see the brand; staff see their own requests.
create policy ai_usage_select on public.ai_usage_events for select to authenticated
    using (app.can_admin_brand(brand_id) or (user_id = (select auth.uid()) and app.is_brand_staff(brand_id)));

create policy ai_health_select on public.ai_provider_health_checks for select to authenticated
    using (app.can_view_ai_config(agency_id, brand_id));

create policy ai_audit_select on public.ai_audit_events for select to authenticated
    using (app.can_view_ai_config(agency_id, brand_id));

-- ── Privileges (defence in depth over RLS) ─────────────────────────────────
revoke all on public.ai_providers, public.ai_provider_connections, public.ai_provider_models, public.ai_routing_policies,
    public.ai_agent_model_assignments, public.ai_usage_events, public.ai_provider_health_checks, public.ai_audit_events
    from anon, authenticated;

grant select on public.ai_providers to authenticated;

-- Status, verification and audit fields are not user-writable: only the server test function sets them.
grant select, delete on public.ai_provider_connections to authenticated;
grant insert (agency_id, brand_id, provider_code, display_name, authentication_method, credential_reference, api_organization,
    api_project, default_model, max_output_tokens, monthly_budget_usd, max_cost_per_request_usd, monthly_request_limit, enabled)
    on public.ai_provider_connections to authenticated;
grant update (display_name, credential_reference, api_organization, api_project, default_model, max_output_tokens,
    monthly_budget_usd, max_cost_per_request_usd, monthly_request_limit, enabled)
    on public.ai_provider_connections to authenticated;

grant select, delete on public.ai_provider_models to authenticated;
grant insert (agency_id, provider_code, provider_model_id, display_name, capability_flags, context_window, max_output_tokens,
    active, source, input_usd_per_mtok, output_usd_per_mtok, pricing_source, pricing_verified_at)
    on public.ai_provider_models to authenticated;
grant update (display_name, capability_flags, context_window, max_output_tokens, active, input_usd_per_mtok,
    output_usd_per_mtok, pricing_source, pricing_verified_at)
    on public.ai_provider_models to authenticated;

grant select, delete on public.ai_routing_policies to authenticated;
grant insert (agency_id, brand_id, default_connection_id, default_model, allow_cross_provider_fallback, monthly_budget_usd,
    per_user_monthly_budget_usd, max_cost_per_request_usd, monthly_request_limit, monthly_token_limit)
    on public.ai_routing_policies to authenticated;
grant update (default_connection_id, default_model, allow_cross_provider_fallback, monthly_budget_usd,
    per_user_monthly_budget_usd, max_cost_per_request_usd, monthly_request_limit, monthly_token_limit)
    on public.ai_routing_policies to authenticated;

grant select, delete on public.ai_agent_model_assignments to authenticated;
grant insert (brand_id, agent_instance_id, connection_id, model_id, generation_config, fallback_policy,
    fallback_connection_id, fallback_model_id, enabled)
    on public.ai_agent_model_assignments to authenticated;
grant update (connection_id, model_id, generation_config, fallback_policy, fallback_connection_id, fallback_model_id, enabled)
    on public.ai_agent_model_assignments to authenticated;

grant select on public.ai_usage_events, public.ai_provider_health_checks, public.ai_audit_events to authenticated;

grant all on public.ai_providers, public.ai_provider_connections, public.ai_provider_models, public.ai_routing_policies,
    public.ai_agent_model_assignments, public.ai_usage_events, public.ai_provider_health_checks, public.ai_audit_events
    to service_role;

grant execute on function app.can_view_ai_config(uuid, uuid), app.ai_connection_in_scope(uuid, uuid), app.is_agency_admin_for_agency(uuid) to authenticated;
revoke execute on function app.ai_scope_guard(), app.ai_connection_reset_status(), app.ai_assignment_guard(),
    app.ai_policy_guard(), app.ai_audit() from public, authenticated;
