// @vitest-environment node
/** Edge Function handlers with an in-memory ServerData fake (no Supabase, no provider). */
import { allowedHostsFor, handleAgentExecute, handleConnectionTest, HttpError, publicOutcome, USER_REQUESTS_PER_MINUTE, type AgentRow, type HandlerDeps, type ServerData } from '../../../../../supabase/functions/_shared/ai/handlers.ts';
import { AIProviderRegistry, SimulatedAdapter } from '../../../../../supabase/functions/_shared/ai/registry.ts';
import { AIToolGateway } from '../../../../../supabase/functions/_shared/ai/tools.ts';
import { EMPTY_USAGE } from '../../../../../supabase/functions/_shared/ai/budget.ts';
import { AGENCY, BRAND, conn, fakeFetch, jsonResponse, MemoryStore, model, policy, ScriptedAdapter, type Step } from './fakes';

const USER = 'user-priya';
const SITES = [
    { id: 'site-prod', name: 'POD production', domain: 'pod.example', websiteUrl: 'https://pod.example', status: 'active' },
    { id: 'site-stage', name: 'POD staging', domain: 'staging.pod.example', websiteUrl: 'https://staging.pod.example', status: 'active' },
    { id: 'site-draft', name: 'POD campaign', domain: null, websiteUrl: null, status: 'active' },
    { id: 'site-old', name: 'POD old', domain: 'old.pod.example', websiteUrl: 'https://old.pod.example', status: 'archived' },
];
const agentRow = (id: string, handle: string, name: string, templateKey: string, tools: string[] = ['create_task']): AgentRow => ({
    id, handle, name, templateKey, team: 'seo', active: true, instructions: `You are ${name}.`, tools, limits: { maxOutputTokens: 800, maxRunsPerDay: 50, monthlyBudgetUsd: 25 },
});

function fixture(steps: Step[], over: Partial<ServerData> = {}) {
    const adapter = new ScriptedAdapter('anthropic', steps);
    const store = new MemoryStore();
    const recorded: unknown[] = [];
    const data: ServerData = {
        userId: USER,
        message: async (id) => (id === 'msg-1' ? { id, conversationId: 'conv-1', brandId: BRAND, authorUserId: USER, body: 'What is good for my website?', mentions: [] } : id === 'msg-other' ? { id, conversationId: 'conv-1', brandId: BRAND, authorUserId: 'someone-else', body: 'x', mentions: [] } : null),
        conversation: async (id) => (id === 'conv-1' ? { id, brandId: BRAND, kind: 'direct', teamKey: null, agentInstanceIds: ['agent-mgr'], archived: false, websiteId: null } : null),
        brand: async (id) => (id === BRAND ? { brandId: BRAND, agencyId: AGENCY, brandName: 'POD', canWrite: true, websites: SITES } : null),
        agents: async () => [agentRow('agent-mgr', 'seo-manager', 'SEO Manager', 'seo_manager', ['create_task', 'delegate']), agentRow('agent-tech', 'technical-seo', 'Technical SEO Agent', 'technical_seo')],
        history: async () => [
            { authorType: 'user', authorName: 'Priya', body: 'Earlier question', agentInstanceId: null },
            { authorType: 'agent', authorName: 'SEO Manager', body: 'Earlier answer', agentInstanceId: 'agent-mgr' },
            { authorType: 'system', authorName: 'System', body: 'notice', agentInstanceId: null },
        ],
        searchKnowledge: async () => [],
        visibleConnection: async (id) => (id === 'conn-anthropic' ? conn() : null),
        routing: async () => ({
            assignments: [{ agentInstanceId: 'agent-mgr', connectionId: 'conn-anthropic', modelId: 'model-a', generationConfig: {}, fallbackPolicy: 'disabled', fallbackConnectionId: null, fallbackModelId: null, enabled: true }],
            connections: [conn()], models: [model()], brandPolicy: policy({ brandId: BRAND }), orgPolicy: policy(),
        }),
        usage: async () => EMPTY_USAGE,
        requestsInLastMinute: async () => 0,
        store,
        recordConnectionTest: async (r) => { recorded.push(r); },
        ...over,
    };
    const deps: HandlerDeps = {
        data, registry: new AIProviderRegistry([adapter, new SimulatedAdapter()]), gateway: new AIToolGateway(), env: (n) => (n === 'ANTHROPIC_API_KEY' ? 'fake-a-val' : undefined),
        fetch: fakeFetch(() => jsonResponse(200, { data: [{ id: 'model-a' }] })).fetch, resolveDns: null, sleep: async () => {},
    };
    return { deps, adapter, store, recorded };
}

describe('agent-execute handler', () => {
    it('runs the caller’s own message through the assigned provider with conversation context', async () => {
        const { deps, adapter } = fixture([{ text: 'Which website should I look at?' }]);
        const r = await handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'msg-1-attempt-1' }, deps);
        expect(r.steps).toHaveLength(1);
        expect(r.steps[0]!.outcome).toMatchObject({ status: 'succeeded', mode: 'live', provider: 'anthropic', text: 'Which website should I look at?' });
        expect(adapter.requests[0]!.messages).toEqual([
            { role: 'user', content: 'Priya: Earlier question' },
            { role: 'assistant', content: 'Earlier answer' },
            { role: 'user', content: 'What is good for my website?' },
        ]);
    });

    it.each([
        ['unauthenticated', { userId: null }, 'msg-1', 401],
        ['unknown message (or hidden by RLS)', {}, 'msg-missing', 404],
        ['someone else’s message', {}, 'msg-other', 403],
        ['read-only role', { brand: async () => ({ brandId: BRAND, agencyId: AGENCY, brandName: 'POD', canWrite: false, websites: [] }) }, 'msg-1', 403],
        ['archived conversation', { conversation: async () => ({ id: 'conv-1', brandId: BRAND, kind: 'direct' as const, teamKey: null, agentInstanceIds: ['agent-mgr'], archived: true, websiteId: null }) }, 'msg-1', 409],
        ['conversation of another brand', { conversation: async () => ({ id: 'conv-1', brandId: 'brand-dmd', kind: 'direct' as const, teamKey: null, agentInstanceIds: [], archived: false, websiteId: null }) }, 'msg-1', 404],
        ['rate limit', { requestsInLastMinute: async () => USER_REQUESTS_PER_MINUTE }, 'msg-1', 429],
    ])('refuses: %s', async (_label, over, messageId, status) => {
        const { deps, adapter } = fixture([{ text: 'no' }], over as Partial<ServerData>);
        const e = await handleAgentExecute({ messageId, idempotencyKey: 'key-12345678' }, deps).catch((x) => x);
        expect(e).toBeInstanceOf(HttpError);
        expect(e.status).toBe(status);
        expect(adapter.requests).toHaveLength(0);
    });

    it('requires an idempotency key and returns the stored result for a repeated key', async () => {
        const { deps, adapter } = fixture([{ text: 'once' }, { text: 'twice' }]);
        await expect(handleAgentExecute({ messageId: 'msg-1', idempotencyKey: '' }, deps)).rejects.toMatchObject({ status: 400 });
        await handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'same-key-1' }, deps);
        const again = await handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'same-key-1' }, deps);
        expect(again.steps[0]!.outcome).toMatchObject({ duplicate: true, text: 'once' });
        expect(adapter.requests).toHaveLength(1);
    });

    it('team conversations run the bounded orchestrator with per-agent routes', async () => {
        const { deps, adapter } = fixture([
            { text: 'Plan.', toolCalls: [{ id: 'd', name: 'delegate', input: { handle: 'technical-seo', brief: 'Audit robots.txt' } }] },
            { text: 'Delegated.' },
        ], {
            conversation: async () => ({ id: 'conv-1', brandId: BRAND, kind: 'group', teamKey: 'seo', agentInstanceIds: ['agent-mgr', 'agent-tech'], archived: false, websiteId: null }),
        });
        const r = await handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'team-key-1' }, deps);
        // The specialist has no assignment and no defaults: it fails visibly; the lead's turn is unaffected.
        expect(r.steps.map((s) => [s.agentInstanceId, s.role, s.outcome.status])).toEqual([
            ['agent-mgr', 'lead', 'succeeded'],
            ['agent-tech', 'specialist', 'failed'],
        ]);
        expect(r.steps[1]!.outcome.errorCategory).toBe('not_configured');
        expect(adapter.requests).toHaveLength(2);
    });

    it('public outcomes carry no prompts or credentials', async () => {
        const { deps } = fixture([{ text: 'ok' }]);
        const r = await handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'key-public-1' }, deps);
        const pub = JSON.stringify(publicOutcome(r.steps[0]!.outcome));
        expect(pub).not.toContain('fake-a-val');
        expect(pub).not.toContain('You are SEO Manager');
    });
});

describe('website and client scope', () => {
    const brand = { brandId: BRAND, agencyId: AGENCY, brandName: 'POD', canWrite: true, websites: SITES };

    it('tools may fetch only active websites with a URL, and only the scoped website when set', () => {
        expect(allowedHostsFor(brand, null)).toEqual(['pod.example', 'staging.pod.example']);
        expect(allowedHostsFor(brand, 'site-stage')).toEqual(['staging.pod.example']);
        expect(allowedHostsFor(brand, 'site-draft')).toEqual([]);
        expect(allowedHostsFor(brand, 'site-old')).toEqual([]);
    });

    it('a website-scoped conversation tells the agent its scope and the client boundary', async () => {
        const { deps, adapter } = fixture([{ text: 'ok' }], {
            conversation: async () => ({ id: 'conv-1', brandId: BRAND, kind: 'direct', teamKey: null, agentInstanceIds: ['agent-mgr'], archived: false, websiteId: 'site-draft' }),
        });
        await handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'scoped-key-1' }, deps);
        const system = adapter.requests[0]!.system;
        expect(system).toContain('scoped to the website "POD campaign" (no URL yet: it cannot be fetched or audited)');
        expect(system).toContain("Use only this client's data; never information from other clients or agencies.");
    });

    it('a conversation scoped to a website the caller cannot see is refused', async () => {
        const { deps, adapter } = fixture([{ text: 'no' }], {
            conversation: async () => ({ id: 'conv-1', brandId: BRAND, kind: 'direct', teamKey: null, agentInstanceIds: ['agent-mgr'], archived: false, websiteId: 'site-of-another-client' }),
        });
        await expect(handleAgentExecute({ messageId: 'msg-1', idempotencyKey: 'scoped-key-2' }, deps)).rejects.toMatchObject({ status: 404 });
        expect(adapter.requests).toHaveLength(0);
    });
});

describe('ai-connection-test handler', () => {
    it('tests only connections visible to the caller and records the result server-side', async () => {
        const { deps, recorded } = fixture([]);
        const r = await handleConnectionTest({ connectionId: 'conn-anthropic' }, deps);
        expect(r).toMatchObject({ ok: true, status: 'connected', models: [{ id: 'model-a' }] });
        expect(recorded).toHaveLength(1);
        await expect(handleConnectionTest({ connectionId: 'conn-hidden' }, deps)).rejects.toMatchObject({ status: 404 });
        await expect(handleConnectionTest({ connectionId: 'conn-anthropic' }, { ...deps, data: { ...deps.data, userId: null } })).rejects.toMatchObject({ status: 401 });
    });
});
