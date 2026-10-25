# adpost-web: ULTRON-B AI, ADPOST Edition

A standalone React 19 + TypeScript + Vite + Tailwind v4 app for ADPOST's multi-brand AI operations. It runs **fully local** on a typed in-memory adapter with synthetic data. No Supabase connection and no LLM keys are needed. Every AI reply is produced by a deterministic **simulated** provider and labelled as such.

```bash
cd apps/adpost-web
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (unit, component, tenant-isolation, contract)
npm run typecheck
npm run build
npm run gen:sql    # regenerate supabase agent_templates seed from TS
```

## Dev accounts (synthetic)
Password for all: `adpost-dev`. The sign-in page also lists them and has a "Reset local demo data" button.

| Email | Role |
|-------|------|
| alex@adpost.example.test | Agency owner: all brands, can create brands |
| morgan@adpost.example.test | ADPOST admin + POD manager |
| priya@pod.example.test | POD owner |
| dana@dmd.example.test | DMD manager |
| vic@pod.example.test | POD viewer (read-only) |
| casey@client.example.test | POD client portal (one client only) |

## What's inside
- **Brands:** ADPOST, POD, DMD, FMF, Urban Rest, each an isolated tenant with its own members, websites, agents, knowledge, chats and history.
- **Legacy parity:** dashboard, clients, websites, integrations (simulated sync), SEO overview, insights review, reports with CSV/PDF export, n8n automation (simulated deliveries).
- **AI workforce:** six specialists per brand (SEO Manager, Technical/Content/Statistics SEO, Web Design, Web Development) with versioned instructions, tool permissions, limits and cost tracking.
- **Chat:** one-to-one agent chat; team chat with bounded orchestration and auto-handoffs. Proposed tasks and approvals stay proposals until a person applies them.
- **Work:** projects and a task board, plus an approvals queue (no self-approval).
- **SEO Intelligence:** anomalies, click opportunities, website comparison.
- **Web Studio:** brief → design → development → checklist → approval → recorded release.
- **Knowledge:** documents, text uploads and BM25 retrieval used to ground agents.
- **Plans:** subscription entitlements (ADPOST is on the unlimited internal plan).

## Important
Local mode is a **simulation**: its auth and data live in the browser and provide no security boundary (see `docs/development/SECURITY_REVIEW.md`). Never use real customer data here. Real enforcement arrives with Supabase Auth + RLS in Phase 17.

The legacy Laravel/Inertia app in the repo root is untouched and still runs as before.
