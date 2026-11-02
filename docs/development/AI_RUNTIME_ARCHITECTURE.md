# AI Runtime Architecture

Status: **implemented (shared runtime + Edge Functions, see AI_PROVIDER_ARCHITECTURE.md), tested with simulated providers only; not deployed; no live model call has been made.** The local mock engine (`src/data/local/engine.ts`, `orchestrator.ts`) is the reference behaviour and stays as mock mode. No model API credentials are authorized, so no live AI request has been made.

## Request path (chat message → agent reply)
1. The browser inserts the user message through PostgREST. RLS checks it (`messages_insert`: author = caller, brand writable, no forged proposals).
2. The browser calls the Edge Function `agent-execute` with `{ conversationId, messageId, idempotencyKey }` and the user's JWT. **No model keys exist in the browser.**
3. The function creates a Supabase client **with the caller's JWT**, so every read is RLS-filtered as that user. It re-reads the message, conversation, agent instance and active instruction version. It never trusts ids or brand from the body without that re-read.
4. Guardrails, before spending anything:
   - The agent is active and in the conversation.
   - The model is on the allow-list.
   - Per-agent `max_runs_per_day` and `monthly_budget_usd`, plus the per-brand budget and per-user rate limit.
   - Input-token budget and output cap (`max_output_tokens`).
   - Duplicate `idempotencyKey` returns the existing execution.
5. Context assembly:
   - System prompt = template instructions + brand instruction version.
   - The last N messages of this conversation.
   - Top-k brand knowledge chunks, using FTS now and pgvector later, RLS-filtered.
   - Connected analytics summaries, labelled with source and freshness.

   Retrieved and fetched content is wrapped as **untrusted data**.
6. The provider adapter (`AI_MODEL_PROVIDER_PLAN.md`) streams to the client via SSE.
7. Using the **service role inside the function only**, it writes the `agent_executions` row (status, mode `live`, provider, model, instruction version, tokens and cost) and the agent `messages` row (`author_type='agent'`, `execution_id`). Proposals (tasks, approvals, handoffs) are stored on the message and applied only by a human (RLS: agent-attributed tasks require an agent message).
8. Realtime delivers the new message and execution status to subscribers whose SELECT policy allows it.

## Team chat (orchestrate-group)
- Same as above. The lead agent's reply may contain `@handle` handoffs. The orchestrator runs them breadth-first within ADR-008 bounds: **at most 6 agent replies per user message and a handoff depth of at most 3**, plus a token and cost ceiling per user message. Cancellation is possible through the execution row.
- Agents never approve; `request_approval` creates a pending approval that only a human admin can decide (RLS-enforced, staging-verified).

## Execution classes
| Class | Where | Examples | Limits |
|---|---|---|---|
| Short | Edge Function | chat turn, single-page audit, robots/sitemap checks | ≤ ~60 s wall time, ≤ 5 pages |
| Long | Durable worker (**not provisioned**, needs paid infra approval) | site crawls, headless rendering, batch indexing, drift | queue with job id, owner, status, lease + heartbeat, retries, dead-letter, cancellation, cost cap |

Planned queue table: `jobs(id, brand_id, kind, status, requested_by, idempotency_key, attempts, lease_until, heartbeat_at, cost_cap_usd, result, error)`. It needs a separate migration approval.

## Truthfulness rules
- Executions record `mode` (`simulated`/`live`) and the UI shows it, as it already does with the "Simulated" badge.
- Unknown model prices show as "unknown cost" and are never estimated from guessed rates.
- Third-party metrics appear only when an authorized source returned them, with source and timestamp.
