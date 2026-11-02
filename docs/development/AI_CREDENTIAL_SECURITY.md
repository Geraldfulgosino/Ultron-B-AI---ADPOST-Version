# AI Credential Security

## Rules
- Provider API keys exist **only** as Supabase Edge Function secrets, set by an administrator with `supabase secrets set`.
- They are never stored in:
  - tables, React state, localStorage, sessionStorage or IndexedDB;
  - git, documentation or logs;
  - analytics or error reports.
- The database stores a **slot name**. The check constraint `^(ANTHROPIC|OPENAI)_API_KEY(_[A-Z0-9]{1,32})?$` plus a provider-prefix match mean a connection cannot reference `SUPABASE_SERVICE_ROLE_KEY` or another provider's key. `resolveSecret()` re-checks both rules on the server.
- Key-shaped input (`sk-…`, `sb_…`, JWTs) in the slot field is rejected with "Never paste an API key here".
- Credentials can reach only `https://api.anthropic.com` and `https://api.openai.com` (`assertAllowedUrl`), with `redirect: 'error'`.
- Provider error messages are sanitized before they are stored or returned (`sanitize()` redacts `sk-`, `sb_secret_`, `Bearer …` and JWT shapes).
- Edge handlers log only an error class name, never request bodies, prompts or headers.

## Server boundaries
- `agent-execute` and `ai-connection-test` require the caller's JWT (the platform's `verify_jwt` plus `auth.getUser()`).
- Caller-scoped reads use the anon key with the caller's JWT, so RLS applies.
- The service-role client is created only inside the function, from the runtime environment. It is used only after the caller's message, conversation, brand and write role are verified, and only for the verified brand and agency.
- CORS is limited to `ALLOWED_ORIGINS`, which defaults to the local dev origin.

## Verified by tests
| Check | Test |
|---|---|
| No AI table has a text column that could hold a secret value | `aiProviders.db.test.ts` |
| Slot names validated per provider; keys rejected | DB, local adapter and UI tests |
| Users cannot write status, verification or audit columns, or forge usage, health or audit rows | `aiProviders.db.test.ts` |
| Browser code imports no server adapter or resolver and reads no secret env var; the build contains no key-shaped strings | `bundleSecurity.test.ts` |
| Keys never appear in prompts, outcomes, errors or the public response | `execution.test.ts`, `handlers.test.ts`, `adapters.test.ts` |
| A provider key is not sent to a non-allow-listed origin | `adapters.test.ts` |

## Owner actions (never done by Claude)
1. Create API accounts in the Anthropic Console and/or OpenAI Platform. These are separate from Claude, ChatGPT and Codex subscriptions.
2. Set provider-side spending limits.
3. Run `supabase secrets set ANTHROPIC_API_KEY=… OPENAI_API_KEY=…` for project `ppwkxlwxzutigepaizob` from your own terminal. Do not paste keys into chat.
4. Rotation:
   1. Set a new slot, for example `ANTHROPIC_API_KEY_2026Q4`.
   2. Point the connection at it in Settings.
   3. Test it.
   4. Revoke the old key in the provider console, then `supabase secrets unset` the old slot.
