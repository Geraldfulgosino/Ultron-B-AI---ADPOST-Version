# Subscription Architecture (Phase 16, future SaaS)

Status: designed and enforced in the local adapter. No billing provider is connected, and no prices are defined.

## Model
- The **agency** owns the plan (`agencies.plan_key`). Brands inherit it. ADPOST is on `internal` (unlimited), so nothing changes for ADPOST today.
- Plans (`src/domain/plans.ts`): `starter`, `growth`, `agency` set limits on brands, members per brand, monthly agent runs and knowledge storage, plus feature flags (`team_chat`, `web_studio`, `intelligence`, `automation`, `live_models`).
- `subscriptions` table mirrors the billing provider's subscription. Only a verified billing webhook (service role) writes it. Agency staff can read it.

## Enforcement points (single choke points, server-side in Phase 17)
| Limit / feature | Where |
|-----------------|-------|
| Brands | `workspace.createBrand` |
| Members per brand | `invitations.send` and `invitations.accept` |
| Agent runs / month | `runAgent` (engine) → execution recorded as `limited`; provider not called |
| Live models | `runAgent` |
| Knowledge storage | `knowledge.create/upload/saveAttachment` |
| Team chat, Web Studio, Intelligence, Automation | `chat.createGroup`, `studio.create`, `intelligence.overview`, `automation.save` |

Errors raise `PlanLimitError` (maps to HTTP 402/403 in Edge Functions). UI hiding is only a convenience; enforcement lives in the data layer.

## Metering
`agencyUsage()` counts brands, the largest brand's members, non-limited executions this calendar month (UTC), and knowledge bytes. Executions already carry tokens and cost, so usage-based pricing can be added without schema changes.

## Billing boundary
`BillingProvider` (createCheckout, customerPortal, handleWebhook) is an interface only. A future implementation (for example a Stripe-backed Edge Function) must:
1. verify webhook signatures server-side,
2. update `subscriptions` and `agencies.plan_key` atomically,
3. never trust plan data sent from the browser.

## Not done
No provider, no prices, no checkout UI. All of these need product and owner decisions.
