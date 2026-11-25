# VCA Demo QA Checklist (2026-11-25)

A box is ticked only when the check genuinely ran. **Automated** checks are Vitest and jsdom; they render the real React pages, but nothing is drawn on a real screen. **Browser** checks need a real Chrome session.

## Automated (ran)
- [x] **TypeScript:** `tsc --noEmit` reports 0 errors.
- [x] **Full suite:** 75 files, 792 passed + 1 opt-in skipped.
- [x] **Production build:** `vite build` ok.
- [x] **`npm audit`:** 0 vulnerabilities.
- [x] **Dataset validation** (`vcaDemo.test.ts`, 14 tests):
  - determinism and id ownership;
  - 90 days and the baselines;
  - breakdowns, queries and pages consistent with totals;
  - simulated labels and no real ids;
  - links between insights, tasks, approvals, chats and executions;
  - the CMS decline story;
  - idempotency;
  - websites untouched;
  - skip when a website is missing;
  - reset;
  - health score.
- [x] **Agency and client isolation:**
  - VCA Admin sees all 4 clients;
  - the ADPOST Admin is denied the dashboard, insights and chat of VCA clients;
  - Super Admin can read them;
  - client dashboards never mix metrics;
  - the LIPSKY Client User reads only LIPSKY and only client-shared chats, has no approvals, and is denied CMS.
- [x] **Chart calculations:** 7/28/30/90-day KPIs equal the sum of the underlying rows; CTR and engagement are recomputed; channel and device splits sum to sessions.
- [x] **Report consistency:** report totals equal the dashboard for the same window; previous period, technical findings, recommendations and tasks are present.
- [x] **Exports:**
  - the CSV has the notice at the top and bottom and matching figures;
  - the PDF has the watermark, footer notice and matching figures.
- [x] **Chat scoping:**
  - 9 demo conversations per client, all on the client's demo website;
  - a CMS conversation cannot be read through LIPSKY;
  - agent replies are mode `simulated`;
  - executions cost $0.
- [x] **Simulated integrations:** sync appends history and never calls `fetch`; the failing demo connection stays failing.
- [x] **Approvals:** a simulated approval can be decided with no external delivery.
- [x] **UI, jsdom** (`pages/vcaDemo.test.tsx`):
  - the dashboard shows the notice and recalculates on 7d;
  - switching CMS → LIPSKY replaces the numbers and resets the range;
  - integrations show Simulated, "Sync now (simulated)" and the error;
  - Intelligence shows the score and its formula, plus the competitor list;
  - Reports show the notice, technical findings and tasks;
  - Agent Chat and Team Chat show the demo conversations.

## Browser (not run yet)
Two Chrome extensions were connected but neither accepted the connection request (timed out), so **no real visual check ran**. Do these before the presentation, signed in as `admin@vca.example.test`:
- [ ] CMS, LIPSKY, HLDC and LOOP19 dashboards.
- [ ] Website selection on the Dashboard, SEO Overview and Reports.
- [ ] SEO Overview, Insights (filter plus a status change), Intelligence.
- [ ] Reports: CSV and PDF export open correctly and show the notice and watermark.
- [ ] Agent Chat, Team Chat, Executions.
- [ ] Projects & tasks, Approvals, Knowledge, Integrations.
- [ ] Light mode and dark mode (the notice and bars use theme tokens).
- [ ] Desktop and mobile width (filters wrap; mobile navigation).
- [ ] Browser console free of errors.

## Not implemented / limitations
- **WordPress integration records** are not simulated: the demo websites' platform is "unknown", and the website records must not change. The real, read-only WordPress connector from v7 is unaffected.
- **Engagement by device** is not stored per day. The mobile-engagement figures quoted in chats are modelled from the simulated lab LCP and labelled simulated.
- **Search volume and keyword difficulty** do not exist in the app and are not invented.
- **Existing browsers:** if a browser loaded the demo before the final wording change, use "Reset demo data" to refresh that client's demo records.
