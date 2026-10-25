# Feature Parity Matrix: Laravel/Inertia → Standalone React (ADPOST)

Legacy = the existing Laravel/Inertia implementation (kept running, untouched).
New = the `apps/adpost-web` standalone React app (local adapters until Phase 17).

Status: `—` not started · `local` implemented against the local adapter · `local (simulated)` UI and data flow done, external side effect simulated · `live` verified against a real backend

| Feature | Legacy source | New status | Notes |
|---------|---------------|------------|-------|
| Login / register / reset / verify | `pages/auth/*` | local (login, register); reset + verify → Supabase Auth (Phase 17) | `?next` redirect is safe against open redirects |
| Organization create / settings | `pages/organizations/*` | local | Brand workspaces: agency creates brands; owners/admins edit settings; slug stays fixed |
| Members + roles | `organizations/Members.tsx` | local | Last-owner guard; admins cannot grant the owner role |
| Invitations (send/accept/cancel) | `InvitationController` | local | 7-day expiry, email must match on accept; email delivery → Edge Function |
| Clients CRUD | `pages/clients/Index.tsx` | local | Admin-only delete, which also deletes the client's websites |
| Websites CRUD | `pages/websites/Index.tsx` | local | Domain normalised; client must belong to the brand |
| Integrations (GA4/GSC OAuth, sync) | `pages/integrations/Index.tsx` | local (simulated) | Connect creates a pending record; OAuth + real sync = Edge Functions (Phase 17) |
| Dashboard metrics | `pages/Dashboard.tsx` | local | 28-day KPIs vs the previous 28 days, trends, insights, integration health |
| SEO dashboard (KPIs, pages, queries) | `pages/seo/Index.tsx` | local | Date and website filters; queries/pages stored in weekly buckets |
| SEO insights review workflow | `pages/seo/Insights*.tsx` | local | 5 rule types, deduplicated by subject; review/approve/dismiss/reopen, bulk actions |
| Reports preview + filters | `pages/reports/Index.tsx` | local | Source GA4/GSC/all, website, date range, executive summary |
| CSV export | `ReportExportController` | local | Legacy layout + spreadsheet formula-injection guard |
| PDF export | `ReportPdfExportController` | local | Dependency-free text PDF; server-side rendering is an option later |
| n8n connection + deliveries | `N8nConnectionController` | local (simulated) | Only the webhook host is stored; no network calls; dispatch = Edge Function |
| Client-role portal restrictions | `AppLayout` + policies | local | Client scoping in the data layer, plus nav filtering and route guard |
| Tenant isolation | `SetActiveOrganization` + tests | local | Enforced in the data layer (Scope) with tests; RLS prepared |

## Known deviations from legacy
- Search queries and landing pages are stored in weekly buckets, not daily rows, to keep local storage small. The Supabase schema keeps `metric_date`, so daily rows remain possible.
- Ranking-opportunity insights are capped at the 3 highest-impression queries per website; legacy raised one per qualifying query.
- The traffic-drop rule works on website-level clicks, because the local data has no per-page GSC rows.
