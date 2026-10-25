local | enforced in data layer (Scope) + tests; RLS prepared || host-only storage, no network; dispatch = Edge Function || dependency-free text PDF; server render optional later || legacy layout + formula-injection guard || source GA4/GSC/all, website, date range, executive summary || 5 rule types, dedupe by subject, review/approve/dismiss/reopen, bulk || date/website filters; queries/pages in weekly buckets || 28-day KPIs vs previous, trends, insights, integration health || connect → pending; OAuth + real sync = Edge Functions (Phase 17) || domain normalised; client must belong to brand || admin-only delete cascades websites || Feature | Legacy source | New status | Notes |
|---------|---------------|------------|-------|
| Login / register / reset / verify | `pages/auth/*` | local (login, register); reset+verify → Supabase Auth (Phase 17) | open-redirect safe `?next` |
| Organization create / settings | `pages/organizations/*` | local | Brand workspaces: agency creates brands; owners/admins edit settings; slug stable |
| Members + roles | `organizations/Members.tsx` | local | last-owner guard, admins cannot mint owners |
| Invitations (send/accept/cancel) | `InvitationController` | local | 7-day expiry, email match on accept; email delivery → Edge Function |
| Clients CRUD | `pages/clients/Index.tsx` | — | |
| Websites CRUD | `pages/websites/Index.tsx` | — | |
| Integrations (GA4/GSC OAuth, sync) | `pages/integrations/Index.tsx` | — | OAuth stays server-side |
| Dashboard metrics | `pages/Dashboard.tsx` | — | |
| SEO dashboard (KPIs, pages, queries) | `pages/seo/Index.tsx` | — | |
| SEO insights review workflow | `pages/seo/Insights*.tsx` | — | |
| Reports preview + filters | `pages/reports/Index.tsx` | — | |
| CSV export | `ReportExportController` | — | |
| PDF export | `ReportPdfExportController` | — | |
| n8n connection + deliveries | `N8nConnectionController` | — | |
| Client-role portal restrictions | `AppLayout` + policies | local | data-layer client scoping + nav + route guard |
| Tenant isolation | `SetActiveOrganization` + tests | — | RLS in Supabase plan |
