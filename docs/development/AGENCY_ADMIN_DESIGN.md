# Agency (Company) Admin Design

## Who
`agency_owner` and `agency_admin` members of one agency. Super Admins have the same powers in every agency.

## UI
- `/a/:agency`: overview of the agency's clients, websites and agents.
- `/a/:agency/clients`: create and archive clients.
- `/a/:agency/settings`: agency settings.
- `/a/:agency/users` (`AgencyUsersPage`, `src/pages/users/UsersManager.tsx`):
  - lists the agency's Client Users and staff per client;
  - invites a Client User with optional client-row scope and explicit permissions (`ai_chat`, `comment_tasks`, `download_reports`);
  - edits permissions; revokes memberships and invitations.
- In each client: the "client-facing" toggle on agents, and "Share with client" (`client_visible`) on projects.

## Rules
- An Admin can invite Client Users **into their own agency's clients only**. They cannot:
  - invite Admins;
  - create Super Admins;
  - grant roles in another agency.

  The `create_invitation` RPC checks this, not the browser.
- `brand_memberships.permissions` is valid only for role `client` (check constraint). `client_id` is valid only for role `client`.
- Admins cannot change `agency_memberships`: insert/update/delete privileges are revoked. Only Super Admin RPCs can change them.
- While the agency is suspended, Admins have no access at all.

## Audit
Membership and invitation changes are recorded in the existing brand audit trail. Super Admin actions go to `platform_audit_events`.
