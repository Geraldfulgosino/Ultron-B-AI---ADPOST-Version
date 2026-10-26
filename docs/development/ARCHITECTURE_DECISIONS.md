# Architecture Decisions — ADPOST Edition

## ADR-001 Standalone app lives beside Laravel, not inside it
**Decision:** New React app at `apps/adpost-web/` with its own `package.json`, Vite config, tsconfig and tests. The Laravel/Inertia app (`resources/js`, root `package.json`, `vite.config.ts`) is not modified.
**Why:** No PHP/Docker on the dev host (B-001) means Laravel changes can't be verified. A separate app avoids Inertia/Ziggy coupling and lets the legacy app keep running until parity is live-verified (ADR-007).
**Stack:** React 19, TypeScript (strict), Vite, Tailwind v4, `react-router` v7, Vitest + Testing Library + jsdom. UI primitives are ported from `resources/js/components/ui` (same Tailwind classes) so the design stays consistent.

## ADR-002 Tenancy: Agency → Brand
**Decision:**
- `agency`: the operating company (ADPOST). One row today; supports more later (Phase 16 SaaS).
- `brand`: **the tenant boundary.** ADPOST itself, POD, DMD, FMF and Urban Rest are each a brand. Every brand-owned row carries `brand_id` (the successor to legacy `organization_id`).
- `brand_membership`: a user's role in one brand: `owner | admin | manager | member | viewer | client`. Matches the legacy `MemberRole` plus `client`.
- `agency_membership`: `agency_owner | agency_admin`. Grants access to every brand in the agency. This is how ADPOST staff oversee all managed brands.
- Legacy mapping: Organization → Brand, Client → Client (inside a brand), Website → Website (inside a brand).

**Why:** Each brand needs its own employees, memberships, AI config, knowledge, analytics and history, which is exactly the legacy organization semantics. The agency layer adds cross-brand oversight without weakening per-brand isolation.

## ADR-003 Repository contracts + adapters; authorization in the data layer
**Decision:** UI code depends only on contracts in `src/data/contracts.ts`. `src/data/local/` implements them in memory, seeded from synthetic fixtures and optionally persisted to `localStorage` for dev. Supabase adapters (Phase 17) implement the same contracts.
Every repository call receives the `Session` (user + memberships). The **local adapter enforces the same rules the RLS policies will** (`src/data/access.ts`), so a brand mismatch throws `AccessDeniedError` whatever the UI does. The UI hiding things is UX only, never security.
**Why:** It lets tenant-isolation tests run today and gives Phase 17 a 1:1 rulebook for RLS.

## ADR-004 AI provider boundary
**Decision:** `LlmProvider` interface (`complete(request) → response`). `SimulatedProvider` is deterministic: a seeded hash of agent + prompt, no network. Every response carries `mode: 'simulated' | 'live'` and the UI labels simulated output. Live providers run **only** in a server-side Edge Function (`agent-execute`). The browser never sees model keys.
Agents are defined by six reusable **templates** (SEO Manager, Technical SEO, Content SEO, Statistics SEO, Web Design, Web Development). A brand has **agent instances** that reference a template and add brand overrides: active flag, model, instruction version, tool permissions, limits.
**Why:** Offline development works, cost and limits are enforceable at one choke point, and secrets stay server-side.

## ADR-005 Routing
**Decision:** `/login`, `/brands` (picker), `/b/:brandSlug/<section>`. A brand route resolves the slug against session memberships; an unknown or unauthorized slug renders a 403 page. Agency admins can open any brand in their agency.

## ADR-006 Testing
**Decision:** Vitest for unit tests (repositories, access rules, orchestration, simulated provider) and component tests (Testing Library). Every brand-owned repository gets a **tenant isolation test**: two brands, user of brand A denied brand B reads and writes. `npm run typecheck`, `npm test` and `npm run build` in `apps/adpost-web` must pass before each commit.

## ADR-007 Legacy coexistence
**Decision:** Laravel stays the system of record until Phase 17 proves the Supabase path live. Nothing in `app/`, `routes/`, `database/` or `resources/` is deleted. FEATURE_PARITY.md tracks progress.

## ADR-008 Orchestration limits
**Decision:** Group-chat orchestration runs as a bounded loop: max agent turns per human message (default 6), max handoff depth (3), and a per-brand token budget per run. Agents mention one another with `@handle`. Mentions to inactive agents are skipped and logged. Actions with external effects (publish, webhook, deploy) become **approval requests**, never direct execution.

## ADR-009 Theming (light / dark / system)
**Decision:** Colors come from semantic CSS tokens in `src/index.css` (`--canvas`, `--surface`, `--fg*`, `--line*`, `--accent*`, status `--success*/--warning*/--danger*/--info*`, `--chart-series`), exposed to Tailwind 4 through `@theme inline` as utilities such as `bg-surface` and `text-fg-muted`. Light values equal the grays and tints used before, so light mode is unchanged. `:root[data-theme=dark]` redefines every token. `ThemeProvider` (`src/theme`) resolves the preference (`light` | `dark` | `system`; default `system`), sets `data-theme` and `color-scheme` on `<html>`, and follows OS changes only in system mode. `public/theme-init.js` applies the theme before React loads, to avoid a flash; it is a file rather than an inline script so the CSP keeps `script-src 'self'`. The preference goes through a `ThemePreferenceStore` interface: localStorage now, a Supabase profile column later (Phase 17). Only the preference string is stored.
**Rules:** New UI uses the tokens, never `gray-*` or `bg-white`. `src/theme/tokens.test.tsx` fails the build on hard-coded light-only classes and on any light token without a dark value. The sidebar is dark in both themes by design.
