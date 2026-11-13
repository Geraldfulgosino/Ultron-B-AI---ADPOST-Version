-- Migration 0010: website integrations (master prompt v7).
--
-- Reusable, provider-independent persistence for live website data: WordPress inventory,
-- Google Analytics 4 and Search Console metrics, technical SEO crawls and evidence-backed findings.
--
-- Security model
--  * Every row carries brand_id (client = brand), client_id and website_id. A trigger derives
--    brand_id/client_id from the website, so scope can never be supplied independently.
--  * App users only SELECT (RLS: app.can_read_client_row). All writes come from Edge Functions
--    using the service role, after they verified the caller with public.integration_permissions().
--  * Credentials stay in public.integration_secrets (AES-GCM ciphertext; no app-user grants).
--    OAuth state/PKCE verifiers live in public.integration_oauth_states (service role only).
--  * Metrics tables keep source attribution (provider, property, fetched_at). No defaults
--    stand in for missing data: a provider that is not connected simply has no rows.

-- ── Integration connections ───────────────────────────────────────────────
alter table public.integrations drop constraint integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
    check (provider in ('wordpress', 'google_analytics', 'google_search_console', 'site_crawler'));
alter table public.integrations drop constraint integrations_status_check;
alter table public.integrations add constraint integrations_status_check check (status in (
    'not_connected', 'pending_authorization', 'connected', 'syncing', 'sync_completed', 'sync_failed',
    'credentials_expired', 'permission_denied', 'rate_limited', 'disabled',
    'pending', 'error', 'disconnected'));
alter table public.integrations alter column status set default 'not_connected';
alter table public.integrations
    add column label text not null default '' check (length(label) <= 120),
    add column auth_method text not null default 'none' check (auth_method in ('none', 'application_password', 'oauth2')),
    add column credential_configured boolean not null default false,
    add column external_property_id text check (length(external_property_id) <= 300),
    add column config jsonb not null default '{}'::jsonb,
    add column verified_at timestamptz,
    add column last_success_at timestamptz,
    add column last_failure_at timestamptz,
    add column error_category text check (length(error_category) <= 40),
    add column sync_interval_minutes integer not null default 1440 check (sync_interval_minutes between 60 and 10080),
    add column enabled boolean not null default true,
    add column created_by uuid references public.profiles (id) on delete set null,
    add column updated_at timestamptz not null default now();
alter table public.integrations add constraint integrations_last_error_len check (length(last_error_message) <= 500);
-- 'connected' requires a verification timestamp (set only after a real provider request succeeded).
alter table public.integrations add constraint integrations_connected_verified
    check (status not in ('connected', 'syncing', 'sync_completed') or verified_at is not null);
revoke insert, update on public.integrations from authenticated;
-- Ciphertexts: no app-user privileges at all (RLS has no policies; this removes the default grants too).
revoke all on public.integration_secrets from anon, authenticated;
grant all on public.integration_secrets to service_role;

/** Scope guard: brand_id and client_id always come from the website row. */
create or replace function app.integration_row_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare w record;
begin
    select brand_id, client_id, is_demo into w from public.websites where id = new.website_id;
    if not found then raise exception 'unknown website' using errcode = '23503'; end if;
    new.brand_id := w.brand_id;
    new.client_id := w.client_id;
    return new;
end $$;

/** Live connectors never attach to demo (.example) websites. */
create or replace function app.integration_not_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if exists (select 1 from public.websites where id = new.website_id and is_demo) then
        raise exception 'demo websites cannot have live integrations' using errcode = '23514';
    end if;
    new.updated_at := now();
    return new;
end $$;
create trigger integrations_scope before insert or update of website_id, brand_id, client_id on public.integrations
    for each row execute function app.integration_row_scope();
create trigger integrations_not_demo before insert or update on public.integrations
    for each row execute function app.integration_not_demo();

-- ── Who may do what with a website's integrations (used by Edge Functions) ─
create or replace function public.integration_permissions(p_website_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w record;
begin
    select brand_id, client_id into w from public.websites where id = p_website_id;
    if not found or not app.can_read_client_row(w.brand_id, w.client_id) then
        return jsonb_build_object('can_view', false, 'can_sync', false, 'can_manage', false);
    end if;
    return jsonb_build_object(
        'can_view', true,
        -- staff with write access (incl. agency managers and Super Admins) may run syncs
        'can_sync', app.can_write_brand(w.brand_id),
        -- connecting, changing credentials and disconnecting: client/agency administrators only
        'can_manage', app.can_admin_brand(w.brand_id));
end $$;

-- ── OAuth authorization state (PKCE), service role only ───────────────────
create table public.integration_oauth_states (
    id uuid primary key default gen_random_uuid(),
    state_hash text not null unique,
    provider text not null check (provider in ('google_analytics', 'google_search_console')),
    website_id uuid not null references public.websites (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    encrypted_verifier text not null,
    redirect_uri text not null,
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
);
create trigger integration_oauth_states_scope before insert on public.integration_oauth_states
    for each row execute function app.integration_row_scope();
alter table public.integration_oauth_states enable row level security;
revoke all on public.integration_oauth_states from anon, authenticated;
grant all on public.integration_oauth_states to service_role;

-- ── Sync history ──────────────────────────────────────────────────────────
create table public.integration_sync_runs (
    id uuid primary key default gen_random_uuid(),
    integration_id uuid not null references public.integrations (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    provider text not null,
    kind text not null check (length(kind) <= 40),
    status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    records_read integer not null default 0 check (records_read >= 0),
    records_written integer not null default 0 check (records_written >= 0),
    truncated boolean not null default false,
    error_category text,
    error_message text check (length(error_message) <= 500),
    date_from date,
    date_to date,
    triggered_by uuid references public.profiles (id) on delete set null,
    check ((status = 'running') = (finished_at is null))
);
create index integration_sync_runs_site_idx on public.integration_sync_runs (website_id, started_at desc);
create index integration_sync_runs_integration_idx on public.integration_sync_runs (integration_id, started_at desc);
-- One running sync per integration and kind (prevents overlapping runs).
create unique index integration_sync_runs_one_running on public.integration_sync_runs (integration_id, kind) where status = 'running';
create trigger integration_sync_runs_scope before insert on public.integration_sync_runs
    for each row execute function app.integration_row_scope();

-- ── WordPress inventory ───────────────────────────────────────────────────
create table public.wp_content_items (
    id uuid primary key default gen_random_uuid(),
    integration_id uuid not null references public.integrations (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    content_type text not null check (content_type in ('page', 'post', 'category', 'tag', 'media')),
    external_id bigint not null check (external_id > 0),
    url text not null check (length(url) <= 2048),
    slug text not null default '' check (length(slug) <= 400),
    title text not null default '' check (length(title) <= 300),
    status text,
    published_at timestamptz,
    modified_at timestamptz,
    author_external_id bigint,
    parent_external_id bigint,
    featured_media_external_id bigint,
    category_ids bigint[] not null default '{}',
    tag_ids bigint[] not null default '{}',
    excerpt text check (length(excerpt) <= 300),
    alt_text text check (length(alt_text) <= 1000),
    mime_type text,
    item_count integer,
    fingerprint text not null,
    first_seen_at timestamptz not null default now(),
    last_fetched_at timestamptz not null default now(),
    removed_at timestamptz,
    unique (website_id, content_type, external_id)
);
create index wp_content_items_site_type_idx on public.wp_content_items (website_id, content_type) where removed_at is null;
create trigger wp_content_items_scope before insert on public.wp_content_items
    for each row execute function app.integration_row_scope();

-- ── Google Analytics 4 (Data API) ─────────────────────────────────────────
-- dimension = 'total' with dimension_value '' holds the daily totals for the property.
create table public.ga4_metric_rows (
    id uuid primary key default gen_random_uuid(),
    integration_id uuid not null references public.integrations (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    property_id text not null check (property_id ~ '^properties/[0-9]+$'),
    metric_date date not null,
    dimension text not null check (dimension in ('total', 'sessionDefaultChannelGroup', 'sessionSourceMedium', 'deviceCategory', 'country', 'landingPage')),
    dimension_value text not null default '' check (length(dimension_value) <= 1000),
    active_users bigint,
    total_users bigint,
    sessions bigint,
    engaged_sessions bigint,
    engagement_rate numeric(7, 6),
    screen_page_views bigint,
    event_count bigint,
    key_events numeric(14, 2),
    fetched_at timestamptz not null default now(),
    unique (website_id, property_id, metric_date, dimension, dimension_value)
);
create index ga4_metric_rows_site_date_idx on public.ga4_metric_rows (website_id, metric_date);
create trigger ga4_metric_rows_scope before insert on public.ga4_metric_rows
    for each row execute function app.integration_row_scope();

-- ── Google Search Console (Search Analytics) ─────────────────────────────
create table public.gsc_metric_rows (
    id uuid primary key default gen_random_uuid(),
    integration_id uuid not null references public.integrations (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    site_url text not null check (site_url ~ '^(sc-domain:[a-z0-9.-]+|https?://[^\s]+)$'),
    metric_date date not null,
    dimension text not null check (dimension in ('total', 'query', 'page', 'country', 'device', 'searchAppearance')),
    dimension_value text not null default '' check (length(dimension_value) <= 2048),
    clicks bigint not null check (clicks >= 0),
    impressions bigint not null check (impressions >= 0),
    ctr numeric(7, 6) not null,
    position numeric(8, 3) not null,
    -- 'fresh' = Google may still revise these numbers (recent days)
    data_state text not null default 'final' check (data_state in ('final', 'fresh')),
    fetched_at timestamptz not null default now(),
    unique (website_id, site_url, metric_date, dimension, dimension_value)
);
create index gsc_metric_rows_site_date_idx on public.gsc_metric_rows (website_id, metric_date);
create trigger gsc_metric_rows_scope before insert on public.gsc_metric_rows
    for each row execute function app.integration_row_scope();

-- ── Technical SEO crawls ─────────────────────────────────────────────────
create table public.seo_crawl_jobs (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
    start_url text not null check (length(start_url) <= 2048),
    max_pages integer not null default 50 check (max_pages between 1 and 500),
    max_depth integer not null default 3 check (max_depth between 0 and 10),
    pages_crawled integer not null default 0,
    findings_count integer not null default 0,
    robots_respected boolean not null default true,
    error_message text check (length(error_message) <= 500),
    requested_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
);
create index seo_crawl_jobs_site_idx on public.seo_crawl_jobs (website_id, created_at desc);
create unique index seo_crawl_jobs_one_active on public.seo_crawl_jobs (website_id) where status in ('queued', 'running');
create trigger seo_crawl_jobs_scope before insert on public.seo_crawl_jobs
    for each row execute function app.integration_row_scope();

create table public.seo_crawl_pages (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.seo_crawl_jobs (id) on delete cascade,
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    url text not null check (length(url) <= 2048),
    final_url text check (length(final_url) <= 2048),
    depth integer not null,
    http_status integer,
    redirect_chain jsonb not null default '[]'::jsonb,
    title text check (length(title) <= 300),
    meta_description text check (length(meta_description) <= 400),
    canonical text check (length(canonical) <= 2048),
    robots_meta text,
    h1 text[] not null default '{}',
    heading_outline jsonb not null default '[]'::jsonb,
    internal_links integer,
    external_links integer,
    images integer,
    images_missing_alt integer,
    structured_data_types text[] not null default '{}',
    has_viewport boolean,
    word_count integer,
    content_hash text,
    fetched_at timestamptz not null default now(),
    unique (job_id, url)
);
create trigger seo_crawl_pages_scope before insert on public.seo_crawl_pages
    for each row execute function app.integration_row_scope();

-- ── Evidence-backed findings (crawler, WordPress, GA4, GSC) ──────────────
create table public.seo_findings (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    source text not null check (source in ('crawler', 'wordpress', 'ga4', 'gsc')),
    check_id text not null check (check_id ~ '^[a-z0-9_.]{1,60}$'),
    -- observed = measured fact; heuristic = rule-of-thumb recommendation
    kind text not null check (kind in ('observed', 'heuristic')),
    subject_url text check (length(subject_url) <= 2048),
    subject_query text check (length(subject_query) <= 500),
    severity text not null check (severity in ('high', 'medium', 'low', 'info')),
    confidence numeric(3, 2) not null check (confidence between 0 and 1),
    title text not null check (length(title) between 1 and 200),
    evidence jsonb not null,
    recommendation text not null check (length(recommendation) <= 1000),
    suggested_task jsonb,
    status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
    date_from date,
    date_to date,
    observed_at timestamptz not null,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    crawl_job_id uuid references public.seo_crawl_jobs (id) on delete set null,
    sync_run_id uuid references public.integration_sync_runs (id) on delete set null,
    fingerprint text not null,
    unique (website_id, fingerprint)
);
create index seo_findings_site_status_idx on public.seo_findings (website_id, status, severity);
create trigger seo_findings_scope before insert on public.seo_findings
    for each row execute function app.integration_row_scope();

-- ── Report snapshots (what was reported, from which sources) ─────────────
create table public.report_snapshots (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid not null references public.brands (id) on delete cascade,
    client_id uuid references public.clients (id) on delete cascade,
    website_id uuid not null references public.websites (id) on delete cascade,
    period_from date not null,
    period_to date not null,
    compare_from date,
    compare_to date,
    sections jsonb not null,
    sources jsonb not null,
    limitations text[] not null default '{}',
    generated_by uuid references public.profiles (id) on delete set null,
    generated_at timestamptz not null default now(),
    check (period_from <= period_to)
);
create index report_snapshots_site_idx on public.report_snapshots (website_id, generated_at desc);
create trigger report_snapshots_scope before insert on public.report_snapshots
    for each row execute function app.integration_row_scope();

-- ── RLS: read by scope, write by service role only ───────────────────────
do $$
declare t text;
begin
    foreach t in array array['integration_sync_runs', 'wp_content_items', 'ga4_metric_rows', 'gsc_metric_rows',
                             'seo_crawl_jobs', 'seo_crawl_pages', 'seo_findings', 'report_snapshots'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('grant all on public.%I to service_role', t);
        execute format('create policy %I on public.%I for select to authenticated using (app.can_read_client_row(brand_id, client_id))', t || '_select', t);
    end loop;
end $$;

-- Integration statuses in the platform totals.
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
        'connected_integrations', (select count(*) from public.integrations where status in ('connected', 'syncing', 'sync_completed')),
        'integration_errors', (select count(*) from public.integrations where status in ('sync_failed', 'credentials_expired', 'permission_denied', 'rate_limited', 'error'))
    );
end $$;

revoke all on function public.integration_permissions(uuid) from public, anon;
grant execute on function public.integration_permissions(uuid) to authenticated, service_role;
revoke execute on function app.integration_row_scope(), app.integration_not_demo() from public, authenticated;
