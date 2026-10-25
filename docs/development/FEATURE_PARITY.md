# Feature Parity Matrix — Laravel/Inertia → Standalone React (ADPOST)

Legacy = existing Laravel/Inertia implementation (kept running, untouched).
New = `apps/adpost-web` standalone React app (local adapters until Phase 17).

Status: `—` not started · `local` implemented against local adapter · `live` verified against real backend

| Feature | Legacy source | New status | Notes |
|---------|---------------|------------|-------|
| Login / register / reset / verify | `pages/auth/*` | — | |
| Organization create / settings | `pages/organizations/*` | — | maps to Brand workspaces |
| Members + roles | `organizations/Members.tsx` | — | |
| Invitations (send/accept/cancel) | `InvitationController` | — | |
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
| Client-role portal restrictions | `AppLayout` + policies | — | |
| Tenant isolation | `SetActiveOrganization` + tests | — | RLS in Supabase plan |
