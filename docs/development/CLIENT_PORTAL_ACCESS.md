# Client Portal Access

## Default: read-only
A Client User (brand role `client`) can read:
- the client dashboard;
- websites;
- SEO reports;
- client-visible projects and tasks.

Without explicit permissions they cannot write anything.

## Explicit permissions (`brand_memberships.permissions`)
| Permission | Enables |
|---|---|
| `ai_chat` | Agent Chat with **client-facing** agents in **client-shared, one-to-one** conversations |
| `comment_tasks` | Comment on client-visible tasks (`task_comments`) |
| `download_reports` | Report download and export |

## Agent chat for clients
- **Database:** `conversations.visibility` is `agency_internal` (default), `client_shared` or `user_private`. Client Users read only `client_shared` conversations. They post only with `ai_chat`.
- **Server (`agent-execute`, `supabase/functions/_shared/ai/handlers.ts`):** a Client User run is allowed only when all of these hold:
  - the caller has `ai_chat`;
  - the conversation is `client_shared` and `direct`;
  - every agent is `client_facing`.
- **Knowledge tools are removed** from Client User runs (`read_knowledge` is stripped and there is no knowledge search). Staff knowledge cannot leak through an agent.
- Agent instructions are read with the service role **after** the RLS visibility check, and are never returned to the caller.
- **Local adapter:**
  - `createDirect` forces `client_shared` for client users and requires a client-facing agent;
  - `engine.ts` applies the same rules.

## Navigation
`BrandLayout` shows Client Users only the items marked `client` in `navigation.ts` (Agent Chat when `ai_chat`, Projects). Staff-only routes are wrapped in `RequireStaff` / `RequireStaffOrClient`. The backend denies those reads anyway.

## Sample accounts (local mock only, `.example.test` addresses)
- `user@lipsky.example.test`: LIPSKY Client User with `ai_chat` and `comment_tasks`.
- `client@pod.example.test`: POD Client User, read-only.

Mock sign-in exists only in the local adapter. It is not a real security boundary (see SECURITY_REVIEW.md).
