-- DEVELOPMENT-ONLY sample hierarchy: 3 agencies, 10 clients, 20 DEMO websites (2 per client).
-- These are sample records, not verified client data: only reserved .example domains; no contacts, users,
-- integrations or credentials are created. Each client gets its six agents (simulated model).
--
-- Idempotent: keyed by agency slug and (agency, client slug); re-running inserts nothing new
-- and never updates or deletes existing rows.
-- Guarded: refuses to run unless the session opts in, so it cannot be applied to staging or
-- production by accident (staging needs separate owner approval):
--     set app.allow_dev_seed = 'on';
--     \i supabase/seeds/dev/sample_hierarchy.sql
-- Requires migrations through 20261105000008.

do $$
declare
    v_agency uuid;
    v_brand uuid;
    a record;
    c record;
begin
    if coalesce(current_setting('app.allow_dev_seed', true), '') <> 'on' then
        raise exception 'dev seed refused: set app.allow_dev_seed = ''on'' in a development database only';
    end if;

    for a in select * from (values
        ('ADPOST', 'adpost'),
        ('VCA', 'vca'),
        ('Lugenix Digital Services', 'lugenix-digital-services')
    ) as t(name, slug) loop
        insert into public.agencies (name, slug, status, description)
        values (a.name, a.slug, 'active', 'Sample development agency.')
        on conflict (slug) do nothing;
    end loop;

    for c in select * from (values
        ('adpost', 'POD', 'pod'),
        ('adpost', 'DSP', 'dsp'),
        ('adpost', 'FMF', 'fmf'),
        ('adpost', 'TRADE BAGS', 'trade-bags'),
        ('adpost', 'STUDIO PILATES', 'studio-pilates'),
        ('vca', 'LIPSKY', 'lipsky'),
        ('vca', 'HAMPTONS', 'hamptons'),
        ('vca', 'CMS', 'cms'),
        ('vca', 'LOOP19', 'loop19'),
        ('lugenix-digital-services', 'GoldStar ATM', 'goldstar-atm')
    ) as t(agency_slug, name, slug) loop
        select id into v_agency from public.agencies where slug = c.agency_slug;
        insert into public.brands (agency_id, name, slug, status, description)
        values (v_agency, c.name, c.slug, 'active', 'Sample development client.')
        on conflict (agency_id, slug) do nothing;
        select id into v_brand from public.brands where agency_id = v_agency and slug = c.slug;
        perform app.provision_brand_agents(v_brand);

        -- Two DEMO websites per client on reserved RFC 2606 .example domains: never crawled,
        -- verified, monitored or connected (is_demo; blocked by the SSRF guard and website_is_auditable).
        -- Keyed by (client, domain): re-running adds nothing; user-created websites are untouched,
        -- and the demo production site becomes primary only if the client has no primary yet.
        insert into public.websites (brand_id, name, website_url, environment, platform, status, is_primary, description, is_demo)
        select v_brand, c.name || ' — Production', 'https://' || c.slug || '.example', 'production', 'unknown', 'active',
               not exists (select 1 from public.websites w where w.brand_id = v_brand and w.is_primary and w.archived_at is null),
               'Demo record (reserved .example domain). Not a verified live website.', true
        where not exists (select 1 from public.websites w where w.brand_id = v_brand and w.domain = c.slug || '.example');
        insert into public.websites (brand_id, name, website_url, environment, platform, status, is_primary, description, is_demo)
        select v_brand, c.name || ' — Staging', 'https://staging.' || c.slug || '.example', 'staging', 'unknown', 'active', false,
               'Demo record (reserved .example domain). Not a verified live website.', true
        where not exists (select 1 from public.websites w where w.brand_id = v_brand and w.domain = 'staging.' || c.slug || '.example');
    end loop;
end $$;
