# ADPOST Edition — Phase Checklist

Status legend: `done` · `in-progress` · `todo` · `blocked`

The roadmap below comes from the ADPOST master development prompt (v3.0). It was not previously stored in the repo; this file is now its source of truth.

| Phase | Title | Status | Notes |
|-------|-------|--------|-------|
| 00 | Repository audit and recovery baseline | done | See MASTER_PROGRESS.md §Baseline |
| 01 | Architecture and migration design | done | ADR-001..008, SUPABASE_INTEGRATION_PLAN.md |
| 02 | Standalone React foundation | done | apps/adpost-web scaffold, UI kit, responsive shell, router |
| 03 | Local backend abstractions and Supabase schema preparation | done | domain types, access rules, local DB + scope, workspace/clients/websites repos, fixtures, SQL schema + RLS |
| 04 | Authentication and authorization interfaces | done | local auth (sign-in/register), session provider, RequireAuth/RequireCapability guards, members + invitations |
| 05 | ADPOST multi-brand workspaces | done | brand picker, agency brand creation, brand settings, brand switcher, isolation tests |
| 06 | Existing feature migration and parity | done | all legacy features ported against local adapter; see FEATURE_PARITY.md |
| 07 | AI agent registry | done | 6 templates, brand instances (auto-provisioned per brand), instruction versions + rollback, tool permissions, limits, simulated provider, execution engine, usage/cost, executions page |
| 08 | Individual AI agent chat | done | direct chat: conversations, history, composer, text attachments, search, rename/archive, retry, execution status, proposal cards |
| 09 | AI team collaboration and orchestration | done | SEO/Web/All teams, @mentions, lead-agent routing, bounded auto-handoffs (6 turns, depth 3, token budget, once per agent), inactive/outsider skip notes, deterministic summaries |
| 10 | Projects, tasks, and human approvals | in-progress | data layer done (projects, tasks, approvals, apply proposals); UI next |
| 11 | SEO intelligence and analytics | todo | |
| 12 | Web Design and Web Development workflows | todo | |
| 13 | Knowledge and brand memory | todo | |
| 14 | Local QA, security, and regression testing | todo | |
| 15 | Free-tier deployment preparation | todo | |
| 16 | Future subscription architecture | todo | |
| 17 | Real Supabase integration | blocked | Requires owner authorization + live project |
| 18 | Netlify deployment and pilot | blocked | Requires owner authorization |
