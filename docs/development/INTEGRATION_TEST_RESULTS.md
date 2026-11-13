# Integration Test Results (master prompt v7)

**Date:** 2026-11-13. Full suite: **593 passed + 1 opt-in skipped (57 files).** `tsc` clean. Build ok.

## Automated (deterministic, no network)
| Suite | Tests | Covers |
|---|---|---|
| `test/integrations/wordpress.test.ts` | 18 | Discovery, not-WordPress / site mismatch, pagination plus de-duplication, normalization, fingerprints, max items, cancel, invalid list. Auth: Basic over HTTPS, admin warning, 401/403/429/5xx, no credentials over http, auth dropped on cross-origin redirect, incomplete credentials. Private DNS, demo websites, status mapping, encryption round trip and binding, key checks |
| `test/integrations/crawler.test.ts` | 7 | Same-site only, robots.txt, scripts never run, evidence-backed findings, observed vs. heuristic, stable fingerprints, depth/pages/cancel/budget, private/loopback/metadata/redirect/rebinding blocks, robots matching rules, URL normalization |
| `test/integrations/google.test.ts` | 14 | Authorization URL (PKCE, read-only, offline). Callback state, single use, expiry, same user. Code exchange needs scope and refresh token. Expired or revoked grant. Revoke. Google-hosts-only transport and error classes. Date ranges and time zones. GA4 properties never guessed, pagination, header mapping, nulls, no-data, ratio recomputation. GSC coverage by URL, verified-only, pagination plus fresh rows, opportunities with both ranges and no volumes |
| `test/integrations/sync.test.ts` | 8 | Connected only after success, no duplicate re-syncs, removals after complete listings, permissions before network, demo refusal, credentials stored only after acceptance and deleted on disconnect, errors recorded, overlapping runs refused, findings resolve only after a complete crawl |
| `test/integrations/googleSync.test.ts` | 6 | OAuth start → callback → property → connected. Another user cannot complete. Non-admins cannot start. GA4 sync for both periods with time zone. GSC coverage plus opportunities, repeat sync without duplicates. Failure when no property is chosen, or the grant is revoked |
| `test/db/integrations.db.test.ts` | 9 | Migration 0010 on PGlite: scope derived from the website, cross-agency and cross-client isolation, credentials and OAuth state with no privileges, no app-user writes, permissions by role, demo refusal, connected requires verification, uniqueness, property validation, **access helpers never NULL** |
| `test/db/pilot.db.test.ts` | 1 | Pilot seed: guarded, idempotent, live production WordPress website, GoldStarATM untouched, no integrations |
| `data/supabase/integrationsClient.test.ts` | 4 | Browser client sends only the JWT and publishable key, keeps no password, maps errors, opens only Google consent URLs |
| `pages/management/integrations.test.tsx` | 2 | Demo websites: no Connect, disabled rows. Live websites: WordPress and crawl shown as staging-only, mock sync labelled simulated |

## Live checks (read-only, public, pilot website, nothing stored)
| Check | Result |
|---|---|
| WordPress discovery (`discoverWordPress`) | WordPress REST OK. Rank Math, Elementor, Site Kit, Application Passwords. Counts: 21 pages / 137 posts / 1,076 media / 8 categories / 0 tags |
| Full public inventory (`listWordPressContent`) | 21 / 137 / 8 / 0 listed. Totals match, no duplicates, nothing truncated |
| Technical crawl (`crawlWebsite`, 40 pages, depth 3, 500 ms delay) | 40 × HTTP 200. robots.txt found and respected, 168 sitemap URLs. Findings: heuristics only (38 heading skips, 5 description-length, 4 title-length, 1 page with 5 H1s). No observed errors |

## Not verified (needs approvals or credentials)
- Any staging write, any deployed function.
- An authenticated WordPress request (no Application Password).
- Any Google API call (no OAuth client or authorization).
- Dashboards on real data (needs the 17F adapter).

Mock-based checks are **not** live provider verification.
