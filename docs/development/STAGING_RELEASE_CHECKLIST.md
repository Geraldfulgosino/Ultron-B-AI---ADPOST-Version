# Staging Release Checklist: Supabase app + ADPOST/POD GA4/GSC pilot

**Written:** 2026-11-20 (Milestone 5). **Target:** Supabase staging `ppwkxlwxzutigepaizob` only. Never production, never Netlify, never `main`.
**Status:** nothing in this checklist has been run. Every step marked **[APPROVAL]** is a remote change that needs your explicit approval, in the words given in section 13.

This builds on, and does not replace:
- STAGING_MIGRATION_PLAN_0006_0009.md (dry run, pre-flight SQL and its addendum for 0010);
- PHASE17_STAGING_RUNBOOK.md (dashboard settings and environment);
- RLS_ROLE_TEST_MATRIX.md (role checks with real JWTs).

## 0. What is ready locally (not staging-verified)
| Area | Local status |
|---|---|
| Migrations 0006–0012 | Apply cleanly on PGlite; RLS, advisor-style, role and pilot tests pass. **0011** (Super Admins can see other Super Admins) and **0012** (one Google property per website) are new on 2026-11-20 |
| App on Supabase | `SupabaseBackend` passes the shared backend contract and 12 isolation tests on PGlite. The boot path exists; `SUPABASE_ADAPTER_READY` is `false` |
| Google | OAuth (one-time hashed state, PKCE S256, server-side exchange and refresh, read-only scopes), property discovery and verification, one property per website, audit trail, GA4/GSC pagination, de-duplicated upserts, sync history, freshness, rate limits, period comparisons. The `/oauth/google/callback` route exists. All against fake Google APIs |
| Pilot seed | `supabase/seeds/pilot/adpost_pod_pilot.sql`: ADPOST agency with an ADPOST client and a POD client, one production website each, **URLs supplied by you at run time**. The Lugenix pilot seed is kept, but is not part of this release |

PGlite is Postgres compiled to WebAssembly with a Supabase-like stub. It does not run GoTrue, PostgREST, Storage, Realtime or Edge Functions. Passing it does **not** prove staging readiness.

## 1. Inputs needed from you (none are in the repository)
- [ ] The **ADPOST corporate website** production URL (https).
- [ ] The **Promo On Demand (POD)** production URL (https).
- [ ] The email for the **first Super Admin** (you run the bootstrap yourself, section 6).
- [ ] A **Google Cloud OAuth client** (Web application) owned by ADPOST. You keep its secret; it is set only as an Edge secret.
- [ ] Which Google account has **GA4 and Search Console access** to the ADPOST and POD properties (the admin signs in with it during connection).
- [ ] **SMTP** settings for Supabase Auth (invitations, confirmation and reset emails).

## 2. Staging preflight (read-only) **[APPROVAL: read-only link]**
1. On the laptop, install the Supabase CLI. You run `supabase login` yourself; I never handle the access token.
2. `supabase link --project-ref ppwkxlwxzutigepaizob`. The project-ref guard in `config.ts` refuses any other project.
3. `supabase migration list --linked`: expect exactly 0001–0005 on the remote. Stop if anything else is there.
4. Read-only SQL from STAGING_MIGRATION_PLAN_0006_0009.md §3 step 2, plus:
   ```sql
   select count(*) from public.integrations;               -- expect 0 (0012 adds a unique index)
   select count(*) from public.platform_admins;            -- expect 0 before the bootstrap
   select slug from public.agencies;                       -- expect none, or no 'adpost' conflict
   ```
5. A dry run (`supabase db push --dry-run`) must list exactly 0006 → 0012.

## 3. Database backup **[APPROVAL: included in the migration approval]**
- `supabase db dump --linked -f staging-before-0006.dump`, plus `--data-only`. Both are git-ignored and stay on the laptop.
- The backup is taken right before the push, in the same session.
- Restoring is destructive and needs its own approval.

## 4. Migration compatibility
| Migration | Risk | Check |
|---|---|---|
| 0006 advisor fixes | Policy rewrites | Advisors clean after the push |
| 0007 AI providers | New tables, no data | — |
| 0008 agency → client → website | Constraints on slugs and URLs | Pre-flight SQL returns 0 rows |
| 0009 roles | Super Admin, Admin and Client User model; bootstrap function | `bootstrap_super_admin` is unusable by app roles (tested) |
| 0010 integrations | Integration tables, encrypted secrets, OAuth state | No app-user grants on secrets (tested) |
| 0011 platform admin directory | Replaces `platform_admins_select_self` with one policy | Super Admins list Super Admins; others see only themselves |
| 0012 property guard | Unique index on (provider, external property) for Google | Integrations table is empty on staging, so it cannot fail |

All are forward-only, and each runs in its own transaction.

## 5. Row-level security verification (after the push)
- [ ] Run the Supabase **security and performance advisors**: no new warnings.
- [ ] Create **synthetic test users** (`*.example.test`) for: Super Admin, ADPOST Admin, VCA Admin, POD Client User, ADPOST Client User, and a user with no membership. **[APPROVAL: test users]**
- [ ] Run the RLS matrix (RLS_ROLE_TEST_MATRIX.md) with their real JWTs, using `STAGING_RLS_RESULT_FILE` so `stagingRls.db.test.ts` checks the results. The required cases:
  - cross-agency denial;
  - cross-client denial (ADPOST ↔ POD);
  - no agency administration for Client Users;
  - conversations by visibility;
  - integration rows without credentials;
  - suspension and revocation on the next query.
- [ ] Record the results in TEST_RESULTS.md as **staging** results, separate from local ones.

## 6. Supabase Auth configuration **[APPROVAL: auth settings]**
- Site URL: `http://127.0.0.1:5173` for staging QA. No production URL yet.
- Redirect URLs: `http://127.0.0.1:5173/**` and `http://localhost:5173/**`. These cover `/login` (confirmation), `/reset-password` and `/oauth/google/callback`.
- Email confirmation **on**. Custom SMTP, because the built-in mailer is rate-limited.
- Disable public sign-ups if access should come only from invitations (recommended for the pilot).
- **First Super Admin:** you create or confirm your auth user, then run `select app.bootstrap_super_admin('<your email>');` yourself. It works once, only for a confirmed user.

## 7. OAuth redirect URLs (Google Cloud)
- Authorized redirect URI: `http://127.0.0.1:5173/oauth/google/callback` for staging QA. Add the production origin only when production is approved.
- Scopes on the consent screen: only `https://www.googleapis.com/auth/analytics.readonly` and `https://www.googleapis.com/auth/webmasters.readonly`.
- Consent screen in **Testing** mode, with the ADPOST Google account(s) listed as test users.

## 8. Edge Function secrets **[APPROVAL: secrets]**
Set with `supabase secrets set`, typed by you or pasted into the CLI by you. Never committed, never in `VITE_*`, never logged.

| Secret | Used by | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | all functions | `http://127.0.0.1:5173,http://localhost:5173` |
| `GOOGLE_OAUTH_CLIENT_ID` | integration-google | From the Google Cloud client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | integration-google | Server only |
| `GOOGLE_OAUTH_REDIRECT_URI` | integration-google | Must equal the Google Cloud redirect URI exactly |
| `INTEGRATION_ENCRYPTION_KEY` | integration-sync, integration-google | 32 random bytes (base64). It encrypts refresh tokens and PKCE verifiers. Keep a copy in your password manager: losing it means reconnecting every integration |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform. AI provider keys are **not** part of this release.

## 9. Edge Function deployment **[APPROVAL: deploy]**
Order: `integration-google`, `integration-sync`, `user-invite`. `agent-execute` and `ai-connection-test` come later, with a separate AI approval.
After each deploy, a smoke call without a JWT must return 401, and with a Client User JWT must return 403 for admin actions.

## 10. Pilot website ownership **[APPROVAL: pilot seed]**
```sql
set app.allow_pilot_seed = 'on';
set app.pilot_adpost_url = 'https://<ADPOST corporate domain>/';
set app.pilot_pod_url    = 'https://<Promo On Demand domain>/';
\i supabase/seeds/pilot/adpost_pod_pilot.sql
```
- It refuses to run without your two real URLs. It also refuses placeholders, test domains, IPs, http, the same domain twice, and a domain owned by another client.
- It creates no users, memberships or integrations. Running it again changes nothing.
- Then invite the ADPOST Admin, and the POD and ADPOST Client Users if wanted, through the app (sent by `user-invite`).

## 11. GA4 and Search Console property selection (in the app, by an Admin)
For **each** website separately (ADPOST, then POD):
1. Website → Integrations → Connect Google Analytics. Google consent with the read-only scope opens; you return to `/oauth/google/callback`, then to the website.
2. Choose the GA4 property from the list Google returns for that account. The server verifies access with a real API call before marking it `connected`.
3. Repeat for Search Console. The list marks which properties cover the website's URL; a property that does not cover it is refused.
4. One property feeds one website (0012): choosing ADPOST's property on POD (or the reverse) is refused.
5. Run the first sync for each (last 28 days plus the previous 28 days for comparisons). Check the sync history: status `succeeded`, rows read and written, no truncation.

## 12. Staging smoke tests (with `SUPABASE_ADAPTER_READY = true` on a local branch build only)
- [ ] Sign-in, sign-out, password reset email, expired link, and invitation acceptance (new account and existing account).
- [ ] Super Admin → `/platform`; ADPOST Admin → `/a/adpost`; POD Client User → the POD dashboard only; no-membership user → access pending.
- [ ] ADPOST Client User cannot open POD by URL, and the reverse.
- [ ] Integrations show statuses and labels, but no credentials (check the network tab).
- [ ] The GA4 and GSC numbers for ADPOST and POD differ and match the Google UI for the same dates (spot-check sessions and clicks).
- [ ] Disconnect Google on one website: credentials deleted, Google grant revoked, an audit entry written, and the property can then be reused.
- [ ] Desktop and mobile widths, light and dark themes.

Only after all of these pass do I propose setting `SUPABASE_ADAPTER_READY = true` in a commit, for your review.

## 13. Rollback and recovery
- **App:** set `SUPABASE_ADAPTER_READY = false` (or `VITE_DATA_PROVIDER=mock`). Nothing remote changes.
- **Integrations:** disconnect in the app (revokes Google and deletes the ciphertext), or set `enabled = false` via SQL (approval).
- **Edge Functions:** redeploy the previous version, or delete the function (approval). The secrets stay.
- **Database:** forward-fix migrations only. Restoring the step 3 dump is destructive and needs a separate approval. **No `db reset` is ever run remotely.**
- **Pilot data:** remove it by slug, in reverse order (websites, clients, agency), only on approval. Running the seed again is safe.

## 14. Approval checkpoint (reply with the exact phrase)
| Phrase | What I will do | Remote change |
|---|---|---|
| **"Approve staging preflight"** | §2: link and read-only checks (after you install the CLI and run `supabase login` yourself) | None (read-only) |
| **"Approve staging migrations 0006–0012"** | §3 backup, then §4 push, then advisors | Schema |
| **"Approve staging auth config"** | §6 settings (you run the Super Admin bootstrap) | Auth settings |
| **"Approve staging test users"** | §5 synthetic users and the RLS matrix | Users |
| **"Approve Edge secrets and deploy"** | §8 and §9 (you provide the secret values) | Secrets, functions |
| **"Approve ADPOST/POD pilot seed"** | §10, with the two URLs you give me | Data |
| **"Approve Google connection for ADPOST/POD"** | §11 (you or the Admin complete Google consent) | Integrations |

Each phrase covers only its own row. Anything not listed (production, Netlify, `main`, AI provider keys, paid usage) stays out of scope.
