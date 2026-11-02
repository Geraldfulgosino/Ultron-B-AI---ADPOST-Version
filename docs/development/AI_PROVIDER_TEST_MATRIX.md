# AI Provider Test Matrix

Legend:
- **mock:** deterministic and runs in `npm test`. Providers are scripted or recorded-shape responses; no network.
- **pg:** real Postgres (PGlite) with the migrations.
- **staging:** Supabase staging. **live:** a real provider call.

Nothing in this matrix has run at the staging or live level for AI providers yet.

| Area | Case | Level | File |
|---|---|---|---|
| Connections | Create metadata, validate provider and slot, reject keys | mock, pg | `data/local/ai.test.ts`, `test/db/aiProviders.db.test.ts`, `pages/settings/aiSettings.test.tsx` |
| | Status only via the server test; rotate, disable and re-enable reset verification | mock, pg | same |
| | Invalid credentials, permission denied, credits, rate limit, unavailable | mock | `test/ai/seoTools.test.ts` (connection test), `test/ai/adapters.test.ts` |
| | Permission denial and brand isolation for connections | mock, pg | `ai.test.ts`, `aiProviders.db.test.ts` |
| | Revocation (remove blocked while assigned; disable fails runs) | mock | `ai.test.ts` |
| Routing | Override, assignment, brand and organization defaults, platform fallback | mock | `test/ai/routing.test.ts` |
| | Unsupported capability, model not reported, unverified connection | mock | `routing.test.ts` |
| | Cross-provider fallback consent (both levels) | mock, pg | `routing.test.ts`, `ai.test.ts`, `aiProviders.db.test.ts` |
| | Budget exceeded, token ceiling, per-request clamp, daily runs | mock | `routing.test.ts`, `execution.test.ts` |
| Chat | Real question reaches the model with platform rules and history | mock | `execution.test.ts`, `handlers.test.ts` |
| | Persistence of the record of what actually ran | mock | `execution.test.ts`, `ai.test.ts` |
| | Streaming events, cancellation, retry, no retry after streamed text | mock | `adapters.test.ts`, `execution.test.ts` |
| | Duplicate prevention (idempotency) | mock | `execution.test.ts`, `handlers.test.ts` |
| | Provider failure is never replaced by simulated text | mock | `execution.test.ts`, `ai.test.ts` |
| | Cross-brand access denial, not the author, read-only role, archived, rate limit | mock | `handlers.test.ts` |
| Team | Delegation, different providers per agent, consolidation | mock | `execution.test.ts` |
| | Depth, turn, token and cancellation limits; mentions; idempotency keys | mock | `execution.test.ts` |
| | Tool authorization (inactive teammate refused) | mock | `execution.test.ts` |
| SEO tools | Page audit, robots.txt, sitemap, llms.txt with evidence | mock | `seoTools.test.ts` |
| | Only brand hosts; private DNS refused (SSRF); untrusted wrapping | mock | `seoTools.test.ts`, `domain/urlSafety.test.ts` |
| | Prompt injection in a tool result cannot widen tools | mock | `execution.test.ts` |
| Security | No secrets in the client bundle or browser env | mock | `test/ai/bundleSecurity.test.ts` |
| | No credential column; users cannot forge usage, health or audit | pg | `aiProviders.db.test.ts` |
| | Keys never in prompts, outcomes or errors | mock | `execution.test.ts`, `handlers.test.ts`, `adapters.test.ts` |
| Staging | Migration 0007, RLS of the AI tables through PostgREST, function deploy | staging | **pending approval** |
| Live (Milestone 13) | One Anthropic request; one OpenAI request; switching; persistence; specialization; one bounded team delegation | live | **pending credentials, budget and approval** |
