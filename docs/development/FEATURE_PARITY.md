# Feature Parity Matrix — Laravel/Inertia → Standalone React (ADPOST)

Legacy = existing Laravel/Inertia implementation (kept running, untouched).
New = `apps/adpost-web` standalone React app (local adapters until Phase 17).

Status: `—` not started · `local` implemented against local adapter · `live` verified against real backend

| Feature | Legacy source | New status | Notes |
|---------|---------------|------------|-------|
| Login / register / reset / verify | `pages/auth/*` | local (login, register); reset+verify → Supabase Auth (Phase 17) | open-redirect safe `?next` |
| Organization create / settings | `pages/organizations/*` | — | maps to Brand workspaces |
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
