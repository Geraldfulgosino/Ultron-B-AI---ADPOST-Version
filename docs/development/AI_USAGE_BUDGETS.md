# AI Usage and Budgets

Application limits are **safeguards, not billing controls**. Always also set spending limits in the Anthropic Console and the OpenAI Platform.

## Limits and where they live
| Limit | Level | Field |
|---|---|---|
| Output tokens per request | agent, connection, model | `max_output_tokens` (the smallest wins) |
| Runs per day | agent | `agent_instances.max_runs_per_day` |
| Monthly USD | agent / connection / brand / per user / organization | `monthly_budget_usd`, `per_user_monthly_budget_usd` |
| Max cost per request | connection / brand / organization (the smallest wins) | `max_cost_per_request_usd` |
| Monthly requests | connection / brand / organization | `monthly_request_limit` |
| Monthly tokens | brand / organization | `monthly_token_limit` |
| Team round | per user message | 6 turns, depth 3, 24k tokens, $2, 180 s |
| User rate | per user | 20 requests per minute |

## Rules (`budget.ts`)
- Every check runs **before** the call, using the worst case: estimated input tokens plus the full output cap.
- When a per-request cost limit would be exceeded, the output cap is lowered to fit. If fewer than 64 tokens would fit, the request is refused.
- **Prices.** Cost is computed only from admin-entered prices that have a source and a verification date (DB check constraint).
  - Without prices, USD budgets cannot be enforced, so a live request then **needs a monthly token ceiling** at brand or organization level, or it is refused.
  - No model prices are shipped or guessed.
- Provider-reported token usage is recorded. `reported_cost` stays null because neither API returns cost. `estimated_cost` is set only with a `pricing_version`.
- Simulated runs check run limits only and have no cost.

## Usage dashboard (Settings → AI Usage)
- Totals: requests, failures, input and output tokens, and cost. Cost shows "—" with an "N unpriced" note when unknown.
- Breakdowns by provider, model, agent and user, plus a daily table, over a date range.
- Brand admins see all brand usage; other staff see their own requests; clients see nothing.

## Not yet built
- Charts on the usage page (tables only).
- Organization-wide rollups across brands.
- Alerts when a budget nears its limit.
