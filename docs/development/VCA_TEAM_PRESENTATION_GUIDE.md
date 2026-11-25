# VCA Team Presentation Guide

A 20–25 minute walkthrough of ULTRON-B AI using the VCA demo workspace. **Everything shown is simulated demo data.** Say so at the start: the yellow "Simulated" notices and badges on screen say the same.

## Setup (5 minutes before)
1. In `apps/adpost-web`, run `npm run dev` and open http://localhost:5173.
2. Sign in as **VCA Admin (sample)**: `admin@vca.example.test` / `adpost-dev`. This is a local-only sample password, not a secret.
3. Open **CMS → Dashboard** and check the "Simulated" notice is visible.
4. Optional: on each client's dashboard, **Reset demo data** gives a clean copy. It asks for confirmation and touches only demo records.
5. Pick light or dark mode before you start.

## Key figures (last 28 days: 2026-10-26 to 2026-11-22, vs the previous 28 days)
| Client | GA4 sessions | Key events | GSC clicks | GSC impressions | CTR | Avg. position | Health score |
|---|---|---|---|---|---|---|---|
| CMS | 11,116 (−4.7%) | 227 (−6.2%) | 3,658 (−12.9%) | 118,082 (−11.1%) | 3.10% | 13.0 | 67 |
| LIPSKY | 18,909 (+10.3%) | 440 (+6.0%) | 6,906 (+7.5%) | 186,807 (+9.2%) | 3.70% | 8.3 | 80 |
| HLDC | 7,960 (+2.6%) | 137 (+7.9%) | 2,575 (+5.5%) | 87,672 (+0.7%) | 2.94% | 14.3 | 46 |
| LOOP19 | 6,665 (+16.4%) | 124 (+13.8%) | 2,044 (+27.8%) | 72,518 (+29.1%) | 2.82% | 16.9 | 65 |

## Script
1. **Agency view (1 min).**
   - Open the VCA agency, then Clients: CMS, HLDC, LIPSKY and LOOP19, each with production and staging demo websites.
2. **CMS Dashboard (4 min): "why did clicks drop?"**
   - KPIs for GA4 and Search Console are shown separately.
   - Switch 7d / 28d / 30d / 90d: every figure is recalculated from daily rows.
   - Show the channel and device breakdowns and the integration status (simulated connections).
3. **CMS SEO Overview (2 min).**
   - "Biggest click declines" shows "construction seo services" falling.
   - Show the device and country splits.
   - Average position is an average across queries, not a live ranking.
4. **CMS Insights (3 min).**
   - 12 insights, each with category, severity, priority, assigned agent and related task.
   - Filter by severity, open one, show the evidence and **Mark reviewed**.
5. **CMS Intelligence (3 min).**
   - Health score 67 with "How it is calculated" and every deduction.
   - The issue distribution and the score trend: duplicate titles appear in week 10.
   - Simulated lab metrics, and the competitor comparison (fictitious `.example` competitors).
6. **AI Workforce (4 min).**
   - **Agent Chat:** open "Why did CMS organic clicks change this month? (demo)". The SEO Manager quotes the same numbers as the dashboard and proposes two tasks, already applied.
   - Open Technical SEO, Content SEO and Statistics SEO chats.
   - **Team Chat:**
     - "SEO team: weekly sprint plan": delegation, handoffs, an approval request, human review.
     - "Web team": design to development handoff, staging only.
     - "Cross-team": SEO and Web collaborating on one page.
   - **Executions:** simulated runs at $0, delegation depth, and one run stopped by a budget limit.
7. **Projects & Approvals (2 min).**
   - The sprint board shows 8 tasks linked to insights.
   - Approvals: one pending, one approved, one rejected. Approving records a decision only: nothing runs against a website.
8. **Reports (2 min).**
   - Executive summary, previous-period comparison, technical findings, recommendations and tasks.
   - **Export PDF** has the "DEMO - SYNTHETIC DATA" watermark on every page; **Export CSV** has the same figures as the dashboard.
9. **Switch clients (2 min).**
   - LIPSKY: growth and the low-CTR "bathroom remodel cost".
   - HLDC: mobile performance, a blocked task.
   - LOOP19: dip and recovery, and a failing simulated staging connection under Integrations (try **Sync now (simulated)**: it fails again, as designed).
   - Every page changes completely: no CMS numbers carry over.
10. **Client portal (optional, 1 min).**
    - Sign in as `user@lipsky.example.test`.
    - A LIPSKY-only portal: dashboard, reports, a shared SEO Manager chat and the shared sprint.
    - No other clients, no approvals.

## Questions you may get
- **Is this real client data?** No. It is generated locally with a fixed seed. Nothing came from GA4, Search Console, a crawler or an AI model.
- **What happens with real data?** The real connectors (WordPress, GA4, Search Console, crawler) exist server-side. They need the staging approvals listed in STAGING_RELEASE_CHECKLIST.md, and they never show demo data.
- **Do agents call an AI model here?** No. Replies are stored simulated records, labelled "Simulated". Live providers run only server-side after a verified connection.
