# AI Model Provider Plan

Status: **adapters implemented and mock-tested (see AI_PROVIDER_ARCHITECTURE.md); not connected to any account.** A Claude Code subscription does **not** grant Anthropic API access. Live execution needs an API account (Anthropic Console and/or OpenAI) that the owner authorizes, with spending limits set at the provider.

## Interface (server-side only, in the Edge Function)
```ts
interface ModelProvider {
  id: 'anthropic' | 'openai';
  stream(req: { model: string; system: string; messages: ChatTurn[]; maxOutputTokens: number; signal: AbortSignal }):
    AsyncIterable<{ type: 'text'; text: string } | { type: 'usage'; inputTokens: number; outputTokens: number } | { type: 'error'; retryable: boolean; message: string }>;
}
```
- Adapters: `anthropic` (Messages API, streaming) and `openai` (Chat Completions/Responses, streaming). Others only when justified.
- Errors: 429/5xx/timeouts are retryable with backoff (at most 2 retries, same idempotency key). 4xx validation errors are not retried. Provider messages are logged without request bodies.
- Timeouts: 60 s per turn; the client's "stop generation" aborts the signal.

## Secrets
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` live **only** in `supabase secrets` and are read by Edge Functions. Never in `VITE_*`, the repo, logs or responses. The UI shows only "configured / not configured".

## Models and prices
- Allow-list per brand (admin-editable). Default model ids are chosen when the account is connected, from the provider's current model list, not hard-coded guesses.
- Prices: `MODEL_CATALOG` rates stay `null` (unknown) until the owner enters authoritative prices. Cost displays "unknown" rather than an estimate.

## First live test (needs owner authorization and spend)
One SEO Manager reply on a staging brand with a 256-token cap. Verify the streamed text, the `agent_executions` row (mode `live`, tokens), the message persistence and Realtime delivery. Record it in TEST_RESULTS.md; only then mark live chat "verified on staging".
