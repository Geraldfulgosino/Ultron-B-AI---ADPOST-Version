/**
 * integration-google: Google Analytics 4 and Search Console for a website (read-only scopes).
 * POST { action, websiteId?, provider?, ... } with the user's JWT.
 *   start      { websiteId, provider }            admins: returns the Google consent URL
 *   callback   { state, code?, error? }           the app's /oauth/google/callback route forwards
 *                                                 Google's query here WITH the user's JWT, so the
 *                                                 state can be bound to the same signed-in user
 *   properties { websiteId, provider }            admins: properties the Google account can access
 *   select     { websiteId, provider, propertyId } admins: verified with a real API request
 *   sync       { websiteId, provider, preset?, from?, to? }   staff with write access
 *
 * Secrets (Edge only): GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
 * GOOGLE_OAUTH_REDIRECT_URI (= <app origin>/oauth/google/callback, registered in Google Cloud),
 * INTEGRATION_ENCRYPTION_KEY.
 *
 * STATUS: implemented; NOT deployed. Needs migrations 0006–0010 on staging, a Google Cloud OAuth
 * client (owner), and owner approval. No Google request has been made.
 */
// @ts-nocheck: Deno runtime file; type-checked by `supabase functions deploy`.
import { clientsFor, cors, env, json, resolveDns } from '../_shared/edge.ts';
import { IntegrationError } from '../_shared/integrations/types.ts';
import { importKey } from '../_shared/integrations/secrets.ts';
import { supabaseRepository } from '../_shared/integrations/supabaseRepo.ts';
import { completeGoogleAuthorization, listGoogleProperties, selectGoogleProperty, startGoogleAuthorization, syncGoogleAnalytics, syncSearchConsole } from '../_shared/integrations/googleSync.ts';

const HTTP_STATUS = { not_found: 404, permission_denied: 403, auth_failed: 400, credentials_expired: 409, rate_limited: 429, limit_exceeded: 429, site_mismatch: 409, not_configured: 409, invalid_response: 400 };
const PRESETS = ['last_7_days', 'last_28_days', 'last_30_days', 'last_90_days', 'custom'];

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed.' });
    let body;
    try { body = await req.json(); } catch { return json(req, 400, { error: 'Invalid JSON.' }); }
    try {
        const oauth = { clientId: env('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'), redirectUri: env('GOOGLE_OAUTH_REDIRECT_URI') };
        if (!oauth.clientId || !oauth.clientSecret || !oauth.redirectUri) throw new IntegrationError('not_configured', 'Google integration is not configured on the server.');
        const { user, admin, userId } = await clientsFor(req);
        if (!userId) return json(req, 401, { error: 'Sign in required.' });
        const keyPromise = importKey(env('INTEGRATION_ENCRYPTION_KEY'));
        keyPromise.catch(() => undefined);
        const ctx = { userId, http: { fetch, resolve: resolveDns }, repo: supabaseRepository(user, admin, keyPromise), oauth };
        const provider = ['google_analytics', 'google_search_console'].includes(body?.provider) ? body.provider : null;
        const websiteId = String(body?.websiteId ?? '');
        const needSite = () => { if (!/^[0-9a-f-]{36}$/i.test(websiteId) || !provider) throw new IntegrationError('invalid_response', 'websiteId and provider are required.'); };
        switch (body?.action) {
            case 'start': needSite(); return json(req, 200, await startGoogleAuthorization(ctx, websiteId, provider));
            case 'callback': return json(req, 200, await completeGoogleAuthorization(ctx, { state: body.state ?? null, code: body.code ?? null, error: body.error ?? null }));
            case 'properties': needSite(); return json(req, 200, await listGoogleProperties(ctx, websiteId, provider));
            case 'select': needSite(); return json(req, 200, await selectGoogleProperty(ctx, websiteId, provider, String(body.propertyId ?? '')));
            case 'sync': {
                needSite();
                const preset = PRESETS.includes(body.preset) ? body.preset : 'last_28_days';
                const custom = preset === 'custom' ? { from: String(body.from ?? ''), to: String(body.to ?? '') } : undefined;
                return json(req, 200, provider === 'google_analytics' ? await syncGoogleAnalytics(ctx, websiteId, preset, custom) : await syncSearchConsole(ctx, websiteId, preset, custom));
            }
            default: return json(req, 400, { error: 'Unknown action.' });
        }
    } catch (e) {
        if (e instanceof IntegrationError) return json(req, HTTP_STATUS[e.category] ?? 502, { error: e.message, category: e.category, retryAfterSeconds: e.retryAfterSeconds });
        console.error('integration-google failed', e instanceof Error ? e.name : 'unknown');
        return json(req, 500, { error: 'Google integration request failed.' });
    }
});
