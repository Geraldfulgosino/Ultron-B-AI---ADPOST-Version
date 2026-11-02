# AI Model Routing

Implemented in `supabase/functions/_shared/ai/routing.ts` for the server, and in `localRouteFor` in `src/data/local/ai.ts` for mock mode.

## Priority
1. Authorized conversation override (brand admins only; an unauthorized override is refused, not ignored)
2. Agent assignment (`ai_agent_model_assignments`, enabled)
3. Brand default (`ai_routing_policies` with `brand_id` = the brand)
4. Organization default (`ai_routing_policies` with `brand_id` null; must be an organization-wide connection)
5. Approved platform fallback (optional, explicitly configured; none by default)

The **first configured level wins**. If that target is unusable, the turn **fails visibly**. It never drops silently to a lower level, because that could send company data to a provider nobody chose for the agent.

## Target validation (every turn, on the server)
- The connection exists, belongs to the same agency, and is organization-wide or this brand's.
- It is enabled and **verified**: `connected`, or `configured`/`connected` for the simulator.
- When the connection has a verified model list, the model must be on it.
- Capabilities:
  - `text` is always required.
  - `tools` is offered only when the adapter supports it **and** the model catalog confirms it for that model.
  - An uncatalogued model gets the text baseline only.

## Fallback policies
| Policy | Behaviour |
|---|---|
| `disabled` | One attempt; fail visibly |
| `retry_same` | Up to 2 retries with backoff, for retryable errors (rate limit, unavailable, timeout) |
| `secondary_model` | Same connection, another model; used after provider-side failures |
| `secondary_provider` | Another connection. If its provider differs, **both** the organization and the brand policy must have `allow_cross_provider_fallback`. The DB trigger, local adapter and runtime each enforce this |

Fallback never happens:
- after text has already been streamed to the user;
- after a cancellation, budget refusal or authorization failure.

A fallback that does not fit the budget is skipped.

## Switching providers (what happens)
1. The admin changes the assignment. Permission and scope are checked by RLS and the trigger, or by the local adapter.
2. The UI shows warnings:
   - the connection is not verified;
   - tools are not confirmed for the model;
   - no verified price, so a token ceiling is needed.
3. The next turn routes to the new target. Conversation history is kept and the agent's instructions, tools and skills do not change.
4. Each execution and usage event records the provider, model and connection that were actually used. History is never rewritten.
5. An `ai_audit_events` row records which columns changed.

## Tests
- `src/test/ai/routing.test.ts`: priority, scope, health, capability, fallback consent and budgets (23 tests).
- `src/test/ai/execution.test.ts`: switching, retries, fallback, no silent simulation, cancellation and orchestration (17 tests).
- `src/data/local/ai.test.ts` and `src/test/db/aiProviders.db.test.ts`: the same rules in mock mode and in Postgres.
