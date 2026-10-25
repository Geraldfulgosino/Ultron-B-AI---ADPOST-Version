-- ULTRON-B AI — ADPOST Edition: core schema.
-- PREPARED ONLY. Not applied to any Supabase project (see docs/development/SUPABASE_INTEGRATION_PLAN.md).
-- Mirrors apps/adpost-web/src/domain/types.ts (camelCase there, snake_case here).

create extension if not exists pgcrypto;
create schema if not exists app;

-- ── Tenancy ────────────────────────────────────────────────────────────────

create table public.agencies (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    created_at timestamptz not null default now()
);

create table public.brands (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete restrict,
    name text not null,
    slug text not null unique,
    status text not null default 'active' check (status in ('active', 'archived')),
    description text not null default '',
    timezone text not null default 'UTC',
    currency char(3) not null default 'USD',
    color text not null default '#4f46e5' check (color ~* '^#[0-9a-f]{6}$'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index brands_agency_idx on public.brands (agency_id);

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null,
    email text not null,
    created_at timestamptz not null default now()
);

create table public.agency_memberships (
    id uuid primary key default gen_random_uuid(),
    agency_id uuid not null references public.agencies (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role text not null check (role in ('agency_owner', 'agency_admin')),
    created_at timestamptz not null default now(),
    unique (agency_id, user_id)
);

create table public.clients (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    name text not null,
    slug text not null,
    status text not null default 'active' check (status in ('active', 'archived')),
    timezone text not null default 'UTC',
    currency char(3) not null default 'USD',
    business_goals text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (brand_id, slug)
);
create index clients_brand_idx on public.clients (brand_id);

create table public.brand_memberships (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'manager', 'member', 'viewer', 'client')),
    client_id uuid references public.clients (id) on delete cascade,
    department text,
    joined_at timestamptz not null default now(),
    unique (brand_id, user_id),
    -- client users must be tied to exactly one client; staff must not be.
    check ((role = 'client') = (client_id is not null))
);
create index brand_memberships_user_idx on public.brand_memberships (user_id);

create table public.invitations (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    email text not null,
    role text not null check (role in ('owner', 'admin', 'manager', 'member', 'viewer', 'client')),
    client_id uuid references public.clients (id) on delete cascade,
    invited_by uuid not null references public.profiles (id),
    status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
    token_hash text not null unique, -- raw token is emailed, never stored
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
create unique index invitations_pending_email_idx on public.invitations (brand_id, lower(email)) where status = 'pending';

-- ── Legacy parity ──────────────────────────────────────────────────────────

create table public.websites (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid not null references public.clients (id) on delete cascade,
    name text not null,
    domain text not null,
    platform text not null default 'custom' check (platform in ('wordpress', 'shopify', 'custom', 'other')),
    status text not null default 'active' check (status in ('active', 'archived')),
    primary_conversion text,
    ga4_property_id text,
    gsc_site_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (brand_id, domain)
);
create index websites_brand_client_idx on public.websites (brand_id, client_id);

create table public.integrations (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid not null references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    provider text not null check (provider in ('google_analytics', 'google_search_console')),
    status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'disconnected')),
    external_account_name text,
    external_property_name text,
    last_synced_at timestamptz,
    last_error_message text,
    created_at timestamptz not null default now(),
    unique (website_id, provider)
);
create index integrations_brand_idx on public.integrations (brand_id);

-- OAuth tokens live in a separate table with NO client-facing policies.
-- Only Edge Functions using the service role read it.
create table public.integration_secrets (
    integration_id uuid primary key references public.integrations (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    encrypted_credentials text not null,
    updated_at timestamptz not null default now()
);

create table public.analytics_daily_metrics (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid not null references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    date date not null,
    sessions integer not null default 0,
    users integer not null default 0,
    conversions integer not null default 0,
    clicks integer not null default 0,
    impressions integer not null default 0,
    position numeric(6, 2) not null default 0,
    unique (website_id, date)
);
create index analytics_daily_brand_date_idx on public.analytics_daily_metrics (brand_id, date);

create table public.analytics_search_queries (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid not null references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    metric_date date not null,
    query text not null,
    clicks integer not null default 0,
    impressions integer not null default 0,
    position numeric(6, 2) not null default 0
);
create index analytics_queries_brand_site_idx on public.analytics_search_queries (brand_id, website_id, metric_date);

create table public.analytics_landing_pages (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid not null references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    metric_date date not null,
    path text not null,
    sessions integer not null default 0,
    conversions integer not null default 0,
    bounce_rate numeric(5, 4) not null default 0
);
create index analytics_pages_brand_site_idx on public.analytics_landing_pages (brand_id, website_id, metric_date);

create table public.seo_insights (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid not null references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    type text not null check (type in ('traffic_drop', 'ctr_opportunity', 'ranking_opportunity', 'conversion_gap', 'technical_issue', 'content_gap')),
    severity text not null check (severity in ('low', 'medium', 'high')),
    status text not null default 'pending' check (status in ('pending', 'reviewed', 'approved', 'dismissed')),
    subject text not null,
    title text not null,
    summary text not null,
    recommendation text not null,
    evidence jsonb not null default '{}'::jsonb,
    source text not null default 'rules' check (source in ('rules', 'agent')),
    reviewed_by uuid references public.profiles (id),
    reviewed_at timestamptz,
    review_notes text,
    created_at timestamptz not null default now()
);
create index seo_insights_brand_status_idx on public.seo_insights (brand_id, status);

create table public.n8n_connections (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    name text not null,
    webhook_host text not null,
    events text[] not null default '{}',
    active boolean not null default true,
    created_at timestamptz not null default now()
);

-- Full webhook URL + signing secret: service-role only (no client policies).
create table public.n8n_connection_secrets (
    connection_id uuid primary key references public.n8n_connections (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    webhook_url text not null,
    signing_secret text not null
);

create table public.n8n_deliveries (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    connection_id uuid not null references public.n8n_connections (id) on delete cascade,
    event text not null,
    status text not null check (status in ('simulated', 'delivered', 'failed')),
    attempt integer not null default 1,
    response_code integer,
    error text,
    created_at timestamptz not null default now()
);
create index n8n_deliveries_brand_idx on public.n8n_deliveries (brand_id, created_at desc);

create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    actor_id uuid references public.profiles (id),
    action text not null,
    subject_type text not null,
    subject_id uuid,
    created_at timestamptz not null default now()
);
create index audit_logs_brand_idx on public.audit_logs (brand_id, created_at desc);

-- ── AI workforce ───────────────────────────────────────────────────────────

create table public.agent_templates (
    key text primary key check (key in ('seo_manager', 'technical_seo', 'content_seo', 'statistics_seo', 'web_design', 'web_development')),
    name text not null,
    handle text not null unique,
    team text not null check (team in ('seo', 'web')),
    description text not null,
    default_instructions text not null,
    default_tools text[] not null
);

create table public.agent_instances (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    template_key text not null references public.agent_templates (key),
    display_name text not null,
    handle text not null,
    active boolean not null default true,
    model_provider text not null default 'simulated' check (model_provider in ('simulated', 'anthropic', 'openai')),
    model text not null,
    active_instruction_version_id uuid,
    tools text[] not null default '{}',
    max_output_tokens integer not null default 1024 check (max_output_tokens between 64 and 16384),
    max_runs_per_day integer not null default 100 check (max_runs_per_day > 0),
    monthly_budget_usd numeric(10, 2) not null default 25 check (monthly_budget_usd >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (brand_id, template_key),
    unique (brand_id, handle)
);

create table public.agent_instruction_versions (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    agent_instance_id uuid not null references public.agent_instances (id) on delete cascade,
    version integer not null,
    instructions text not null,
    note text not null default '',
    created_by uuid references public.profiles (id),
    created_at timestamptz not null default now(),
    unique (agent_instance_id, version)
);
alter table public.agent_instances
    add constraint agent_instances_active_version_fk
    foreign key (active_instruction_version_id) references public.agent_instruction_versions (id) deferrable initially deferred;

create table public.conversations (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    kind text not null check (kind in ('direct', 'group')),
    title text not null,
    agent_instance_ids uuid[] not null default '{}',
    team_key text check (team_key in ('seo', 'web', 'all')),
    created_by uuid not null references public.profiles (id),
    archived boolean not null default false,
    summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index conversations_brand_idx on public.conversations (brand_id, updated_at desc);

create table public.agent_executions (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    agent_instance_id uuid not null references public.agent_instances (id) on delete cascade,
    conversation_id uuid references public.conversations (id) on delete set null,
    trigger_message_id uuid,
    parent_execution_id uuid references public.agent_executions (id) on delete set null,
    handoff_depth integer not null default 0,
    status text not null check (status in ('running', 'succeeded', 'failed', 'limited')),
    mode text not null check (mode in ('simulated', 'live')),
    provider text not null,
    model text not null,
    instruction_version integer not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    error text,
    started_at timestamptz not null default now(),
    finished_at timestamptz
);
create index agent_executions_brand_idx on public.agent_executions (brand_id, started_at desc);
create index agent_executions_agent_day_idx on public.agent_executions (agent_instance_id, started_at);

create table public.messages (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    author_type text not null check (author_type in ('user', 'agent', 'system')),
    author_user_id uuid references public.profiles (id),
    author_agent_id uuid references public.agent_instances (id) on delete set null,
    body text not null,
    mentions uuid[] not null default '{}',
    attachments jsonb not null default '[]'::jsonb,
    status text not null default 'sent' check (status in ('sent', 'failed')),
    execution_id uuid references public.agent_executions (id) on delete set null,
    mode text check (mode in ('simulated', 'live')),
    proposals jsonb not null default '[]'::jsonb,
    reply_to_id uuid references public.messages (id) on delete set null,
    created_at timestamptz not null default now(),
    check ((author_type = 'user') = (author_user_id is not null))
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_brand_body_fts_idx on public.messages using gin (to_tsvector('english', body));

-- ── Work ───────────────────────────────────────────────────────────────────

create table public.projects (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    name text not null,
    description text not null default '',
    status text not null default 'active' check (status in ('active', 'on_hold', 'completed')),
    website_id uuid references public.websites (id) on delete set null,
    created_at timestamptz not null default now()
);
create index projects_brand_idx on public.projects (brand_id);

create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    project_id uuid not null references public.projects (id) on delete cascade,
    title text not null,
    description text not null default '',
    status text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done', 'blocked')),
    priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
    assignee_user_id uuid references public.profiles (id) on delete set null,
    assignee_agent_id uuid references public.agent_instances (id) on delete set null,
    created_by_type text not null check (created_by_type in ('user', 'agent', 'system')),
    created_by_id uuid,
    source_message_id uuid references public.messages (id) on delete set null,
    due_date date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (assignee_user_id is null or assignee_agent_id is null)
);
create index tasks_brand_project_idx on public.tasks (brand_id, project_id, status);

create table public.approval_requests (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    kind text not null check (kind in ('publish_content', 'deploy_change', 'run_webhook', 'external_action', 'budget_increase')),
    title text not null,
    summary text not null,
    payload jsonb not null default '{}'::jsonb,
    requested_by_type text not null check (requested_by_type in ('user', 'agent', 'system')),
    requested_by_id uuid,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    decided_by uuid references public.profiles (id),
    decided_at timestamptz,
    decision_note text,
    task_id uuid references public.tasks (id) on delete set null,
    execution_id uuid references public.agent_executions (id) on delete set null,
    created_at timestamptz not null default now()
);
create index approval_requests_brand_status_idx on public.approval_requests (brand_id, status);

-- ── Knowledge ──────────────────────────────────────────────────────────────

create table public.knowledge_documents (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    title text not null,
    kind text not null check (kind in ('brand_guide', 'product', 'seo_policy', 'faq', 'note', 'upload')),
    content text not null default '',
    tags text[] not null default '{}',
    size_bytes integer not null default 0,
    storage_path text, -- brand-knowledge/{brand_id}/{id}/{filename}
    created_by uuid references public.profiles (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index knowledge_documents_brand_idx on public.knowledge_documents (brand_id);

-- Embeddings are added in Phase 13+ once pgvector is enabled on the project:
--   alter table public.knowledge_chunks add column embedding vector(1536);
create table public.knowledge_chunks (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    document_id uuid not null references public.knowledge_documents (id) on delete cascade,
    index integer not null,
    text text not null,
    unique (document_id, index)
);
create index knowledge_chunks_brand_fts_idx on public.knowledge_chunks using gin (to_tsvector('english', text));

-- ── updated_at trigger ─────────────────────────────────────────────────────

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

do $$
declare t text;
begin
    foreach t in array array['brands', 'clients', 'websites', 'agent_instances', 'conversations', 'tasks', 'knowledge_documents'] loop
        execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    end loop;
end $$;

-- ── profile bootstrap ──────────────────────────────────────────────────────

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into public.profiles (id, name, email)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), new.email);
    return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
    for each row execute function app.handle_new_user();
