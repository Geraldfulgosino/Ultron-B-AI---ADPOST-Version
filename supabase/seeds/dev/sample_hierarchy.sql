-- DEVELOPMENT-ONLY sample hierarchy: 3 agencies (ADPOST, VCA, GoldStarATM), 15 clients (12 active,
-- 3 archived after the 2026-11-13 reconciliation), 30 DEMO websites (2 per client).
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
        ('GoldStarATM', 'lugenix-digital-services')
    ) as t(name, slug) loop
        insert into public.agencies (name, slug, status, description)
        values (a.name, a.slug, 'active', 'Sample development agency.')
        on conflict (slug) do nothing;
    end loop;

    for c in select * from (values
        ('adpost', 'POD', 'pod'),
        ('adpost', 'DYNAMIC SCREEN PRINTING', 'dsp'),
        ('adpost', 'FMF', 'fmf'),
        ('adpost', 'TRADE BAGS', 'trade-bags'),
        ('adpost', 'STUDIO PILATES', 'studio-pilates'),
        ('vca', 'LIPSKY', 'lipsky'),
        ('vca', 'HLDC', 'hamptons'),
        ('vca', 'CMS', 'cms'),
        ('vca', 'LOOP19', 'loop19'),
        ('adpost', 'CAR MAGNETS', 'car-magnets'),
        ('lugenix-digital-services', 'GoldStar ATM', 'goldstar-atm'),
        ('lugenix-digital-services', 'ATM NEBRASKA', 'atm-nebraska'),
        ('lugenix-digital-services', 'ATM FLORIDA', 'atm-florida'),
        ('lugenix-digital-services', 'ATM OHIO', 'atm-ohio'),
        ('lugenix-digital-services', 'ATM HAWAII', 'atm-hawaii')
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

    -- ── Owner-approved reconciliation (2026-11-13). Each step runs ONCE, so a later manual
    -- restore or rename by a user is never undone by re-seeding. Records are renamed or
    -- archived, never deleted; ids, slugs, websites and agents are preserved.
    create table if not exists app.dev_seed_steps (step text primary key, applied_at timestamptz not null default now());
    if not exists (select 1 from app.dev_seed_steps where step = '2026-11-13-reconcile') then
        update public.agencies set name = 'GoldStarATM' where slug = 'lugenix-digital-services' and name = 'Lugenix Digital Services';
        -- DSP is DYNAMIC SCREEN PRINTING; HAMPTONS is HLDC (same clients, new names).
        update public.brands b set name = 'DYNAMIC SCREEN PRINTING' from public.agencies ag
            where ag.id = b.agency_id and ag.slug = 'adpost' and b.slug = 'dsp' and b.name = 'DSP';
        update public.brands b set name = 'HLDC' from public.agencies ag
            where ag.id = b.agency_id and ag.slug = 'vca' and b.slug = 'hamptons' and b.name = 'HAMPTONS';
        update public.websites w set name = replace(w.name, 'DSP — ', 'DYNAMIC SCREEN PRINTING — ')
            where w.is_demo and w.name like 'DSP — %';
        update public.websites w set name = replace(w.name, 'HAMPTONS — ', 'HLDC — ')
            where w.is_demo and w.name like 'HAMPTONS — %';
        -- Not in the target hierarchy: archived (restorable), not deleted.
        update public.brands b set status = 'archived' from public.agencies ag
            where ag.id = b.agency_id and b.status <> 'archived'
              and ((ag.slug = 'adpost' and b.slug in ('trade-bags', 'studio-pilates')) or (ag.slug = 'lugenix-digital-services' and b.slug = 'goldstar-atm'));
        insert into app.dev_seed_steps (step) values ('2026-11-13-reconcile');
    end if;
end $$;
