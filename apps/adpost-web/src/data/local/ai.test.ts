/** AI provider connection manager (local adapter): access, validation, switching, honesty. Mirrors aiProviders.db.test.ts. */
import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { Scope } from './scope';
import { runAgent } from './engine';

const { pod, dmd } = IDS.brands;
const podManager = 'agt_pod_seo_manager';
const podTech = 'agt_pod_technical_seo';
const dmdManager = 'agt_dmd_seo_manager';
const ask = (content: string) => [{ role: 'user' as const, name: 'Priya', content }];

const newConn = { provider: 'openai' as const, scope: 'organization' as const, displayName: 'Company OpenAI API', credentialReference: 'OPENAI_API_KEY' };

describe('who can see and manage connections', () => {
    it('agency staff manage; brand admins view and assign; staff below admin and clients cannot view', async () => {
        const db = testDb();
        expect(await as('alex', db).api.ai.access(pod)).toEqual({ canManageConnections: true, canAssign: true, canViewAllUsage: true });
        expect(await as('priya', db).api.ai.access(pod)).toEqual({ canManageConnections: false, canAssign: true, canViewAllUsage: true });
        expect(await as('morgan', db).api.ai.access(pod)).toEqual({ canManageConnections: false, canAssign: false, canViewAllUsage: false });

        expect((await as('priya', db).api.ai.connections(pod)).map((c) => c.displayName)).toEqual(['Company Anthropic API', 'Simulator (offline)']);
        for (const u of ['morgan', 'vic', 'casey'] as const) await expect(as(u, db).api.ai.connections(pod)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('dana', db).api.ai.connections(pod)).rejects.toBeInstanceOf(AccessDeniedError);

        await expect(as('priya', db).api.ai.createConnection(pod, newConn)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('priya', db).api.ai.updateConnection(pod, 'aic_anthropic', { credentialReference: 'ANTHROPIC_API_KEY_X' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('priya', db).api.ai.removeConnection(pod, 'aic_anthropic')).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await as('alex', db).api.ai.createConnection(pod, newConn)).scope).toBe('organization');
    });

    it('brand-scoped connections stay inside their brand', async () => {
        const db = testDb();
        const c = await as('alex', db).api.ai.createConnection(pod, { ...newConn, scope: 'brand', displayName: 'POD OpenAI' });
        expect((await as('priya', db).api.ai.connections(pod)).some((x) => x.id === c.id)).toBe(true);
        expect((await as('alex', db).api.ai.connections(dmd)).some((x) => x.id === c.id)).toBe(false);
        await expect(as('alex', db).api.ai.connection(dmd, c.id)).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('credential handling', () => {
    it('accepts only server secret slot names for the provider, never a key', async () => {
        const { api } = as('alex');
        const fail = (credentialReference: string) => api.ai.createConnection(pod, { ...newConn, displayName: `x-${credentialReference.slice(0, 8)}`, credentialReference });
        for (const bad of ['sk-proj-abcdefghijkl', 'sk-ant-api03-abcdef', 'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'openai_api_key']) {
            await expect(fail(bad), bad).rejects.toBeInstanceOf(ValidationError);
        }
        expect((await fail('OPENAI_API_KEY_MARKETING')).credentialReference).toBe('OPENAI_API_KEY_MARKETING');
        await expect(api.ai.createConnection(pod, { provider: 'simulated', scope: 'organization', displayName: 'Sim 2', credentialReference: 'OPENAI_API_KEY' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('saving is never "connected"; rotation and re-enabling discard verification; renaming does not', async () => {
        const db = testDb();
        const { api } = as('alex', db);
        const c = await api.ai.createConnection(pod, newConn);
        expect(c.status).toBe('configured');
        const blank = await api.ai.createConnection(pod, { ...newConn, displayName: 'No slot', credentialReference: null });
        expect(blank.status).toBe('not_configured');

        db.patch('aiConnections', c.id, { status: 'connected', lastTestedAt: db.nowIso(), verifiedModels: ['gpt-a'] }); // what the server test would record
        expect((await api.ai.updateConnection(pod, c.id, { displayName: 'Renamed', monthlyBudgetUsd: 10 })).status).toBe('connected');
        expect(await api.ai.rotateCredential(pod, c.id, 'OPENAI_API_KEY_ROTATED')).toMatchObject({ status: 'configured', lastTestedAt: null, verifiedModels: [] });
        db.patch('aiConnections', c.id, { status: 'connected' });
        expect((await api.ai.updateConnection(pod, c.id, { enabled: false })).status).toBe('disabled');
        expect((await api.ai.updateConnection(pod, c.id, { enabled: true })).status).toBe('configured');
    });

    it('local connection tests are honest: no request, status unchanged; the simulator verifies', async () => {
        const db = testDb();
        const { api } = as('priya', db);
        const live = await api.ai.testConnection(pod, 'aic_anthropic');
        expect(live).toMatchObject({ ok: false, ranOnServer: false, status: 'configured', errorCategory: 'not_configured', message: expect.stringContaining('Nothing was sent') });
        expect(db.find('aiConnections', 'aic_anthropic')!.status).toBe('configured');
        expect(await api.ai.testConnection(pod, 'aic_simulator')).toMatchObject({ ok: true, status: 'connected' });
        expect((await api.ai.healthChecks(pod, 'aic_anthropic'))[0]).toMatchObject({ result: 'failure', failureCategory: 'not_configured' });
        expect(JSON.stringify(db.snapshot().aiConnections)).not.toMatch(/sk-|secret_value/);
    });
});

describe('agent assignment and provider switching', () => {
    it('brand admins assign; managers cannot; other brands’ connections and agents are refused', async () => {
        const db = testDb();
        const alex = as('alex', db).api;
        const priya = as('priya', db).api;
        const own = await alex.ai.createConnection(pod, { ...newConn, scope: 'brand', displayName: 'DMD only' }).then(() => alex.ai.createConnection(dmd, { ...newConn, scope: 'brand', displayName: 'DMD OpenAI' }));
        const a = await priya.ai.assign(pod, podManager, { connectionId: 'aic_simulator', modelId: 'sim-deterministic-1', fallbackPolicy: 'disabled' });
        expect(a).toMatchObject({ provider: 'simulated', connectionName: 'Simulator (offline)', warnings: [expect.stringContaining('Simulated')] });
        await expect(as('morgan', db).api.ai.assign(pod, podManager, { connectionId: 'aic_simulator', modelId: 'x', fallbackPolicy: 'disabled' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.ai.assign(pod, podManager, { connectionId: own.id, modelId: 'gpt-a', fallbackPolicy: 'disabled' })).rejects.toBeInstanceOf(ValidationError);
        await expect(priya.ai.assign(pod, dmdManager, { connectionId: 'aic_simulator', modelId: 'x', fallbackPolicy: 'disabled' })).rejects.toBeInstanceOf(NotFoundError);
        expect((await as('morgan', db).api.ai.assignments(pod)).map((x) => x.agentInstanceId)).toEqual([podManager]);
        await expect(as('casey', db).api.ai.assignments(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('switching providers changes the next run, keeps history, and a live provider fails visibly instead of simulating', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        const scope = new Scope(db, IDS.users.priya);
        const run = () => runAgent(scope, pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask('What is good for my website?') });

        await priya.ai.assign(pod, podManager, { connectionId: 'aic_simulator', modelId: 'sim-deterministic-1', fallbackPolicy: 'disabled' });
        const first = await run();
        expect(first.execution).toMatchObject({ status: 'succeeded', mode: 'simulated', provider: 'simulated', connectionId: 'aic_simulator' });

        const a = await priya.ai.assign(pod, podManager, { connectionId: 'aic_anthropic', modelId: 'claude-model', fallbackPolicy: 'disabled' });
        expect(a.warnings.join(' ')).toMatch(/not verified/);
        const second = await run();
        expect(second.response).toBeNull();
        expect(second.execution).toMatchObject({ status: 'failed', provider: 'anthropic', model: 'claude-model', connectionId: 'aic_anthropic', error: expect.stringContaining('not verified') });

        db.patch('aiConnections', 'aic_anthropic', { status: 'connected' });
        expect((await run()).execution.error).toMatch(/server-side agent-execute.*never substitutes a simulated answer/);

        // History is preserved and records what each run actually used.
        const runs = db.all('executions').filter((e) => e.agentInstanceId === podManager);
        expect(runs.map((e) => e.provider)).toEqual(['simulated', 'anthropic', 'anthropic']);
        expect(db.all('aiUsage').filter((u) => u.agentInstanceId === podManager).map((u) => [u.provider, u.executionStatus])).toEqual([['simulated', 'succeeded'], ['anthropic', 'failed'], ['anthropic', 'failed']]);
    });

    it('a removed connection cannot strand agents; disabling makes runs fail with an explanation', async () => {
        const db = testDb();
        const alex = as('alex', db).api;
        await alex.ai.assign(pod, podTech, { connectionId: 'aic_simulator', modelId: 'sim-deterministic-1', fallbackPolicy: 'disabled' });
        await expect(alex.ai.removeConnection(pod, 'aic_simulator')).rejects.toThrow(/Reassign 1 agent/);
        await alex.ai.updateConnection(pod, 'aic_simulator', { enabled: false });
        const r = await runAgent(new Scope(db, IDS.users.alex), pod, { agentInstanceId: podTech, conversationId: null, triggerMessageId: null, messages: ask('hi') });
        expect(r.execution).toMatchObject({ status: 'failed', error: expect.stringContaining('disabled') });
    });

    it('cross-provider fallback needs organization and brand consent; brand admins cannot grant organization consent', async () => {
        const db = testDb();
        const alex = as('alex', db).api;
        const priya = as('priya', db).api;
        const openai = await alex.ai.createConnection(pod, newConn);
        const input = { connectionId: 'aic_anthropic', modelId: 'claude-model', fallbackPolicy: 'secondary_provider' as const, fallbackConnectionId: openai.id, fallbackModelId: 'gpt-a' };
        await expect(priya.ai.assign(pod, podManager, input)).rejects.toThrow(/consent/);
        await priya.ai.updatePolicy(pod, 'brand', { allowCrossProviderFallback: true });
        await expect(priya.ai.assign(pod, podManager, input)).rejects.toThrow(/consent/);
        await expect(priya.ai.updatePolicy(pod, 'organization', { allowCrossProviderFallback: true })).rejects.toBeInstanceOf(AccessDeniedError);
        await alex.ai.updatePolicy(pod, 'organization', { allowCrossProviderFallback: true });
        expect((await priya.ai.assign(pod, podManager, input)).fallbackConnectionId).toBe(openai.id);
    });
});

describe('routing defaults, model catalog, usage and audit', () => {
    it('brand and organization defaults serve agents without an assignment; the organization default must be organization-wide', async () => {
        const db = testDb();
        const alex = as('alex', db).api;
        const brandConn = await alex.ai.createConnection(pod, { provider: 'simulated', scope: 'brand', displayName: 'POD Sim' });
        await expect(alex.ai.updatePolicy(pod, 'organization', { defaultConnectionId: brandConn.id, defaultModel: 'sim-deterministic-1' })).rejects.toBeInstanceOf(ValidationError);
        await alex.ai.updatePolicy(pod, 'organization', { defaultConnectionId: 'aic_simulator', defaultModel: 'sim-deterministic-1' });
        const r = await runAgent(new Scope(db, IDS.users.alex), dmd, { agentInstanceId: dmdManager, conversationId: null, triggerMessageId: null, messages: ask('hi') });
        expect(r.execution).toMatchObject({ status: 'succeeded', connectionId: 'aic_simulator' });
    });

    it('prices need a source; only agency staff curate the catalog; staff can read it', async () => {
        const db = testDb();
        const alex = as('alex', db).api;
        await expect(alex.ai.saveModel(pod, { provider: 'anthropic', modelId: 'claude-model', displayName: 'Claude', capabilities: ['text', 'tools'], inputUsdPerMTok: 3, outputUsdPerMTok: 15 })).rejects.toBeInstanceOf(ValidationError);
        await expect(alex.ai.saveModel(pod, { provider: 'anthropic', modelId: 'claude-model', displayName: 'Claude', capabilities: ['text'], inputUsdPerMTok: 3 , pricingSource: 'x' })).rejects.toBeInstanceOf(ValidationError);
        const m = await alex.ai.saveModel(pod, { provider: 'anthropic', modelId: 'claude-model', displayName: 'Claude', capabilities: ['text', 'tools'], inputUsdPerMTok: 3, outputUsdPerMTok: 15, pricingSource: 'Owner-entered from the provider pricing page' });
        expect(m.pricingVerifiedAt).not.toBeNull();
        await expect(as('priya', db).api.ai.saveModel(pod, { provider: 'openai', modelId: 'x', displayName: 'x', capabilities: [] })).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await as('morgan', db).api.ai.models(pod)).map((x) => x.modelId)).toContain('claude-model');
    });

    it('usage: admins see the brand, staff see their own requests, other brands nothing', async () => {
        const db = testDb();
        await as('alex', db).api.ai.assign(pod, podManager, { connectionId: 'aic_simulator', modelId: 'sim-deterministic-1', fallbackPolicy: 'disabled' });
        await runAgent(new Scope(db, IDS.users.priya), pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask('a') });
        await runAgent(new Scope(db, IDS.users.morgan), pod, { agentInstanceId: podManager, conversationId: null, triggerMessageId: null, messages: ask('b') });
        const brand = await as('priya', db).api.ai.usage(pod);
        expect(brand).toMatchObject({ scope: 'brand', totals: { requests: 2, failures: 0, estimatedCostUsd: null, unpriced: 0 } });
        expect(brand.byUser.map((r) => r.label).sort()).toEqual(['Morgan Lee', 'Priya Shah']);
        expect(brand.byProvider).toEqual([expect.objectContaining({ label: 'Simulated (offline)', requests: 2 })]);
        const own = await as('morgan', db).api.ai.usage(pod);
        expect(own).toMatchObject({ scope: 'own', totals: { requests: 1 } });
        expect((await as('alex', db).api.ai.usage(dmd)).totals.requests).toBe(0);
        await expect(as('casey', db).api.ai.usage(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('audit records who changed which fields, never values', async () => {
        const db = testDb();
        const alex = as('alex', db).api;
        await alex.ai.rotateCredential(pod, 'aic_anthropic', 'ANTHROPIC_API_KEY_NEW');
        const events = await alex.ai.audit(pod);
        expect(events[0]).toMatchObject({ action: 'update', subjectId: 'aic_anthropic', actorId: IDS.users.alex, changedColumns: ['credential_reference'] });
        expect(JSON.stringify(events)).not.toContain('ANTHROPIC_API_KEY_NEW');
    });
});
