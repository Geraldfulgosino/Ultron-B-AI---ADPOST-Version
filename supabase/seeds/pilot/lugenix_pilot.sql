-- PILOT workspace (master prompt v7): Lugenix Digital Services → Lugenix Digital Services →
-- https://lugenixdigitalservices.com/ (production, WordPress, primary, NOT demo).
--
-- NOT APPLIED. Applying it to staging is a remote write that needs explicit owner approval, after
-- migrations 0006–0010. It creates no users, memberships, integrations or credentials: access is
-- granted separately (first Super Admin bootstrap, then invitations), and integrations are created
-- by the integration Edge Functions only after real provider checks.
--
-- Idempotent and non-destructive: keyed by agency slug 'lugenix', client slug
-- 'lugenix-digital-services' and the website domain. Re-running inserts nothing; nothing is
-- renamed, updated or deleted. Distinct from the development seed's GoldStarATM agency
-- (slug 'lugenix-digital-services'), which this file never touches.
--
-- Guarded: refuses to run unless the session opts in:
--     set app.allow_pilot_seed = 'on';
-- Requires migrations through 20261113000010.

do $$
declare
    v_agency uuid;
    v_brand uuid;
begin
    if coalesce(current_setting('app.allow_pilot_seed', true), '') <> 'on' then
        raise exception 'pilot seed refused: set app.allow_pilot_seed = ''on'' (owner-approved environments only)';
    end if;

    insert into public.agencies (name, slug, status, description)
    values ('Lugenix Digital Services', 'lugenix', 'active', 'Pilot agency for the first live website integration.')
    on conflict (slug) do nothing;
    select id into v_agency from public.agencies where slug = 'lugenix';

    insert into public.brands (agency_id, name, slug, status, description)
    values (v_agency, 'Lugenix Digital Services', 'lugenix-digital-services', 'active', 'Pilot client: Lugenix Digital Services website.')
    on conflict (agency_id, slug) do nothing;
    select id into v_brand from public.brands where agency_id = v_agency and slug = 'lugenix-digital-services';
    perform app.provision_brand_agents(v_brand);

    insert into public.websites (brand_id, name, website_url, environment, platform, status, is_primary, description, is_demo)
    select v_brand, 'Lugenix Digital Services — Production', 'https://lugenixdigitalservices.com', 'production', 'wordpress', 'active',
           not exists (select 1 from public.websites w where w.brand_id = v_brand and w.is_primary and w.archived_at is null),
           'Live production website (WordPress + Elementor + Rank Math). Read-only integrations only.', false
    where not exists (select 1 from public.websites w where w.brand_id = v_brand and w.domain = 'lugenixdigitalservices.com');
end $$;
