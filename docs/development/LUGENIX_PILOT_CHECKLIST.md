# Lugenix Pilot Checklist (2026-11-13)

Each box is ticked only for a genuinely verified result. "Prepared" or "tested locally" is not ticked.

- [ ] **Lugenix exists under the correct agency and client.** The pilot seed is prepared and tested on PGlite, not applied. Awaiting owner approval and the agency decision (separate agency `lugenix` vs. GoldStarATM).
- [ ] **The website exists as a production WordPress site.** Defined in the pilot seed (production, wordpress, primary, not demo). Not applied.
- [ ] **Real staging authentication works.** 17E is not implemented, and staging has no users.
- [x] **The WordPress public API can be queried.** Live, read-only: discovery and inventory of 21 pages, 137 posts and 8 categories.
- [ ] **An authorized WordPress connection can be tested.** Implemented and mock-tested. No Application Password provided.
- [x] **Real WordPress pages and posts are retrieved.** Retrieved live (public). Not stored.
- [ ] **Actual content is stored in Supabase after approved staging writes.** Needs migration 0010, the seed and deployment approval.
- [ ] **GA4 can complete approved OAuth.** Implemented and fake-tested. Needs a Google Cloud OAuth client and authorization.
- [ ] **The actual GA4 property is selected and verified.**
- [ ] **Actual GA4 metrics can be retrieved.**
- [ ] **The GSC property is selected and verified.**
- [ ] **Actual GSC records can be retrieved.**
- [x] **The technical SEO crawler produces evidence-backed findings.** Live, read-only crawl of 40 pages: heuristic findings with evidence. Not stored.
- [ ] **The dashboard displays actual connected-source data.** Needs the 17F data adapter and staging data.
- [x] **No fake metrics appear in live mode.** Connectors return null or no rows for missing data. The mock UI labels simulated actions. *Note: "live mode" in the UI does not exist yet (17F).*
- [ ] **Client and agency permissions are enforced on staging.** Enforced and tested on PGlite only.
- [ ] **AI agents use authorized website context.** The agent runtime is website-scoped (v5/v6). Not yet wired to integration data.
- [ ] **Reports use real records with source references.** `report_snapshots` schema only.
- [ ] **Integration errors and statuses are visible.** Status model, run history and UI rows exist. Live statuses need staging.
- [x] **Tests and production build pass.** 593 passed + 1 opt-in, tsc clean, build ok.
- [x] **The GitHub feature branch is synchronized.** See GITHUB_SYNC_LOG.md.
