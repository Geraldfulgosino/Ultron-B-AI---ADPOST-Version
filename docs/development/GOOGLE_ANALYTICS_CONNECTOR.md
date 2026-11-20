# Google Analytics 4 Connector

**Code:** `supabase/functions/_shared/integrations/{google,ga4,googleSync}.ts`. Edge function: `integration-google`.
**Status:** implemented and tested with fakes. **No Google request has been made.**

## OAuth (server-side authorization code + PKCE)
1. **Start** (admins only):
   - The server creates a random `state` and a PKCE verifier.
   - It stores only `sha256(state)` and the **encrypted** verifier in `integration_oauth_states` (service role only, 10-minute expiry).
   - It returns the `accounts.google.com` URL with the scope `analytics.readonly`, `access_type=offline` and `prompt=consent`.
2. **Callback:** Google redirects to the app route `/oauth/google/callback`. The app POSTs `{state, code}` to `integration-google` with the user's JWT. The server then checks:
   - the state hash matches;
   - the state is unused and unexpired;
   - the caller is the same user who started.

   It exchanges the code with the client secret and verifier on the server. It requires the read-only scope **and** a refresh token, then stores the refresh token encrypted.
3. **Property:** the server lists the properties the Google account can access (Analytics Admin API `accountSummaries`).
   - The chosen property is verified to be in that list. It is never guessed.
   - Only after that is the status `connected`, with `verified_at` set.
4. **Disconnect** revokes the grant at Google (best effort) and deletes the stored ciphertext.

## Data
**Data API `runReport`.** One report per dimension, with `date` always included. Dimensions:
- `total`
- `sessionDefaultChannelGroup`
- `sessionSourceMedium`
- `deviceCategory`
- `country`
- `landingPage`

**Metrics:**
- `activeUsers`, `totalUsers`
- `sessions`, `engagedSessions`, `engagementRate`
- `screenPageViews`, `eventCount`
- `keyEvents` (the current name; `conversions` is not used)

**Behaviour:**
- Results are paginated (limit 10,000 with offset), and metrics are mapped by header name.
- Missing values stay **null**, and a day with no data has no row. Ratios are recomputed, never summed.
- Rows are stored in `ga4_metric_rows` and upserted by (website, property, date, dimension, value), so re-syncs never duplicate.

## Date ranges
- **Presets:** 7, 28, 30 or 90 days, or custom (at most 16 months).
- **Window:** complete days ending yesterday, in the property's time zone (taken from the report metadata and stored).
- **Comparison:** the previous period has the same length, and both periods are synced.

## Needed from the owner
- **Google Cloud project:**
  - an OAuth client of type "Web";
  - the redirect URI `<app origin>/oauth/google/callback`;
  - the consent screen set up, with test users while unverified;
  - the Analytics Admin API and Analytics Data API enabled.
- **Edge secrets:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `INTEGRATION_ENCRYPTION_KEY`.
- Approval to deploy `integration-google`, and to authorize the Lugenix Google account.

Google Site Kit is installed on the site, but that does not grant this platform any access.

## 2026-11-20 additions (ADPOST/POD pilot readiness, local only)
- **One property per website:** `selectGoogleProperty` refuses a GA4 property or Search Console site already used by another integration (before any Google request). Migration **0012** enforces the same rule in the database. Disconnecting frees the property. This keeps the ADPOST and POD data apart.
- **Audit trail:** authorization, property selection, WordPress connection and disconnection write `platform_audit_events` (website, client, agency, actor). Details carry the provider, the property id and the scopes, never tokens, codes or secrets.
- **Period comparisons:** `_shared/integrations/compare.ts` compares current and previous ranges per website. Ratios are recomputed from totals (engagement rate, CTR, impression-weighted position), and missing periods stay null. It refuses rows from more than one website.
- **Callback route:** `/oauth/google/callback` in the app forwards state, code and error once to `integration-google` and drops them from the URL. In mock mode it says Google sign-in needs live mode.
- **Not done:** no real OAuth, no Google API call, no deployment. See STAGING_RELEASE_CHECKLIST.md §7–§11.
