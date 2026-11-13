# Super Admin Design

## UI: `/platform`
`src/pages/platform/PlatformPages.tsx`. It is guarded by `isSuperAdmin` and has four tabs:

- **Overview:**
  - agencies, active clients, websites (demo vs. other), suspended agencies, suspended users, pending invitations, enabled agents.
  - Archived clients' websites are excluded from the counts.
- **Agencies:**
  - directory with create, suspend, archive and restore (`AgencyDirectory`);
  - a link into each agency.
- **Users:**
  - every user with their memberships;
  - suspend or reactivate, grant or revoke Super Admin, assign or revoke agency roles, invite agency Admins.
- **Audit:** the newest platform audit events.

Super Admins also get the full Admin UI inside every agency and client.

## Server functions (migration 0009)
| Function | Rule |
|---|---|
| `grant_super_admin(user)` | Caller must be a Super Admin. Audited |
| `revoke_super_admin(user)` | Caller must be a Super Admin. Refuses to remove the last one. Audited |
| `set_user_suspended(user, bool)` | Super Admin only. Not yourself; revoke Super Admin before suspending one. Audited |
| `assign_agency_role` / `revoke_agency_role` | Super Admin only. Direct writes to `agency_memberships` are revoked from `authenticated` |
| `create_agency_invitation` / `revoke_agency_invitation` | Super Admin only. See USER_INVITATION_FLOW.md |
| `app.platform_audit(...)` | Internal. Not executable by app users |

## First Super Admin bootstrap (one-time, closable)
`app.bootstrap_super_admin(p_email)`:
- is **not** granted to `anon` or `authenticated`, so the browser cannot call it;
- requires an existing user whose email is **confirmed**;
- works only while no Super Admin exists and the `super_admin_bootstrap` platform setting is not `closed`;
- closes itself after first use and writes an audit event.

Public registration never creates a Super Admin, the first person to sign up is not promoted, and sign-up metadata (`role`) is ignored.

### Owner procedure (only after staging approval of 0009)
1. Create your account in the Supabase dashboard (Authentication → Users), or sign up and confirm the email.
2. In the SQL editor of `adpost-staging`, run:
   ```sql
   select app.bootstrap_super_admin('<your email>');
   ```
3. Sign out and back in. `/platform` appears.

Claude does not perform this remote promotion without your explicit approval.

## Limits by design
- Super Admins cannot read provider secrets or other users' private conversations.
- They cannot bypass audit or approval rules for destructive operations.
- They cannot hard-delete agencies or clients from the app.
