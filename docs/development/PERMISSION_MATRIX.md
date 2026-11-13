# Permission Matrix

Legend: ✅ allowed · ❌ denied · 🔑 only with the named explicit Client User permission · — not applicable.
Every cell is enforced by RLS or a `security definer` function (migration 0009). The local adapter (`Scope`) mirrors it. The UI only hides what the backend already denies.

## Platform and agency administration

| Action | Super Admin | Admin (own agency) | Agency manager | Client User |
|---|---|---|---|---|
| Open `/platform` (overview, agencies, users, audit) | ✅ | ❌ | ❌ | ❌ |
| Create, suspend, archive or restore agencies | ✅ | ❌ | ❌ | ❌ |
| Grant or revoke Super Admin (never the last one) | ✅ | ❌ | ❌ | ❌ |
| Suspend or reactivate a user account | ✅ | ❌ | ❌ | ❌ |
| Assign or revoke agency roles directly | ✅ | ❌ | ❌ | ❌ |
| Invite agency Admins/managers | ✅ | ❌ | ❌ | ❌ |
| Read the platform audit log | ✅ | ❌ | ❌ | ❌ |
| Edit agency settings | ✅ | ✅ | ❌ | ❌ |
| Create or archive clients | ✅ | ✅ | ❌ | ❌ |
| Invite Client Users / set their permissions | ✅ | ✅ (own clients) | ❌ | ❌ |
| Other agencies' data | ✅ | ❌ | ❌ | ❌ |

## Client workspace

| Action | Super Admin | Admin | Staff (brand roles) | Client User |
|---|---|---|---|---|
| Read dashboard, websites, reports | ✅ | ✅ | ✅ | ✅ (read-only) |
| Write websites, settings, SEO data | ✅ | ✅ | per brand role | ❌ |
| Download or export reports | ✅ | ✅ | ✅ | 🔑 `download_reports` |
| Agent chat | ✅ | ✅ | ✅ | 🔑 `ai_chat`: client-facing agents, client-shared one-to-one chats only, no knowledge tools |
| Read agent instructions | ✅ | ✅ | ✅ | ❌ |
| Projects and tasks | all | all | all | `client_visible` projects only |
| Comment on tasks | ✅ | ✅ | ✅ | 🔑 `comment_tasks` (client-visible tasks) |
| Knowledge base | ✅ | ✅ | ✅ | ❌ |
| AI provider connections | ✅ | ✅ | ❌ | ❌ |

## Conversation visibility

| Scope | Super Admin | Admin | Staff | Client User |
|---|---|---|---|---|
| `agency_internal` | ✅ | ✅ | ✅ | ❌ |
| `client_shared` | ✅ | ✅ | ✅ | read with membership; post with 🔑 `ai_chat` |
| `user_private` | creator only | creator only | creator only | creator only |

Super Admins do **not** see other users' private conversations (tested).

## Things no role bypasses
- Credential protections: provider keys stay in server secrets. Nobody reads them back, including Super Admins.
- Audit: every Super Admin action writes `platform_audit_events`.
- Destructive operations: there is no hard delete of agencies or clients from the UI, only archive or suspend.
- Sign-up metadata never grants a role.
