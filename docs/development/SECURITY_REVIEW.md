# Security Review: adpost-web (Phase 14, local)

Scope: the standalone app in `apps/adpost-web` running on the **local adapter**. This review does **not** cover a deployed or Supabase-backed system. Those require the Phase 17 RLS test plan (SUPABASE_INTEGRATION_PLAN.md §8) against a real project.

## Important: local auth is a simulation
The local adapter keeps the signed-in user id in `sessionStorage`. Anyone with devtools can change it, and the whole local "database" lives in the browser. **Local mode provides no security boundary.** Its authorization rules exist so that UI flows and tenant-isolation behaviour can be tested and mirrored into RLS. Real enforcement arrives with Supabase JWTs + RLS (Phase 17). Never put real customer data into local mode.

## Checks performed

| Area | Result |
|------|--------|
| Tenant isolation | Every adapter method resolves access through `Scope` (`require`/`rows`/`row`/`owned`). Unknown and foreign brands both raise AccessDenied, so brand existence never leaks. Foreign record ids within an allowed brand raise NotFound. Covered by isolation tests in every data test file. |
| Client-role scoping | Client users see only rows of their `clientId` (clients, websites, integrations, analytics, insights, reports, intelligence). Staff-only tables (AI, chat, work, knowledge, studio, automation) are denied entirely. |
| Role checks | Viewer is read-only; manager+ writes; owner/admin administer; admins cannot grant the owner role; the last owner is protected; nobody approves their own request. |
| Browser-supplied ids | Website→client, task→project/assignee, approval→task, conversation→agent and studio→website links are all validated against the same brand. |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` (grep). All user/agent text renders through React escaping with `whitespace-pre-wrap`. |
| Open redirect | `?next=` only accepts same-app relative paths (`safeNext`, tested). |
| CSV injection | Text cells starting with `= + - @ tab CR` are prefixed with `'` (tested). |
| PDF | Text escaped for PDF literals; non-Latin-1 replaced. |
| Secrets | No secrets in tracked files (pattern scan for API keys, JWTs, private keys, Slack/GitHub tokens; no `.env`/`.pem`/`.key` tracked). Integration credentials and the full n8n webhook URL are never returned to the UI (tested). LLM keys live only in the planned Edge Function. |
| Network | The local adapter makes **no** network calls (grep for fetch/XHR/beacon). Syncs, webhooks and AI runs are simulated and labelled. |
| Passwords (local) | Fixture accounts use one synthetic dev password. Registered users' passwords are stored as salted SHA-256 (hashed locally, still a simulation; Supabase Auth replaces it). |
| Agent safety | External-effect actions (publish, deploy, webhook) are only ever proposals → human approval. Orchestration is bounded (6 turns, depth 3, token budget, each agent once per round). Agent context is limited to the agent's read tools. |
| Dependencies | `npm audit`: 0 vulnerabilities in the root and in `apps/adpost-web`. Versions are pinned exactly in `apps/adpost-web`. |

## Fixed during this review
- Registered users could not sign in after a reload, because credentials weren't persisted. They are now persisted, hashed, in a separate key.
- Stored snapshots from older schemas loaded silently. They are now versioned (`DB_SCHEMA_VERSION`) and discarded on mismatch, plus there is a "Reset local demo data" control.
- Dialogs had no focus trap. Tab and Shift+Tab now cycle within the modal.
- There was no skip link. Added "Skip to content" pointing at `<main id="main">`.
- A route crash showed a blank screen. Added a route `errorElement` with a friendly error page.

## Open items (need a real backend)
- RLS policies are parse-checked only. Execute the §8 RLS test plan on staging (Phase 17).
- Rate limiting for exports and agent runs (legacy throttles) must move to Edge Functions.
- Invitation tokens are stored raw locally. The schema stores `token_hash` only.
- No browser-level visual or a11y audit (axe, Lighthouse) has been run yet. jsdom tests only.
