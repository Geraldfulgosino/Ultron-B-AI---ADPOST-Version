# VCA Demonstration Data Plan

**Date:** 2026-11-25 · **Scope:** local mock adapter only (`apps/adpost-web`). Nothing is written to Supabase, deployed or sent anywhere.

## What it is
A deterministic, labelled **synthetic** dataset for the four VCA clients, so the VCA team can explore every module without GA4, Search Console, WordPress, Supabase or paid AI credentials.

| Client | Brand id | Demo website (unchanged) | Storyline in the data |
|---|---|---|---|
| CMS | `brd_vca_cms` | `cms.example` | Organic clicks decline this month: simulated ranking drop for "construction seo services", and duplicate titles after a template update (audit week 10) |
| LIPSKY | `brd_vca_lipsky` | `lipsky.example` | Steady growth; the gap is low CTR on high-impression service queries |
| HLDC | `brd_vca_hamptons` | `hamptons.example` | Flat traffic; weak mobile engagement and a slow simulated mobile LCP |
| LOOP19 | `brd_vca_loop19` | `loop19.example` | Mid-period dip (weeks 4–7), then recovery; one simulated failing staging connection |

The clients, websites and agents already existed in the sample seed. **No client, website or agent is created, and no website address changes.** HLDC and LOOP19 have no local company profile, so their keyword themes are generic construction-industry and neutral web-performance examples. No facts about these companies are invented.

## Where it lives
- Generator: `src/data/local/vcaDemo.ts`, applied by `applySampleSeed` (`sampleSeed.ts`).
- Score maths: `src/domain/audit.ts`.
- New local table: `siteAudits`. In Supabase the equivalents are `seo_crawl_jobs` and `seo_findings` (0010).
- New optional fields (backward compatible):
  - `DailyMetric.engagedSessions` and `breakdown`
  - `Integration.simulated` and `syncHistory`
  - `SeoInsight.category`, `priority`, `assignedAgentId`, `taskId` and `simulated`
  - `Task.insightId`
  - `ApprovalRequest.simulated`

## Records per client
| Area | Rows | Notes |
|---|---|---|
| Daily metrics | 90 (2026-08-25 → 2026-11-22) | GA4 sessions, active users, engaged sessions, key events. GSC clicks, impressions and average position. Splits by device, channel and country (each sums exactly to its total) |
| Search queries | 9–10 per week × 13 | Weekly buckets; never more than that week's daily totals |
| Landing pages | 6–8 per week × 13 | Derived from the week's sessions |
| Site audits | 13 weekly snapshots | 13 issue types, simulated lab metrics, 3 fictitious competitors on `.example` domains |
| Integrations | GA4 + GSC (LOOP19 also has a failing staging GA4) | `simulated: true`, no property ids, sync history with simulated successes and failures |
| SEO insights | 12 | Categories: high impressions/low CTR, declining clicks, declining page, ranking opportunities, title & meta, content, internal linking, technical warning, mobile performance, conversion. Each has an agent, a priority and a status, and most have a task |
| Project / tasks / comments | 1 / 8 / 3–4 | Sprint tasks linked to insights; completion comments |
| Approvals | 3 | Pending, approved and rejected; payload `simulated: 'true'` |
| Conversations / messages | 9 / ~31 | 6 direct (one per specialist), plus SEO team, Web team and cross-functional chats |
| Executions | 24 | Mode and provider `simulated`, cost $0, simulated tokens and durations, delegation depth |
| Knowledge | 5 documents | Agency SEO guidelines, construction content brief, technical checklist, reporting standards, brand demo notes |

## Baselines (invented, approximate monthly averages over the 90 days)
| Client | GA4 sessions | GSC clicks | GSC impressions |
|---|---|---|---|
| CMS | 12,400 | 4,350 | 138,000 |
| LIPSKY | 18,700 | 6,900 | 184,000 |
| HLDC | 8,600 | 2,750 | 96,000 |
| LOOP19 | 6,900 | 2,100 | 74,000 |

All totals, CTR, engagement rate and period comparisons are **calculated on read** from the daily rows. No total is stored. GA4 sessions and GSC clicks are separate metrics and are never added together. Average position is shown as an average, never as a live ranking. Search volume and keyword difficulty are not present and are not estimated.

## Health score (explainable)
`100 − Σ min(12, % of pages affected × weight)`, with weights high 0.6, medium 0.3 and low 0.1. The Intelligence page lists every deduction. Reports, agents and the trend use the same function, so they always agree. The latest scores are CMS 67, LIPSKY 80, HLDC 46 and LOOP19 65.

## Safety mechanics
- **Deterministic:** a fixed seed per client (`vca-demo-v1:<key>`) and a fixed end date. Two builds are byte-identical (tested).
- **Idempotent:** applied once per client, recorded in `seedSteps`. A refresh never duplicates or re-creates rows the user deleted (tested).
- **Owned:** every demo row id starts with `vd_<client>_`.
- **Reset** (Dashboard → "Reset demo data", admin only, in-app confirmation):
  - deletes and re-creates only that client's demo-owned rows;
  - leaves user records and other clients alone;
  - is audited as `demo.reset`.
  In Supabase mode the demo API reports "no demo dataset".
- **Skips cleanly:** if a client's demo production website is missing or archived, that client is skipped. Nothing is created (tested).
- **No external effects:**
  - "Sync now (simulated)" only appends a local history entry (tested: no `fetch`);
  - simulated approvals record a decision only;
  - chat replies are stored simulated records, not model calls.
- **Labels:**
  - a "Simulated" notice on the Dashboard, SEO Overview, Intelligence and Reports;
  - "Simulated" badges on integrations, insights, audits and agent replies;
  - CSV and PDF exports carry a "DEMO / SYNTHETIC DATA" notice; the PDF also has a diagonal watermark and footer on every page.

## Upgrading an existing browser
Stored local data is upgraded in place: opening the app adds the demo rows once and keeps everything else. To get a clean copy of one client's demo data, use "Reset demo data" on that client's dashboard.
