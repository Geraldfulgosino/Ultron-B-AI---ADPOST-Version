/**
 * ai-connection-test: verifies an AI provider connection with the provider's free
 * model-listing endpoint and records the result. POST { connectionId } with the user's JWT.
 * Visibility (agency staff or the brand's admins) is enforced by RLS on the connection row.
 * Returns status metadata only; never the credential.
 *
 * STATUS: implemented; NOT deployed (needs owner approval and an authorized API account).
 */
// @ts-nocheck: Deno runtime file; type-checked by `supabase functions deploy`.
import { clientsFor, cors, env, json } from '../_shared/edge.ts';
import { handleConnectionTest, HttpError } from '../_shared/ai/handlers.ts';
import { AIProviderRegistry } from '../_shared/ai/registry.ts';
import { createSupabaseData } from '../_shared/ai/supabaseData.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed.' });
    try {
        const body = await req.json().catch(() => ({}));
        const { user, admin, userId } = await clientsFor(req);
        const r = await handleConnectionTest({ connectionId: String(body?.connectionId ?? '') }, {
            data: createSupabaseData(user, admin, userId), registry: new AIProviderRegistry(), env, fetch: globalThis.fetch.bind(globalThis),
        });
        return json(req, 200, {
            connectionId: r.connectionId, ok: r.ok, status: r.status, errorCategory: r.errorCategory, message: r.message,
            modelsReported: r.models.length, latencyMs: r.latencyMs, testedAt: r.testedAt, ranOnServer: true,
        });
    } catch (e) {
        if (e instanceof HttpError) return json(req, e.status, { error: e.message });
        console.error('ai-connection-test failed', e instanceof Error ? e.name : 'unknown');
        return json(req, 500, { error: 'Connection test failed.' });
    }
});
