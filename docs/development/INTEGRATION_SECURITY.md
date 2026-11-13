# Integration Security

| Control | Implementation | Evidence |
|---|---|---|
| Trusted backend only | Every provider request comes from the Edge Functions `integration-sync` / `integration-google`. The browser client sends only the user JWT and the publishable key | `integrationsClient.test.ts` |
| No browser secrets | Application Passwords pass through the browser **once** (to `wp_connect`) and are never stored there. Google tokens and the client secret never reach the browser | client and flow tests |
| Encrypted credentials | AES-256-GCM, with the key from Edge secret `INTEGRATION_ENCRYPTION_KEY`. The integration id is bound as additional authenticated data. Stored in `integration_secrets`, where app users have **no privileges at all** (stronger than an empty RLS result) | `wordpress.test.ts`, `integrations.db.test.ts`, `rls.db.test.ts` |
| OAuth safety | PKCE (S256). Hashed, single-use state, expiring after 10 minutes and bound to the user and website. The verifier is encrypted. The server exchanges the code. Read-only scopes and a refresh token are required. Revoke on disconnect | `google.test.ts`, `googleSync.test.ts` |
| Ownership | The website is loaded with the **caller's JWT** (RLS). Rights come from `integration_permissions(website)`: view needs read access; sync needs write access (staff, agency managers, Super Admin); manage needs client or agency admin. A trigger always derives `brand_id`/`client_id` from the website, so ids sent by a client cannot move data | `integrations.db.test.ts` |
| Client Users | Can read integration status and data for their own client. Cannot sync, connect, change or read credentials | `integration_permissions` tests |
| Cross-agency | An Admin of another agency gets `can_view = false` and no rows | `integrations.db.test.ts` |
| Writes | App users cannot insert or update any integration table, nor `integrations`. Only the service role writes, after the checks above | same |
| Demo websites | Refused by the service layer (`assertLiveWebsite`) and by a database trigger | sync and DB tests |
| SSRF | `safeFetch` on every hop, plus host allow-lists. Google calls go only to fixed `*.googleapis.com` hosts, with `redirect: 'error'` | crawler and google tests |
| Credential leakage | `Authorization` is dropped on cross-origin redirects. Errors are sanitized (`sanitize`) before storage. Secrets are never logged; only error class names are logged | `wordpress.test.ts`, `sync.test.ts` |
| Rate limiting | At most 12 runs per website per 10 minutes. One running sync per integration and kind (unique index). Provider `429` is mapped to `rate_limited` with retry-after | `sync.test.ts`, DB tests |
| Prompt injection | Page text, titles and excerpts are stored and shown as data. Agents receive them as tool results, never as instructions (see AI_RUNTIME_ARCHITECTURE.md) | `wordpress.test.ts` (excerpt with "Ignore previous instructions" stays plain data) |
| Connected means verified | The `integrations_connected_verified` check constraint: `connected`, `syncing` and `sync_completed` require `verified_at`, which is set only after a real provider success | DB test |

## Bug found and fixed in this milestone
`app.can_read_client_row` (0009, unapplied) returned **NULL** for unrelated users. RLS treats NULL as deny, so no policy leaked. But a PL/pgSQL `if not …` treats NULL as false, so the new `integration_permissions` would have granted `can_view` to an Admin of another agency. Two fixes:
- the helper is now coalesced to `false`;
- a regression test asserts that no access helper returns NULL, across users.

## Open items
- **Credential rotation:** reconnecting overwrites the ciphertext. Rotating the encryption key needs a re-encrypt job, not implemented.
- **Pinned-IP fetching** to close the DNS time-of-check/time-of-use gap (see SEO_CRAWLER_ARCHITECTURE.md).
- **n8n:** no adapter is connected (phase 15 optional). Nothing reads or changes n8n.
