# Real Data Migration Plan

## Current state (verified 2026-11-13, read-only)
- **Applied on staging (`ppwkxlwxzutigepaizob`):** migrations 0001–0005.
- **Rows on staging:** only the 6 agent templates. Every other checked table holds 0 rows, including auth users.
- **Local only:**
  - 0006 advisor fixes
  - 0007 AI providers
  - 0008 hierarchy
  - 0009 roles
  - **0010 website integrations** (new)
- **Pilot seed:** `supabase/seeds/pilot/lugenix_pilot.sql`, local only.

## Migration 0010 summary
- **`integrations`** gains:
  - providers `wordpress` and `site_crawler`, and the v7 status set;
  - the columns auth method, credential flag, property, config, verification, success/failure times, error category, interval, enabled, creator and update time;
  - the constraint that "connected" requires a verification time.
- **New tables:**
  - `integration_oauth_states` (service role only)
  - `integration_sync_runs`
  - `wp_content_items`
  - `ga4_metric_rows`
  - `gsc_metric_rows`
  - `seo_crawl_jobs`
  - `seo_crawl_pages`
  - `seo_findings`
  - `report_snapshots`
- **Database protections:**
  - scope triggers;
  - read-by-scope RLS;
  - service-role writes;
  - demo-website trigger;
  - uniqueness for duplicate-free syncs.
- **New function:** `integration_permissions(website)`.
- **Updated:** `platform_overview()` now counts the new statuses.
- **No data changes; nothing is dropped.** Existing `integrations` rows keep working: the old statuses remain allowed. Staging holds none.

## Fix included in 0009
- `app.can_read_client_row` now returns `false` instead of NULL. This is a behaviour-preserving fix for RLS, and a security fix for PL/pgSQL callers.

## Proposed remote order (each step needs explicit approval)
1. Dry run. It should list 0006–0010.
2. Read-only prechecks (already done; staging is empty).
3. Apply: `db push`.
4. Verify:
   - catalog: tables, policies, functions and grants;
   - advisors;
   - the rollback-only staging RLS script, now sweeping 42 brand tables;
   - integration permission checks with synthetic users, inside a rolled-back transaction.
5. Owner bootstraps the first Super Admin.
6. Pilot seed (separate approval).
7. Edge secrets plus deployment of `integration-sync` (separate approval). Then the first real writes: discovery, public sync, crawl.
8. Google OAuth client plus `integration-google` (separate approval).

## Retention (proposed, not implemented)
| Data | Retention |
|---|---|
| `ga4_metric_rows` / `gsc_metric_rows` | 16 months, matching the Search Console window |
| `seo_crawl_pages` | The last 10 jobs per website |
| `integration_sync_runs` | 180 days |
| `integration_oauth_states` | Deleted 1 day after expiry |

Each would be a scheduled cleanup. It needs approval before enabling.

## Rollback
Forward-fix migrations only. No remote reset. Staging has no user data today.
