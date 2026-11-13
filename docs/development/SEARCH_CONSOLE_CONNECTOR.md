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
