import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { Scope } from './scope';
import { brandContext, runAgent } from './engine';
import { SimulatedProvider, SIMULATE_FAILURE_TOKEN, type CompletionRequest } from '@/ai/provider';
import { estimateCost, estimateTokens } from '@/domain/agents';

const { pod, dmd } = IDS.brands;
const podManager = 'agt_pod_seo_manager';
const ask = (content: string) => [{ role: 'user' as const, name: 'Priya', content }];

describe('agent registry', () => {
    it('every fixture brand has its own six agents', async () => {
        const db = testDb();
        expect((await as('priya', db).api.agents.list(pod)).map((a) => a.templateKey)).toEqual([
            'seo_manager', 'technical_seo', 'content_seo', 'statistics_seo', 'web_design', 'web_development',
        ]);
        expect(db.all('agentInstances').filter((a) => a.brandId === dmd)).toHaveLength(6);
    });

    it('new brands are provisioned with an independent agent set', async () => {
        const db = testDb();
        const brand = await as('alex', db).api.workspace.createBrand({ name: 'Northwind' });
        const agents = await as('alex', db).api.agents.list(brand.id);
        expect(agents).toHaveLength(6);
        const v = await as('alex', db).api.agents.instructionVersions(brand.id, agents[0]!.id);
        expect(v[0]!.instructions).toContain('Northwind');
    });

    it('is isolated per brand and hidden from client users', async () => {
        await expect(as('priya').api.agents.list(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('priya').api.agents.get(pod, 'agt_dmd_seo_manager')).rejects.toBeInstanceOf(NotFoundError);
        await expect(as('casey').api.agents.list(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('only admins configure; limits and models are validated', async () => {
        const db = testDb();
        await expect(as('morgan', db).api.agents.update(pod, podManager, { active: false })).rejects.toBeInstanceOf(AccessDeniedError);
        const priya = as('priya', db).api;
        await expect(priya.agents.update(pod, podManager, { limits: { maxOutputTokens: 10 } })).rejects.toBeInstanceOf(ValidationError);
        await expect(priya.agents.update(pod, podManager, { model: { provider: 'openai', model: 'nope' } })).rejects.toBeInstanceOf(ValidationError);
        const a = await priya.agents.update(pod, podManager, { displayName: 'POD Lead', tools: ['read_analytics', 'read_analytics'] });
        expect(a).toMatchObject({ displayName: 'POD Lead', tools: ['read_analytics'] });
    });

    it('instruction versions publish and roll back', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        await expect(priya.agents.publishInstructions(pod, podManager, { instructions: 'x', note: '' })).rejects.toBeInstanceOf(ValidationError);
        const v2 = await priya.agents.publishInstructions(pod, podManager, { instructions: 'Be concise.', note: 'Tighter tone' });
        expect(v2.version).toBe(2);
        expect((await priya.agents.get(pod, podManager)).activeInstructionVersionId).toBe(v2.id);
        const back = await priya.agents.activateVersion(pod, podManager, 'ivr_pod_seo_manager_1');
        expect(back.activeInstructionVersionId).toBe('ivr_pod_seo_manager_1');
        await expect(priya.agents.activateVersion(pod, podManager, 'ivr_dmd_seo_manager_1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('provision rejects duplicates', async () => {
        await expect(as('priya').api.agents.provision(pod, 'seo_manager')).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('execution engine', () => {
    it('runs, records tokens/cost/mode, and reports usage', async () => {
        const db = testDb();
        const scope = new Scope(db, IDS.users.priya);
        const r = await runAgent(scope, pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask('What should we do this week?') });
        expect(r.execution).toMatchObject({ status: 'succeeded', mode: 'simulated', instructionVersion: 1 });
        expect(r.execution.costUsd).toBeGreaterThan(0);
        expect(r.response!.text).toContain('POD');
        const usage = (await as('priya', db).api.agents.usage(pod)).find((u) => u.agentInstanceId === podManager)!;
        expect(usage).toMatchObject({ runsToday: 1, runsMonth: 1 });
    });

    it('viewers cannot trigger runs; foreign agents are rejected', async () => {
        const db = testDb();
        await expect(runAgent(new Scope(db, IDS.users.vic), pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask('hi') })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(runAgent(new Scope(db, IDS.users.priya), pod, { agentInstanceId: 'agt_dmd_seo_manager', conversationId: null, triggerMessageId: null, messages: ask('hi') })).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('enforces inactive agents, daily runs, budget, and live-model gating', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        const scope = new Scope(db, IDS.users.priya);
        const run = () => runAgent(scope, pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask('status?') });

        await priya.agents.update(pod, podManager, { active: false });
        expect((await run()).execution).toMatchObject({ status: 'limited', error: expect.stringContaining('inactive') });

        await priya.agents.update(pod, podManager, { active: true, limits: { maxRunsPerDay: 1 } });
        expect((await run()).execution.status).toBe('succeeded');
        expect((await run()).execution).toMatchObject({ status: 'limited', error: expect.stringContaining('Daily run limit') });

        await priya.agents.update(pod, podManager, { limits: { maxRunsPerDay: 100, monthlyBudgetUsd: 0 } });
        expect((await run()).execution.error).toContain('Monthly budget');

        await priya.agents.update(pod, podManager, { limits: { monthlyBudgetUsd: 25 }, model: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });
        expect((await run()).execution).toMatchObject({ status: 'failed', error: expect.stringContaining('Phase 17') });
    });

    it('records provider failures as failed executions', async () => {
        const db = testDb();
        const r = await runAgent(new Scope(db, IDS.users.priya), pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask(`please ${SIMULATE_FAILURE_TOKEN}`) });
        expect(r).toMatchObject({ response: null, execution: { status: 'failed' } });
    });

    it('brand context only contains the brand\'s own data', () => {
        const db = testDb();
        const ctx = brandContext(new Scope(db, IDS.users.priya), pod, 'store');
        expect(ctx.teammates).toHaveLength(6);
        expect(ctx.topQueries.every((q) => q.query.startsWith('shop') || q.query.startsWith('blog'))).toBe(true);
    });
});

describe('simulated provider', () => {
    const base: CompletionRequest = {
        agent: { templateKey: 'seo_manager', displayName: 'SEO Manager', handle: 'seo-manager' },
        brandName: 'POD',
        instructions: 'x',
        context: {
            kpis: { sessions: 1000, clicks: 100, impressions: 5000, conversions: 20, window: 'the 28 days ending 2026-10-24' },
            insights: [{ title: 'Big drop', type: 'traffic_drop', severity: 'high' }],
            topQueries: [{ query: 'pod pricing', clicks: 3, impressions: 900 }],
            knowledge: [],
            teammates: [{ handle: 'technical-seo', name: 'Tech', active: true }, { handle: 'content-seo', name: 'Content', active: false }],
        },
        messages: ask('plan the technical and content work'),
        maxOutputTokens: 800,
        allowedTools: ['create_task', 'delegate'],
    };

    it('is deterministic and labels itself simulated', async () => {
        const p = new SimulatedProvider();
        const a = await p.complete(base);
        expect(await p.complete(base)).toEqual(a);
        expect(a.mode).toBe('simulated');
    });

    it('only proposes actions the agent is allowed to take, to active teammates', async () => {
        const r = await new SimulatedProvider().complete(base);
        expect(r.actions.map((x) => x.type === 'delegate' ? `delegate:${x.handle}` : x.type)).toEqual(['delegate:technical-seo', 'create_task']);
        const none = await new SimulatedProvider().complete({ ...base, allowedTools: [] });
        expect(none.actions).toEqual([]);
    });

    it('truncates at the output token limit', async () => {
        const r = await new SimulatedProvider().complete({ ...base, maxOutputTokens: 64 });
        expect(r.truncated).toBe(true);
        expect(r.text).toContain('[Truncated');
    });

    it('token and cost estimates', () => {
        expect(estimateTokens('abcd'.repeat(10))).toBe(10);
        expect(estimateCost({ provider: 'simulated', model: 'sim-deterministic-1' }, 1000, 1000)).toBe(0.018);
        expect(estimateCost({ provider: 'anthropic', model: 'claude-sonnet-5-5' }, 1000, 1000)).toBeNull();
    });
});
