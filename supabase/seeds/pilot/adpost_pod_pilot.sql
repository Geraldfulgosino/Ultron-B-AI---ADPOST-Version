-- PILOT workspace (2026-11-20): the first real-data websites.
--   ADPOST (agency) → ADPOST (client: corporate website)      → <owner-supplied URL>
--                   → POD   (client: Promo On Demand website)  → <owner-supplied URL>
-- Two clients, so the two websites, their Google connections and their data never mix.
--
-- NOT APPLIED. Applying it to staging is a remote write that needs explicit owner approval, after
-- migrations 0006–0012. It creates no users, memberships, integrations or credentials: access is
-- granted separately (first Super Admin bootstrap, then invitations), and GA4/Search Console
-- connections are made by an admin through the integration Edge Functions (OAuth, then property
-- selection verified against Google; one property per website, migration 0012).
--
-- No domain is hard-coded: the owner supplies both production URLs for the session. The seed
-- refuses placeholders, reserved test domains, IP addresses, non-https URLs, the same domain for
-- both clients, and a domain already used by another client.
--
--     set app.allow_pilot_seed = 'on';
--     set app.pilot_adpost_url = 'https://<ADPOST corporate domain>/';
--     set app.pilot_pod_url    = 'https://<Promo On Demand domain>/';
--     \i supabase/seeds/pilot/adpost_pod_pilot.sql
--
-- Idempotent and non-destructive: keyed by agency slug 'adpost', client slugs 'adpost' and 'pod'
-- and the website domain. Re-running inserts nothing; nothing is renamed, updated or deleted.
-- The Lugenix pilot seed (lugenix_pilot.sql) is kept for later and is independent of this one.

do $$
declare
    v_agency uuid;
    v_brand uuid;
    v_url text;
    v_host text;
    v_other uuid;
    v_site record;
    v_hosts text[] := '{}';
begin
    if coalesce(current_setting('app.allow_pilot_seed', true), '') <> 'on' then
        raise exception 'pilot seed refused: set app.allow_pilot_seed = ''on'' (owner-approved environments only)';
    end if;

    -- Validate both URLs before writing anything.
    for v_site in select * from (values
        ('adpost', 'ADPOST', null::text, 'app.pilot_adpost_url', 'ADPOST corporate website.'),
        ('pod', 'POD', 'Promo On Demand', 'app.pilot_pod_url', 'Promo On Demand (POD) website.')) as s(slug, name, display_name, setting, description)
    loop
        v_url := nullif(trim(coalesce(current_setting(v_site.setting, true), '')), '');
        if v_url is null then
            raise exception 'pilot seed refused: set % to the real production URL (https://…)', v_site.setting;
        end if;
        v_host := lower(substring(v_url from '^https://([^/:?#]+)'));
        if v_host is null or v_url ~* '[<>]' then
            raise exception 'pilot seed refused: % must be an https:// URL', v_site.setting;
        end if;
        if v_host ~ '(^|[.])(example|test|invalid|localhost|local)$' or v_host ~ '^[0-9.]+$' or v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
            raise exception 'pilot seed refused: % must be a public production domain, not %', v_site.setting, v_host;
        end if;
        if v_host = any (v_hosts) then
            raise exception 'pilot seed refused: ADPOST and POD must have different domains';
        end if;
        v_hosts := v_hosts || v_host;
    end loop;

    insert into public.agencies (name, slug, status, description)
    values ('ADPOST', 'adpost', 'active', 'ADPOST agency.')
    on conflict (slug) do nothing;
    select id into v_agency from public.agencies where slug = 'adpost';

    for v_site in select * from (values
        ('adpost', 'ADPOST', null::text, 'app.pilot_adpost_url', 'ADPOST corporate website.'),
        ('pod', 'POD', 'Promo On Demand', 'app.pilot_pod_url', 'Promo On Demand (POD) website.')) as s(slug, name, display_name, setting, description)
    loop
        v_url := trim(current_setting(v_site.setting));
        v_host := lower(substring(v_url from '^https://([^/:?#]+)'));

        insert into public.brands (agency_id, name, slug, status, description, display_name)
        values (v_agency, v_site.name, v_site.slug, 'active', 'Pilot client: ' || v_site.description, v_site.display_name)
        on conflict (agency_id, slug) do nothing;
        select id into v_brand from public.brands where agency_id = v_agency and slug = v_site.slug;
        perform app.provision_brand_agents(v_brand);

        -- A domain belongs to one client only.
        select brand_id into v_other from public.websites where domain = v_host and brand_id <> v_brand limit 1;
        if v_other is not null then
            raise exception 'pilot seed refused: % is already a website of another client', v_host;
        end if;

        insert into public.websites (brand_id, name, website_url, environment, platform, status, is_primary, description, is_demo)
        select v_brand, v_site.name || ' — Production', v_url, 'production', 'unknown', 'active',
               not exists (select 1 from public.websites w where w.brand_id = v_brand and w.is_primary and w.archived_at is null),
               'Live production website (pilot). Read-only integrations only.', false
        where not exists (select 1 from public.websites w where w.brand_id = v_brand and w.domain = v_host);
    end loop;
end $$;
