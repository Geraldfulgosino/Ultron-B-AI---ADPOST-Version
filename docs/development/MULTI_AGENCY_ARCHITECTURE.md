# Multi-Agency, Client and Website Architecture

Status (2026-11-05):
- **Implemented and tested locally.** Migration 0008 and the dev seed run on PGlite only.
- **Not applied to staging**, which needs owner approval.
- Commits `0841ef1`, `606a78a` and `f0254cd` are local and **not pushed**, as instructed.

## 1. Hierarchy and mapping (owner-confirmed 2026-11-05)
`Platform → Agency (agencies) → Client (brands) → Website (websites)`

- The product term **Client** is the existing `brands` table.
  - Every brand-scoped RLS policy, agent, chat, knowledge document, storage path and AI assignment therefore already isolates clients.
  - This reuses the 38 checks verified on staging instead of re-keying 25 tables.
- The older inner `clients` table is **optional and hidden**. It remains for client-portal users and legacy rows. `websites.client_id`, integrations and analytics may omit it, and rows without it are invisible to client-portal users.
- Nothing is dropped and no existing policy is weakened.

## 2. Database (migration `20261105000008_agency_client_website.sql`)
| Entity | Added |
|---|---|
| `platform_admins` | New table, written by migration or service role only. Users can read only their own row |
| `agencies` | description, logo_url (https), status (active/inactive/archived), timezone, default_currency, contact_email, updated_at, archived_at; slug format; archived ⇔ archived_at |
| `agency_memberships` | role `agency_manager`; `job_function` |
| `brands` (clients) | display_name, industry, logo_url, primary contact name and email, `inactive` status, archived_at; slug format; **unique (agency_id, slug)** instead of global; a client cannot move agency |
| `brand_memberships` | `job_function` (client_manager, seo_specialist, web_developer, employee, other); grants **nothing** |
| `websites` | website_url (normalized http(s), no credentials), nullable domain (derived from the URL), environment (production/staging/development), platform `unknown` (default), is_primary (one per client, enforced by a partial unique index and a trigger), description, `inactive` status, archived_at; client_id nullable |
| `conversations` | `website_id`; a trigger requires it to be the same client's website |
| RPCs | `create_agency` (platform admins; creator becomes owner), `create_client` (agency owners and admins; provisions the six agents), `platform_overview` (counts only) |
| Helpers | `is_platform_admin`, `is_agency_manager`, `is_agency_admin_for_agency` (in 0007), `website_is_auditable`, `provision_brand_agents` |

Migration 0007 (also unapplied) now limits AI credential and organization-policy management to agency **owners and admins**; managers are excluded.

## 3. Roles and permissions
| Requested role | Implementation | Read | Write | Administer client | Add clients | Agency status | AI credentials |
|---|---|---|---|---|---|---|---|
| Platform administrator | `platform_admins` | agency directory and totals only | — | — | — | yes | — |
| Agency administrator | `agency_owner` / `agency_admin` | all agency clients | yes | yes | yes | — | yes |
| Agency manager | `agency_manager` (new) | all agency clients | yes | no | no | — | no |
| Client manager | brand `admin` or `manager` (+ job function) | client | yes | admin only | no | — | no |
| SEO specialist, web developer, employee | brand `member` + job function | client | yes | no | no | — | no |
| Viewer | brand `viewer` | client | no | no | no | — | no |
| Client portal | brand `client` (+ legacy client_id) | own rows | no | no | no | — | no |

Users can belong to several agencies and have different roles per client. No agency role reaches another agency.

## 4. Sample data (development only)
- SQL: `supabase/seeds/dev/sample_hierarchy.sql`.
  - Idempotent, keyed by slugs; it never updates or deletes.
  - **Refuses to run** unless `set app.allow_dev_seed = 'on'`.
- Local app: `src/data/local/sampleSeed.ts`, the same records.
- Contents:
  - **ADPOST:** POD, DSP, FMF, TRADE BAGS, STUDIO PILATES.
  - **VCA:** LIPSKY, HAMPTONS, CMS, LOOP19.
  - **Lugenix Digital Services:** GoldStar ATM.
  - All active, each with its six agents on the simulated model.
- **No** websites, domains, contacts, analytics, insights, knowledge, integrations or credentials.
- The local app has synthetic sign-in accounts for exploring roles (example.test addresses; local mode only; nothing is sent to them). They are listed on the login page.
- The synthetic 90-day analytics remain **only** in the test fixtures (`fixtures.ts`), per the owner's decision.

## 5. UI and routes
| Route | Page |
|---|---|
| `/agencies` | Directory. Search, status filter, platform totals. Platform admins add, archive and restore agencies |
| `/a/:agency` | Agency overview: counts of stored records, "Not connected" for analytics |
| `/a/:agency/clients` | Clients: add, edit, archive, restore, search, status filter, websites/projects/tasks/integrations columns, "Add website" for clients without one |
| `/a/:agency/settings` | Agency profile (owners/admins); status (platform admins) |
| `/a/:agency/c/:client/...` | Client workspace (all existing pages) |
| `/a/:agency/c/:client/websites[/:id]` | Website list and detail: details, integrations, SEO, audit, projects, reports, each with honest empty states |
| `/b/:client/...` | Legacy links: redirect when the slug is unambiguous |

No page offers permanent deletion of agencies or clients.

## 6. Workspace selector (`WorkspaceSelector.tsx`)
- **Agency → Client → Website scope**:
  - Changing the agency goes to the agency overview, so the client resets.
  - Changing the client goes to its dashboard, so the website resets.
- The website scope is kept per client in `?website=` and sessionStorage. An id that is not one of the client's current websites is ignored.
- Data queries discard responses that arrive after the context changed, so no stale data from the previous client is shown.
- The selector is UX only. The data layer (RLS and the local Scope) authorizes every request.

## 7. AI agent scope
- **Client-level:** agents are per client. Chats, knowledge and AI routing are brand-scoped. The system prompt states the client boundary.
- **Website-level:** a conversation may be scoped to one website. New chats inherit the selected website.
  - Local agent context (analytics, queries, insights) is limited to it.
  - Server SEO tools may fetch only **active websites with a URL**, and only the scoped one.
  - Drafts are never fetched.
- The AI provider system is unchanged. Connections stay agency-level, are never shared across agencies, and are managed by agency owners and admins only.
- **Agency-level AI team (cross-client): not implemented yet.** It needs an agency-scoped conversation model with an explicit list of participating clients and agency-level authorization. Today no conversation can read more than one client.

## 8. Dashboards
- **Platform:** agencies, clients, websites, users, AI requests this month, integration health.
- **Agency:** clients, websites (and how many lack a URL), active projects, open tasks, AI runs this month, integration states.
- **Client:** the existing dashboard, with the legacy inner-client count removed.
- **Website:** detail page.

All numbers are counts of stored records. Analytics show "Not connected" or "No data" until a real integration syncs.

## 9. Tests
| Suite | What it covers |
|---|---|
| `src/test/db/hierarchy.db.test.ts` (PGlite, 15) | Seed exact counts and idempotency; seed refuses without opt-in; agency create, status and edit permissions; client creation, per-agency slugs, archive/restore; cross-agency and cross-client reads and writes; manager limits; manipulated brand, client and website ids; job functions; URL validation and normalization; primary website; auditability |
| `src/data/local/agencies.test.ts` (11) | The same rules on the local adapter against the sample seed |
| `src/pages/agencies/agencies.test.tsx` (12) | Directory, exact client lists per agency, add/duplicate/archive/restore, manager and member views, selector resets, website draft and primary, website detail empty states, legacy redirect |
| `src/data/local/chatScope.test.ts` (2), `src/test/ai/handlers.test.ts` (+3) | Website-scoped conversations, context and tool hosts |

## 10. Known limitations and next milestones
1. **Staging:** applying 0006, 0007 and 0008 (and optionally the dev seed) needs owner approval. The Supabase data adapters are still pending, so the UI runs on the local adapter.
2. Agency-level cross-client AI team and reports (see §7).
3. Agency membership management UI (invite agency admins and managers). Agency memberships are seed or service-role only today.
4. Website-level filters are wired into chat. SEO, reports and intelligence pages still use their own website filter, which reads `?website=` only where it already existed.
5. WordPress and other platform integrations do not exist; only GA4 and GSC are modelled.
6. Archived agencies and clients are read-write for admins, so they can restore them. A read-only archive mode would need an extra policy.
7. One test failed once during the baseline run and was not reproduced in later runs. It is under observation.

## 11. Subscription readiness (not enforced)
- `agencies.plan_key` and `src/domain/plans.ts` already model per-agency plans: client limit (`maxBrands`), members, agent runs, knowledge bytes and features.
- Website, storage and team limits and per-agency metering can hang off `agency_id` without schema changes to clients.
- No billing, payment gateway or artificial limits are active.
- Independent agency deployments are possible because every tenant row resolves to one agency.
