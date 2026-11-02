# AI Provider Architecture

Status (2026-11-02): **implemented and locally tested. Not deployed, and no live provider has been called.** See the status table at the end.

## Goal
Administrators connect authorized AI providers and assign them to agents in **Settings → AI Providers / Agent routing**. Switching an agent's provider or model is a data change: no code edit, environment change, rebuild, restart, prompt rewrite or new conversation.

## Layers
| Layer | Where | Notes |
|---|---|---|
| Settings UI | `apps/adpost-web/src/pages/settings/AiSettingsPages.tsx` | Providers, connection detail, models, agent routing, usage |
| Contract | `src/data/contracts.ts` → `AiProvidersApi` (`api().ai`) | The UI depends only on this |
| Local adapter | `src/data/local/ai.ts` | Mock mode. Mirrors the RLS in migration 0007; stores no credential, calls no provider |
| Schema + RLS | `supabase/migrations/20261102000007_ai_providers.sql` | **Not applied** to staging (awaiting approval) |
| Shared runtime | `supabase/functions/_shared/ai/*` | Pure TypeScript; the same files run in Deno and Vitest |
| Edge Functions | `supabase/functions/agent-execute`, `supabase/functions/ai-connection-test` | **Not deployed** |

## Shared runtime modules (names from the master prompt)
| Service | File | Responsibility |
|---|---|---|
| `AIProviderAdapter` | `types.ts` | Normalized interface: `stream()` and `listModels()` |
| Anthropic adapter | `anthropic.ts` | Messages API with SSE streaming, `tool_use` / `tool_result` blocks, provider-reported usage, `request-id` |
| OpenAI adapter | `openai.ts` | Chat Completions with SSE and `stream_options.include_usage`; indexed tool-call fragments; `response_format` JSON mode; org/project headers |
| `AIProviderRegistry` + `AISecretResolver` | `registry.ts` | Adapters by provider code; allow-listed secret slots that must match the provider |
| `AIModelRoutingService` | `routing.ts` | Priority resolution, scope and health checks, capability check, fallback plan |
| `AIUsageService` (budgets) | `budget.ts` | Worst-case pre-call checks; verified-price cost; token ceilings |
| `AIToolGateway` | `tools.ts` | Per-agent tool permission, proposals, untrusted wrapping |
| SEO skills | `seoTools.ts` | Page audit, robots.txt, sitemap, llms.txt through `safeFetch` |
| `AIExecutionService` | `execution.ts` | One agent turn: route, budget, call, tool rounds, retries, fallback, record |
| Team orchestration | `orchestrator.ts` | Bounded multi-agent delegation and consolidation |
| `AIConnectionService` (test) | `connectionTest.ts` | Free model-listing check |
| Edge handlers + data | `handlers.ts`, `supabaseData.ts`, `../edge.ts` | Caller verification and Supabase persistence |
| `AIAuditService` | DB trigger `app.ai_audit()` and local `aiAudit` | Who changed which columns, never values |

## Why `fetch` instead of the official SDKs
The adapters call the documented REST endpoints directly:
- The identical module runs in Deno Edge Functions and in Vitest.
- Credentials can only reach two fixed origins (`assertAllowedUrl`).
- `redirect: 'error'` stops credentials from following a redirect.
- No new dependencies were added.

The cost of this choice: request and response shapes are maintained here, and the adapter tests pin them.

## Provider differences handled at the adapter boundary
| | Anthropic | OpenAI |
|---|---|---|
| System prompt | top-level `system` | first `system` message |
| Output cap | `max_tokens` | `max_completion_tokens` |
| Tools | `tools[].input_schema`; assistant `tool_use`, user `tool_result` blocks | `tools[].function.parameters`; assistant `tool_calls`; role `tool` |
| Streaming | typed SSE events (`message_start` … `message_stop`) | `data:` chunks ending with `[DONE]`; usage in the final chunk |
| Structured output | instruction in the system prompt | `response_format: json_object` |
| Request id | `request-id` header | `x-request-id` header |
| Errors | `error.type` (authentication, permission, rate_limit, overloaded, invalid_request …) | `error.code` (`invalid_api_key`, `insufficient_quota`, `context_length_exceeded`, …) |

Both map to the same `AIErrorCategory` set (`errors.ts`), and messages are sanitized.

## Not supported, by design
- Reusing Claude.ai, Claude Code, ChatGPT or Codex subscriptions or sign-ins.
- Token, cookie or cache extraction.
- Unofficial OAuth.
- Shared passwords.

The UI says so on every provider page. No OAuth button is shown, because neither provider offers delegated OAuth for this use.

## Status
| Item | Implemented | Locally tested | Staging verified | Live API verified |
|---|---|---|---|---|
| Schema + RLS (0007) | yes | yes (19 DB tests) | no (awaiting approval) | n/a |
| Settings UI + local adapter | yes | yes (13 adapter + 7 UI tests) | no | n/a |
| Anthropic adapter | yes | yes (simulated responses) | no | **no** (awaiting credentials) |
| OpenAI adapter | yes | yes (simulated responses) | no | **no** (awaiting credentials) |
| Routing, budgets, execution, orchestration | yes | yes | no | no |
| Edge Functions | yes | handlers tested with a fake data layer | **not deployed** | no |
