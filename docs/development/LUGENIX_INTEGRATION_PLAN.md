# Lugenix Integration Plan (master prompt v7)

**Pilot:** Lugenix Digital Services → Lugenix Digital Services → https://lugenixdigitalservices.com/ (production, WordPress).
**Updated:** 2026-11-13.

## Verified baseline (not assumed)
| Claim in the v7 prompt | Actual state |
|---|---|
| Latest commit `23af499` | True at the start of this session. The branch now carries the v7 commits (see GITHUB_SYNC_LOG.md) |
| Migrations 0006–0009 pending remotely | **True.** `migration list --linked`: remote 0001–0005 only. 0010 is new and also local only |
| Lugenix appears as agency and client; real website registered locally | **Not in the repository or the staging database.** Staging has no agencies, clients or websites. In the dev seed the old Lugenix agency was renamed GoldStarATM (owner decision 2026-11-13). Records seen in a browser on port 5174 live only in that browser's local storage |
| GA4/GSC show simulated mode | True: the local adapter only simulates them, and the UI now says so |

## Pilot records
- `supabase/seeds/pilot/lugenix_pilot.sql` is **prepared, not applied**:
  - agency `lugenix` "Lugenix Digital Services";
  - client `lugenix-digital-services`;
  - website `https://lugenixdigitalservices.com` (production, WordPress, primary, `is_demo = false`);
  - the six agents.
- It is idempotent and guarded (`app.allow_pilot_seed`). It never renames or deletes anything, and never touches GoldStarATM. Tested in `pilot.db.test.ts`.
- IDs are not hard-coded anywhere. Connectors load the website row by id under RLS.
- **Owner decision needed:** v7 names "Lugenix Digital Services" as an agency, but the 2026-11-13 reconciliation renamed the old Lugenix agency to GoldStarATM. The pilot uses a separate agency (slug `lugenix`). Confirm, or say which agency should own the pilot client.

## What is live-verified vs. tested
| Capability | State |
|---|---|
| WordPress public API discovery and inventory | **Live-verified, read-only, nothing stored:** 21 pages, 137 posts, 8 categories, 0 tags, 1,076 media counted. Rank Math, Elementor, Site Kit and Application Passwords detected |
| Technical crawl | **Live-verified, read-only, 40 pages, nothing stored:** all HTTP 200, robots.txt respected, 168 sitemap URLs. Heuristic findings only (heading skips, a few title/description lengths, one post with 5 H1s) |
| WordPress Application Password | Implemented and tested with mocks. Not connected: no credentials provided |
| GA4 / Search Console | Implemented and tested with fakes. **No Google request made:** needs a Google Cloud OAuth client and owner authorization |
| Persistence (migration 0010) | Validated on PGlite. **Not applied to staging** |
| Edge Functions `integration-sync`, `integration-google` | Implemented. **Not deployed** |
| Staging authentication (17E) and Supabase data adapter (17F) | **Not implemented.** The UI still runs on the mock adapter |

## Order to reach a live pilot (each remote step needs approval)
1. Apply migrations 0006–0010 to staging (STAGING_MIGRATION_PLAN_0006_0009.md, extended to 0010).
2. Bootstrap the first Super Admin (owner).
3. Apply the pilot seed.
4. Set the Edge secrets `INTEGRATION_ENCRYPTION_KEY` and `ALLOWED_ORIGINS`, then deploy `integration-sync`. Run discovery, `wp_sync` (public) and a crawl, which writes real rows to staging.
5. Optionally, the owner creates a dedicated WordPress user and Application Password, then runs `wp_connect`.
6. Owner creates a Google Cloud OAuth client: web type, redirect `<app origin>/oauth/google/callback`, read-only scopes. Then set the `GOOGLE_OAUTH_*` secrets, deploy `integration-google`, authorize, choose properties and sync.
7. Implement 17E/17F (staging auth + data adapter) so the dashboard reads these rows. Until then, staging data is visible only through SQL and the functions.

## Related
WORDPRESS_CONNECTOR · GOOGLE_ANALYTICS_CONNECTOR · SEARCH_CONSOLE_CONNECTOR · SEO_CRAWLER_ARCHITECTURE · INTEGRATION_SECURITY · INTEGRATION_TEST_RESULTS · REAL_DATA_MIGRATION_PLAN · LUGENIX_PILOT_CHECKLIST
