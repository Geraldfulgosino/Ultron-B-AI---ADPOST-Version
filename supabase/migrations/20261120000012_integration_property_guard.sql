-- Migration 0012: one Google property feeds one website (ADPOST/POD pilot readiness).
--
-- selectGoogleProperty already refuses a GA4 property or Search Console site that another
-- integration uses. This index makes the rule hold under concurrent requests too, so two
-- clients' dashboards (e.g. ADPOST and POD) can never be fed by the same property.
-- Disconnecting clears external_property_id, which frees the property again.
--
-- STATUS: local only. Not applied to staging (needs owner approval with 0006–0011).

create unique index integrations_google_property_unique on public.integrations (provider, external_property_id)
    where external_property_id is not null and provider in ('google_analytics', 'google_search_console');
