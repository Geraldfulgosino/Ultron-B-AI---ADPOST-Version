/**
 * integration-sync: server-side website integration actions (WordPress, technical crawl).
 * POST { action, websiteId, ... } with the user's JWT.
 *   discover                      public WordPress discovery (no credentials)
 *   wp_connect { username, applicationPassword }   admins only; stored encrypted after WordPress accepts it
 *   wp_sync { types? }            inventory sync (public, or authenticated if credentials are stored)
 *   crawl { maxPages?, maxDepth? }   bounded technical SEO crawl
 *   disconnect { provider }       admins only; deletes stored credentials (Google grants are revoked)
 *
 * Permission: public.integration_permissions(websiteId) evaluated with the CALLER's JWT.
 * Website: loaded with the caller's JWT (RLS). Writes: service role, after those checks.
 * Rate limit: at most 12 runs per website in 10 minutes.
 *
 * STATUS: implemented; NOT deployed. Needs migrations 0006–0010 on staging, the secret
 * INTEGRATION_ENCRYPTION_KEY (32 random bytes, base64) and owner approval.
 */
// @ts-nocheck: Deno runtime file; type-checked by `supabase functions deploy`.
import { clientsFor, cors, env, json, resolveDns } from '../_shared/edge.ts';
import { IntegrationError } from '../_shared/integrations/types.ts';
import { importKey } from '../_shared/integrations/secrets.ts';
import { supabaseRepository } from '../_shared/integrations/supabaseRepo.ts';
import { connectWordPressCredentials, disconnectIntegration, discoverWordPressSite, runTechnicalCrawl, syncWordPressContent } from '../_shared/integrations/sync.ts';
import { revokeGoogleToken } from '../_shared/integrations/google.ts';

const HTTP_STATUS = { not_found: 404, permission_denied: 403, auth_failed: 400, credentials_expired: 409, rate_limited: 429, limit_exceeded: 429, blocked_url: 400, site_mismatch: 409, not_wordpress: 422, not_configured: 503 };

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed.' });
    let body;
    try { body = await req.json(); } catch { return json(req, 400, { error: 'Invalid JSON.' }); }
    try {
        const { user, admin, userId } = await clientsFor(req);
        if (!userId) return json(req, 401, { error: 'Sign in required.' });
        const websiteId = String(body?.websiteId ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(websiteId)) return json(req, 400, { error: 'websiteId is required.' });
        const keyPromise = importKey(env('INTEGRATION_ENCRYPTION_KEY'));
        keyPromise.catch(() => undefined);
        const ctx = { userId, http: { fetch, resolve: resolveDns }, repo: supabaseRepository(user, admin, keyPromise) };
        switch (body?.action) {
            case 'discover': return json(req, 200, await discoverWordPressSite(ctx, websiteId));
            case 'wp_connect': return json(req, 200, await connectWordPressCredentials(ctx, websiteId, { username: String(body.username ?? ''), applicationPassword: String(body.applicationPassword ?? '') }));
            case 'wp_sync': return json(req, 200, await syncWordPressContent(ctx, websiteId, Array.isArray(body.types) ? body.types.filter((t) => ['page', 'post', 'category', 'tag', 'media'].includes(t)) : undefined));
            case 'crawl': return json(req, 200, await runTechnicalCrawl(ctx, websiteId, { maxPages: Number(body.maxPages) || undefined, maxDepth: Number(body.maxDepth) || undefined }));
            case 'disconnect': {
                const provider = ['wordpress', 'google_analytics', 'google_search_console', 'site_crawler'].includes(body.provider) ? body.provider : null;
                if (!provider) return json(req, 400, { error: 'Unknown provider.' });
                const revoke = provider.startsWith('google_') ? async (s) => { if (s?.refreshToken) await revokeGoogleToken(s.refreshToken, fetch); } : undefined;
                return json(req, 200, await disconnectIntegration(ctx, websiteId, provider, revoke));
            }
            default: return json(req, 400, { error: 'Unknown action.' });
        }
    } catch (e) {
        if (e instanceof IntegrationError) return json(req, HTTP_STATUS[e.category] ?? 502, { error: e.message, category: e.category, retryAfterSeconds: e.retryAfterSeconds });
        console.error('integration-sync failed', e instanceof Error ? e.name : 'unknown');
        return json(req, 500, { error: 'Integration request failed.' });
    }
});
