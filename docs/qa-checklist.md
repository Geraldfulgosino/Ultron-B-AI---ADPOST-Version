# QA Checklist — ULTRON-B AI SEO/Marketing MVP

Manual browser testing checklist. Seed demo data first (`DemoSeeder`). Test with each role where noted.

---

## Auth

- [ ] Register a new account → verify email → redirect to org creation
- [ ] Log in with `demo@example.com` / `password` → land on dashboard
- [ ] Log in with wrong password → see validation error
- [ ] Log out → redirected to login page
- [ ] Forgot password flow → receive reset email (check `storage/logs/laravel.log` if using log mailer)
- [ ] Reset password with expired token → see error message
- [ ] Unauthenticated access to `/{org}/dashboard` → redirected to `/login`

---

## Organization & Members

- [ ] **Owner** — can see Settings and Members in sidebar
- [ ] **Viewer** — sidebar shows same items but actions are disabled/hidden
- [ ] Members page shows all 4 demo roles
- [ ] Invite a new member → check invitation email is queued (check `storage/logs/laravel.log` or queue worker logs; requires `ultron-queue` container running)
- [ ] Accept invitation via link → new member appears in org

## Organization Switching

- [ ] Register a second account and create a second organization
- [ ] Log in as `demo@example.com` → navigate to Demo Agency dashboard
- [ ] Log out, log in as the second account → land on second org dashboard
- [ ] While logged into the second org, manually visit `/organizations/demo-agency/dashboard` → 403 Forbidden
- [ ] Navigating within one org never shows data from another org

---

## Clients

- [ ] Index page lists Acme Corp and Beta Foods (archived client NOT shown by default)
- [ ] Create a new client → appears in list
- [ ] Edit client name → change persists
- [ ] Archive a client → removed from active list
- [ ] **Viewer** cannot create/edit/archive (button hidden or 403 returned)
- [ ] Cross-org URL access → 403 or 404 returned

---

## Websites

- [ ] Index page lists 3 active websites for Demo Agency
- [ ] Create a website linked to Acme Corp → appears in list
- [ ] Edit website domain → change persists
- [ ] Archive a website → removed from active list
- [ ] **Viewer** cannot create/edit/archive

---

## Integrations

- [ ] Index shows one connected Google Analytics integration
- [ ] Yellow banner appears when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are NOT set in `.env`
- [ ] Submitting "Continue with Google" without OAuth credentials → red flash error with message mentioning `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and "pending placeholder was created"
- [ ] A pending placeholder integration is created in the database (visible in the list after page reload)
- [ ] Disconnect integration → status changes to Disconnected
- [ ] "Sync now" button on a connected integration → triggers analytics sync (check queue worker logs)
- [ ] "Connect Google Analytics" button with live credentials → redirects to Google OAuth
- [ ] **Viewer** can view integrations index but "Continue with Google" and "Disconnect" buttons are hidden/disabled
- [ ] **Token exposure check:** open browser DevTools → Network tab → inspect the Inertia page response for the integrations index → confirm `access_token` and `refresh_token` are absent from the JSON payload

---

## SEO Dashboard

- [ ] KPI cards display values (clicks, impressions, CTR, avg position, sessions) — not all zeros
- [ ] Website selector works — changing website reloads KPIs
- [ ] Date range filter works — submitting updates KPI values
- [ ] Landing pages table shows 5 rows for Acme Main Site
- [ ] Search queries table shows 5 rows
- [ ] Insights section shows at least 8 insights
- [ ] "View all insights →" link navigates to the Insights index
- [ ] "Generate insights" button is visible for Owner/Admin, hidden for Viewer
- [ ] Empty state text is shown when no landing page/search query data exists (test with a website that has no analytics)

---

## SEO Insights Index

- [ ] Page loads showing all 8 demo insights
- [ ] Status filter → "Pending" shows only pending insights
- [ ] Severity filter → "Critical" shows only critical insights
- [ ] Website filter → shows only insights for selected website
- [ ] Date range filter → limits results
- [ ] "← Dashboard" link returns to SEO dashboard
- [ ] Checkboxes appear for Owner/Admin, hidden for Viewer
- [ ] Select multiple insights → bulk actions panel appears
- [ ] "Mark N Reviewed" bulk action → selected insights become Reviewed
- [ ] "Dismiss N" bulk action → selected insights become Dismissed
- [ ] "View →" link on any row navigates to InsightShow

---

## SEO Insight Detail (InsightShow)

- [ ] Title, summary, recommendation, website name, type, created date all display correctly
- [ ] Severity and status badges show correct colours
- [ ] Review history section appears when insight has been reviewed
- [ ] **Pending insight** — "Mark Reviewed", "Approve", "Dismiss" buttons visible for Admin
- [ ] **Reviewed insight** — "Approve", "Dismiss", "Reopen" buttons visible
- [ ] **Approved insight** — "Dismiss", "Reopen" buttons visible
- [ ] **Dismissed insight** — "Mark Reviewed", "Approve", "Reopen" buttons visible
- [ ] Submitting a status action with review notes → notes persist and appear in Review History
- [ ] "← Back to Insights" link returns to Insights index
- [ ] **Viewer** sees detail page but no action forms

---

## Navigation

- [ ] Active page is highlighted in the sidebar (indigo background)
- [ ] Navigating between pages updates the active highlight correctly
- [ ] SEO sub-pages (Insights index, InsightShow) highlight the "SEO" nav item
- [ ] Organization name and role appear in the sidebar header

---

## Security & Tenant Isolation

- [ ] Log in as `demo@example.com`, note the org slug (`demo-agency`)
- [ ] Create a second org with a different account
- [ ] Try accessing `/organizations/demo-agency/seo` while logged into the second org → 403
- [ ] Try accessing a client/website/insight belonging to Demo Agency from the second org → 403 or 404

---

## Error States

- [ ] Navigate to a non-existent route → 404 page (or Inertia error)
- [ ] Submit create-client form with empty name → validation error appears
- [ ] Submit a bulk insight action with 0 selected → not possible (panel only shows when selection > 0)

---

## Google OAuth Setup Verification (requires live credentials)

Only run this section if `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are configured in `.env`.

- [ ] Navigate to Integrations, click "Continue with Google" → redirected to Google account selection
- [ ] Authorize the app → redirected back to integrations with green success flash
- [ ] Integration shows status "Connected" with the Google account email
- [ ] Trigger a sync → queue worker picks it up; sync history record appears in the database
- [ ] Token exchange happens server-side only — no access token appears in the browser at any point
- [ ] Disconnect, then reconnect → new token stored; old one overwritten

---

## Queue Worker Verification

- [ ] `docker compose ps` shows `ultron-queue` container as running
- [ ] `docker compose logs ultron-queue` shows no fatal errors
- [ ] After sending an invitation, a job appears processed in queue logs (or email appears in log mailer)
- [ ] After triggering a sync, an analytics sync job is processed within seconds
