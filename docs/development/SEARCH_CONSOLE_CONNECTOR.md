# Search Console Connector

**Code:** `supabase/functions/_shared/integrations/{google,gsc,googleSync}.ts`. Edge function: `integration-google`.
**Status:** implemented and tested with fakes. **No Google request has been made.**

## Authorization and property selection
- **OAuth:** same flow as GA4 (see GOOGLE_ANALYTICS_CONNECTOR.md), with the scope `webmasters.readonly`.
- **Listing:** `sites.list` returns verified properties only; `siteUnverifiedUser` entries are excluded.
- **Coverage is checked by URL, never by display name:**
  - `sc-domain:example.com` covers `example.com` and its subdomains, on any scheme.
  - A URL-prefix property needs the same scheme and exact host, and must be a path prefix of the website URL. For example, `https://www.` does not cover `https://` without `www`.
- **Selection:** properties that don't cover the website fail with `site_mismatch`. The property list shows `coversWebsite` for each option.

## Data
- **Request:** `searchAnalytics/query` with `type=web`, `dataState=all` and `rowLimit` 25,000, paginated by `startRow`. The dimensions are `date` plus one of:
  - total
  - query
  - page
  - country
  - device
  - searchAppearance
- **Freshness:** rows on or after `metadata.first_incomplete_date` are stored as `data_state = 'fresh'`, because Google may still revise them.
- **Time zone:** date ranges are computed in Pacific Time, Search Console's reporting time zone.
- **Storage:** stored in `gsc_metric_rows` and upserted by (website, property, date, dimension, value).

## Opportunities (heuristics, stored in `seo_findings` with `source = 'gsc'`)
| Check | Rule |
|---|---|
| `gsc_low_ctr` | at least 100 impressions, CTR below 1%, average position 10 or better |
| `gsc_near_page_one` | query with average position between 8 and 20, and at least 50 impressions |
| `gsc_{query,page,device}_clicks_drop` | clicks fell by 30% or more, from at least 10; or clicks went to zero |
| `gsc_position_improved` | average position improved by 3 or more |
| `gsc_page_visibility_up` | impressions up 50% or more |

Every opportunity stores:
- the current **and** previous date ranges;
- the aggregated metrics;
- the property;
- the first incomplete date;
- the note *"average position … not a live ranking"*.

No search volume or keyword difficulty is produced: the API has neither.

## Needed from the owner
- The same Google Cloud OAuth client as GA4, with the Search Console API enabled.
- Approval to deploy `integration-google`.
- Approval to authorize the account that owns the Lugenix property.

## 2026-11-20 additions (ADPOST/POD pilot readiness, local only)
- **One property per website:** `selectGoogleProperty` refuses a GA4 property or Search Console site already used by another integration (before any Google request). Migration **0012** enforces the same rule in the database. Disconnecting frees the property. This keeps the ADPOST and POD data apart.
- **Audit trail:** authorization, property selection, WordPress connection and disconnection write `platform_audit_events` (website, client, agency, actor). Details carry the provider, the property id and the scopes, never tokens, codes or secrets.
- **Period comparisons:** `_shared/integrations/compare.ts` compares current and previous ranges per website. Ratios are recomputed from totals (engagement rate, CTR, impression-weighted position), and missing periods stay null. It refuses rows from more than one website.
- **Callback route:** `/oauth/google/callback` in the app forwards state, code and error once to `integration-google` and drops them from the URL. In mock mode it says Google sign-in needs live mode.
- **Not done:** no real OAuth, no Google API call, no deployment. See STAGING_RELEASE_CHECKLIST.md §7–§11.
