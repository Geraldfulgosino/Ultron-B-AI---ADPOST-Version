# User Invitation Flow

## Two kinds
| Kind | Table | Create | Who | Accept route |
|---|---|---|---|---|
| Client User / brand staff | `invitations` | `create_invitation(brand, email, role, client_id, permissions)` | Admins of that agency, Super Admins | `/invitations/:token` |
| Agency Admin / manager | `agency_invitations` | `create_agency_invitation(agency, email, role)` | Super Admins only | `/agency-invitations/:token` |

## Token handling
- The RPC generates 32 random bytes. It returns the plain hex token **once** and stores only `sha256(token)`.
- `token_hash` is not selectable by app users (column grants).
- Acceptance (`accept_invitation` / `accept_agency_invitation`):
  - requires a signed-in user whose **confirmed** email matches;
  - checks status and expiry;
  - is single-use and idempotent: an existing identity gains the membership once.
- Statuses: `pending`, `sent`, `accepted`, `expired`, `cancelled`, `revoked`, `failed`.

## Delivery: `user-invite` Edge Function (implemented, **not deployed**)
Code: `supabase/functions/user-invite/index.ts` + `_shared/invites.ts`. Tests: `src/test/ai/invites.test.ts`.

1. The browser creates the invitation via the RPC, then POSTs `{ kind, invitationId, token, appOrigin }` with the user's JWT.
2. The function checks:
   - the caller can **see** the invitation under RLS (that is, the caller administers it);
   - the status is `pending` or `failed`, and the invitation has not expired;
   - `sha256(token)` equals the stored hash;
   - the origin is in `ALLOWED_ORIGINS`.
3. **New email:** the function calls Supabase Auth `inviteUserByEmail` with the service role, on the server, never in the browser.
   - The status becomes **`sent` only when Auth accepts the request**.
   - Otherwise the status is `failed`, with a sanitized `delivery_error`.
4. **Existing account:** no email is sent or claimed. The accept link is returned for the admin to share.

The UI never says an invitation was "sent" unless the function returned `delivered: true`. In local mock mode, the UI shows a dev accept link instead.

## Before deployment
- Apply 0009 to staging (approval required).
- Set `ALLOWED_ORIGINS` for the function.
- Configure custom SMTP: the built-in Supabase mailer is heavily rate-limited.
- Wire the Supabase adapter (17E/17F) to call the function.
