/**
 * agent-execute: runs the agent(s) for a chat message the caller just posted.
 * POST { messageId, idempotencyKey, stream?: boolean } with the user's JWT.
 * Model credentials are read from server secret slots; the browser never sees them.
 * With stream=true the response is Server-Sent Events: `text`, `status` and a final `result`.
 * Closing the request (Stop generation) aborts the provider call.
 *
 * STATUS: implemented; NOT deployed (deployment and live model calls need owner approval).
 */
// @ts-nocheck: Deno runtime file; type-checked by `supabase functions deploy`.
import { clientsFor, cors, env, json, resolveDns } from '../_shared/edge.ts';
import { handleAgentExecute, HttpError, publicOutcome } from '../_shared/ai/handlers.ts';
import { AIProviderRegistry } from '../_shared/ai/registry.ts';
import { AIToolGateway } from '../_shared/ai/tools.ts';
import { createSupabaseData } from '../_shared/ai/supabaseData.ts';

const summarize = (r) => ({
    conversationId: r.conversationId, notices: r.notices, stoppedBy: r.stoppedBy,
    steps: r.steps.map((s) => ({ agentInstanceId: s.agentInstanceId, role: s.role, outcome: publicOutcome(s.outcome) })),
});

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed.' });
    let body;
    try {
        body = await req.json();
    } catch {
        return json(req, 400, { error: 'Invalid JSON.' });
    }
    try {
        const { user, admin, userId } = await clientsFor(req);
        const deps = {
            data: createSupabaseData(user, admin, userId), registry: new AIProviderRegistry(), gateway: new AIToolGateway(),
            env, fetch: globalThis.fetch.bind(globalThis), resolveDns,
        };
        const input = { messageId: String(body?.messageId ?? ''), idempotencyKey: String(body?.idempotencyKey ?? '') };
        if (!body?.stream) return json(req, 200, summarize(await handleAgentExecute(input, deps, req.signal)));

        const enc = new TextEncoder();
        const stream = new ReadableStream({
            async start(ctl) {
                const send = (event, data) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                try {
                    const r = await handleAgentExecute(input, deps, req.signal, (agentId, e) => send(e.type, { agentId, ...e }));
                    send('result', summarize(r));
                } catch (e) {
                    send('error', { status: e instanceof HttpError ? e.status : 500, error: e instanceof HttpError ? e.message : 'Agent execution failed.' });
                } finally {
                    ctl.close();
                }
            },
        });
        return new Response(stream, { headers: { ...cors(req), 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
    } catch (e) {
        if (e instanceof HttpError) return json(req, e.status, { error: e.message });
        console.error('agent-execute failed', e instanceof Error ? e.name : 'unknown');
        return json(req, 500, { error: 'Agent execution failed.' });
    }
});
