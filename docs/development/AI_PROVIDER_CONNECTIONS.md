# AI Provider Connections

## Data model (migration 0007, not applied)
| Table | Purpose | Who writes |
|---|---|---|
| `ai_providers` | Catalog: `simulated`, `anthropic`, `openai`; auth methods; billing note | migration only |
| `ai_provider_connections` | Metadata per connection; organization-wide (`brand_id` null) or one brand | agency staff (limited columns); status columns only the service role |
| `ai_provider_models` | Per-agency model catalog; capabilities and prices only when verified | agency staff; the connection test adds provider-reported ids |
| `ai_routing_policies` | Organization row (`brand_id` null) and per-brand rows: defaults, fallback consent, budgets, ceilings | agency staff (organization), brand admins (brand) |
| `ai_agent_model_assignments` | Agent → connection, model, generation config, fallback | brand admins |
| `ai_usage_events` | Immutable per-request usage | service role only |
| `ai_provider_health_checks` | Connection test history | service role only |
| `ai_audit_events` | Configuration audit (column names only) | trigger only |

`agent_executions` gains `connection_id`, `provider_request_id`, `error_category`, `fallback_used` and `idempotency_key` (unique per brand).

## Connection lifecycle
1. **Save.** An agency administrator chooses the provider, scope and display name, and enters a **secret slot name** such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY_MARKETING`.
   - The status becomes `configured`, or `not_configured` when no slot is set.
   - Saving never makes a connection `connected`.
2. **Provision the secret** (owner, outside the app): `supabase secrets set ANTHROPIC_API_KEY=…`. Never paste a key in chat, the UI, git or docs.
3. **Test.** `ai-connection-test` resolves the slot on the server and calls the provider's free model-listing endpoint (`GET /v1/models`).
   - It records the status, a health check and the verified model ids.
   - No tokens are generated.
4. **Assign.** A brand administrator assigns the connection and a reported model to agents under Agent routing.
5. **Rotate.**
   1. Store the new key in a new slot.
   2. Point the connection at that slot.
   3. Test it.
   4. Revoke the old key at the provider.

   Changing the slot, organization or project, or re-enabling a connection, resets it to `configured`. The DB trigger and the local adapter enforce this the same way.
6. **Disable.** The status becomes `disabled` and assigned agents fail visibly.
7. **Remove.** Refused while agents use the connection. Fallback references and policy defaults are cleared.

## Statuses
`not_configured`, `configured` (saved, not verified), `testing`, `connected`, `invalid_credentials`, `permission_denied`, `insufficient_credits`, `rate_limited`, `unavailable`, `disabled`.

Only a server-side test can set `connected` or a failure status. Users cannot write status columns: column grants and the trigger are covered by DB tests.

## Permissions
| Action | Agency staff | Brand owner/admin | Manager / member | Viewer / client | Other brand or agency |
|---|---|---|---|---|---|
| View connections in scope | yes | yes | no | no | no |
| Create / edit / rotate / disable / remove | yes | no | no | no | no |
| Test a visible connection | yes | yes | no | no | no |
| Assign to agents / brand policy | yes | yes | no | no | no |
| Organization policy | yes | no | no | no | no |
| Read assignments (chat indicator) | yes | yes | yes | no (clients) | no |
| Usage | all brand rows | all brand rows | own requests | no | no |

## Local (mock) mode
- Fixtures: an organization-wide **Simulator (offline)** connection and an example **Company Anthropic API** connection that is `configured` but never verified.
- "Test connection" on a live provider returns `ranOnServer: false` with "Nothing was sent", and leaves the status unchanged. Testing the simulator marks it `connected`.
- An agent assigned to a live connection fails with an explanation. It is never answered with simulated text.

## BYOK (dynamic per-tenant keys)
**Not enabled.** `authentication_method` accepts only `platform_secret` (and `none` for the simulator). Edge Function environment secrets are not a tenant-isolated, dynamically writable vault. A vault-backed method needs its own reviewed migration, covering:
- encryption at rest;
- server-only reads;
- audited use;
- rotation and revocation.

## Custom endpoints and gateways
**Not supported.** There is no endpoint column: adapters can only reach `https://api.anthropic.com` and `https://api.openai.com`. An enterprise gateway or managed inference service would be a new adapter with a fixed, reviewed origin, not a user-editable URL.
