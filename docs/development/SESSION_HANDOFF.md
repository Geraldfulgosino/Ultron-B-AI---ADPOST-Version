# Session Handoff

**Updated:** 2026-11-02 (master prompt v5.0: AI provider connection manager)
**Project root:** `C:\LUGENIX\AI AGENTS\ULTRON B AI - ADPOST\ultron-b-ai-sprint-16-client-dashboard-reporting-production`
**Branch:** `feature/adpost-react-supabase-ai` (pushed; `main` untouched at `13bc3d0`)
**Supabase:** `adpost-staging`, ref `ppwkxlwxzutigepaizob`; the CLI 2.121.0 is logged in and linked (`supabase/.temp/` is git-ignored).
**Applied to staging:** migrations 0001–0005. **Local only, awaiting approval:** 0006_advisor_fixes, 0007_ai_providers.
**Deployed Edge Functions:** none. `agent-execute` and `ai-connection-test` are implemented, not deployed.
**Last synced commit:** see GITHUB_SYNC_LOG.md

## Where things are
- Settings UI: `apps/adpost-web/src/pages/settings/AiSettingsPages.tsx`. Routes `/b/:slug/settings/ai-providers[/new|/:id]`, `ai-models`, `ai-routing`, `ai-usage`.
- Contract: `AiProvidersApi` (`api().ai`). Mock adapter: `src/data/local/ai.ts`.
- Shared server runtime: `supabase/functions/_shared/ai/*`, tested from `apps/adpost-web/src/test/ai/*`.
- Docs:
  - AI_PROVIDER_ARCHITECTURE, AI_PROVIDER_CONNECTIONS, AI_MODEL_ROUTING;
  - AI_CREDENTIAL_SECURITY, AI_CHAT_RUNTIME, AI_USAGE_BUDGETS;
  - AI_PROVIDER_TEST_MATRIX.

## Status
| Item | State |
|---|---|
| Provider schema + RLS (0007) | Implemented, locally tested (PGlite). **Awaiting approval** for staging |
| Settings UI, routing, usage | Implemented, tested on the mock adapter |
| Anthropic / OpenAI adapters | Implemented, tested with simulated responses. **No live call** |
| agent-execute / ai-connection-test | Implemented, handler-tested. **Not deployed** |
| Team orchestration, SEO tools, budgets | Implemented, mock-tested |
| Supabase auth adapter (17E), chat/data adapters (17F) | Not implemented. Needed before the deployed functions are reachable from the UI |

## Tests
425 passed + 1 opt-in, all mock or local Postgres. No staging test of the AI tables; no live provider call.

## Owner decisions needed
1. **Staging changes:** approve applying 0006 + 0007, and deploying `agent-execute` + `ai-connection-test` to `adpost-staging`. Separate approvals are fine.
2. **Provider accounts:** create Anthropic Console and/or OpenAI Platform API accounts (separate billing; subscriptions do not count) with provider-side spend limits. Then, from your own terminal, run `supabase secrets set ANTHROPIC_API_KEY=… OPENAI_API_KEY=…`. Never paste keys in chat.
3. **Budget for Milestone 13 smoke tests:**
   - one Anthropic request;
   - one OpenAI request;
   - switching;
   - one bounded team delegation.

   Suggested: a 256-token cap and a $1 provider limit.
4. **Staging test users** (unchanged): allow sign-up-API test users, or create them in the dashboard.

## Next exact task (no approval needed)
Build the Supabase auth adapter (17E) and the chat adapter (17F):
- `send` inserts the user message through PostgREST, then calls `agent-execute` with `stream: true` and a fresh idempotency key;
- add the Stop button (abort), the streaming indicator and the budget banner in ChatView.

Then point `AiProvidersApi.testConnection` at `ai-connection-test` in Supabase mode.
