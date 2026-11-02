// @vitest-environment node
/** Model routing, provider switching, fallback consent, budgets and secret slots. */
import { resolveRoute, shouldFallback, type AssignmentConfig, type RouteInput } from '../../../../../supabase/functions/_shared/ai/routing.ts';
import { checkBudget, costUsd, EMPTY_USAGE, type BudgetInput } from '../../../../../supabase/functions/_shared/ai/budget.ts';
import { AIProviderRegistry, resolveSecret, secretSlotStatus } from '../../../../../supabase/functions/_shared/ai/registry.ts';
import { AGENCY, BRAND, conn, model, policy } from './fakes';

const registry = new AIProviderRegistry();
const openai = conn({ id: 'conn-openai', provider: 'openai', displayName: 'POD OpenAI', brandId: BRAND, credentialReference: 'OPENAI_API_KEY', verifiedModels: ['gpt-a'] });
const anthropic = conn();
const assignment = (over: Partial<AssignmentConfig> = {}): AssignmentConfig => ({
    agentInstanceId: 'agent-1', connectionId: anthropic.id, modelId: 'model-a', generationConfig: {}, fallbackPolicy: 'disabled',
    fallbackConnectionId: null, fallbackModelId: null, enabled: true, ...over,
});
const input = (over: Partial<RouteInput> = {}): RouteInput => ({
    agencyId: AGENCY, brandId: BRAND, connections: [anthropic, openai], models: [model(), model({ provider: 'openai', modelId: 'gpt-a', capabilities: ['text'] })],
    adapterCapabilities: (p) => registry.get(p).capabilities, required: ['text'], optional: ['tools'], ...over,
});

describe('routing priority', () => {
    it('override → assignment → brand default → organization default → platform fallback', () => {
        const brandPolicy = policy({ brandId: BRAND, defaultConnectionId: openai.id, defaultModel: 'gpt-a' });
        const orgPolicy = policy({ defaultConnectionId: anthropic.id, defaultModel: 'model-b' });
        const all = { assignment: assignment(), brandPolicy, orgPolicy, platformFallback: { connectionId: anthropic.id, modelId: 'model-b' } };
        expect(resolveRoute(input({ ...all, override: { connectionId: openai.id, modelId: 'gpt-a', authorized: true } })).source).toBe('conversation_override');
        expect(resolveRoute(input(all))).toMatchObject({ source: 'agent_assignment', primary: { modelId: 'model-a' } });
        expect(resolveRoute(input({ ...all, assignment: null }))).toMatchObject({ source: 'brand_default', primary: { modelId: 'gpt-a' } });
        expect(resolveRoute(input({ ...all, assignment: assignment({ enabled: false }), brandPolicy: null }))).toMatchObject({ source: 'organization_default', primary: { modelId: 'model-b' } });
        expect(resolveRoute(input({ platformFallback: all.platformFallback })).source).toBe('platform_fallback');
        expect(() => resolveRoute(input())).toThrow(expect.objectContaining({ category: 'not_configured' }));
    });

    it('switching the assignment changes the provider of the next turn with no code change', () => {
        expect(resolveRoute(input({ assignment: assignment() })).primary.connection.provider).toBe('anthropic');
        expect(resolveRoute(input({ assignment: assignment({ connectionId: openai.id, modelId: 'gpt-a' }) })).primary.connection.provider).toBe('openai');
    });

    it('an unauthorized override is refused and never silently ignored', () => {
        expect(() => resolveRoute(input({ assignment: assignment(), override: { connectionId: openai.id, modelId: 'gpt-a', authorized: false } })))
            .toThrow(expect.objectContaining({ category: 'not_authorized' }));
    });

    it('an unusable assigned connection fails visibly instead of dropping to a lower level', () => {
        const broken = conn({ status: 'invalid_credentials' });
        const r = () => resolveRoute(input({ connections: [broken, openai], assignment: assignment(), brandPolicy: policy({ brandId: BRAND, defaultConnectionId: openai.id, defaultModel: 'gpt-a' }) }));
        expect(r).toThrow(expect.objectContaining({ category: 'invalid_credentials' }));
    });

    it.each([
        ['saved but never tested', { status: 'configured' as const }, 'not_configured'],
        ['disabled', { enabled: false }, 'not_configured'],
        ['rate limited at last test', { status: 'rate_limited' as const }, 'rate_limited'],
        ['another agency', { agencyId: 'agency-2' }, 'not_authorized'],
        ['another brand', { brandId: 'brand-dmd' }, 'not_authorized'],
    ])('rejects a connection that is %s', (_label, over, category) => {
        expect(() => resolveRoute(input({ connections: [conn(over)], assignment: assignment() }))).toThrow(expect.objectContaining({ category }));
    });

    it('requires the model to be reported by the last test and confirms tool support from the catalog', () => {
        expect(() => resolveRoute(input({ assignment: assignment({ modelId: 'model-z' }) }))).toThrow(expect.objectContaining({ category: 'model_not_found' }));
        expect(resolveRoute(input({ assignment: assignment() })).primary.enabledCapabilities).toEqual(['tools']);
        // gpt-a is catalogued as text-only: tools are not offered even though the adapter could.
        expect(resolveRoute(input({ assignment: assignment({ connectionId: openai.id, modelId: 'gpt-a' }) })).primary.enabledCapabilities).toEqual([]);
        // Uncatalogued model (model-b): only the baseline is assumed.
        expect(resolveRoute(input({ assignment: assignment({ modelId: 'model-b' }) })).primary.enabledCapabilities).toEqual([]);
        expect(() => resolveRoute(input({ assignment: assignment({ modelId: 'model-b' }), required: ['text', 'tools'] }))).toThrow(expect.objectContaining({ category: 'unsupported_capability' }));
    });

    it('simulated connections are usable once configured and are never live', () => {
        const sim = conn({ id: 'sim', provider: 'simulated', credentialReference: null, status: 'configured', verifiedModels: [] });
        const r = resolveRoute(input({ connections: [sim], assignment: assignment({ connectionId: 'sim', modelId: 'sim-deterministic-1' }) }));
        expect(r.primary.connection.provider).toBe('simulated');
        expect(registry.get('simulated').live).toBe(false);
    });
});

describe('fallback policies', () => {
    it('retry_same allows two retries; disabled allows none', () => {
        expect(resolveRoute(input({ assignment: assignment({ fallbackPolicy: 'retry_same' }) })).maxRetries).toBe(2);
        expect(resolveRoute(input({ assignment: assignment() }))).toMatchObject({ maxRetries: 0, fallbacks: [] });
    });

    it('secondary model stays on the same connection', () => {
        const r = resolveRoute(input({ assignment: assignment({ fallbackPolicy: 'secondary_model', fallbackModelId: 'model-b' }) }));
        expect(r.fallbacks.map((f) => [f.connection.id, f.modelId])).toEqual([[anthropic.id, 'model-b']]);
    });

    it('secondary provider requires organization AND brand consent', () => {
        const a = assignment({ fallbackPolicy: 'secondary_provider', fallbackConnectionId: openai.id, fallbackModelId: 'gpt-a' });
        const deny = (orgAllow: boolean, brandAllow: boolean) => () => resolveRoute(input({
            assignment: a, orgPolicy: policy({ allowCrossProviderFallback: orgAllow }), brandPolicy: policy({ brandId: BRAND, allowCrossProviderFallback: brandAllow }),
        }));
        expect(deny(false, false)).toThrow(expect.objectContaining({ category: 'not_authorized' }));
        expect(deny(true, false)).toThrow(expect.objectContaining({ category: 'not_authorized' }));
        expect(deny(false, true)).toThrow(expect.objectContaining({ category: 'not_authorized' }));
        expect(deny(true, true)().fallbacks[0]!.connection.provider).toBe('openai');
    });

    it('falls back on provider-side failures; on credential failures only to a different connection', () => {
        expect(shouldFallback('rate_limited', true)).toBe(true);
        expect(shouldFallback('invalid_credentials', true)).toBe(false);
        expect(shouldFallback('invalid_credentials', false)).toBe(true);
        expect(shouldFallback('budget_exceeded', false)).toBe(false);
        expect(shouldFallback('cancelled', false)).toBe(false);
    });
});

describe('budgets', () => {
    const b = (over: Partial<BudgetInput> = {}): BudgetInput => ({
        live: true, agent: { maxOutputTokens: 1000, maxRunsPerDay: 10, monthlyBudgetUsd: 25 }, connection: conn(), model: model(),
        brandPolicy: policy({ brandId: BRAND, monthlyTokenLimit: null }), orgPolicy: policy({ monthlyTokenLimit: null }), usage: EMPTY_USAGE,
        estimatedInputTokens: 500, requestedOutputTokens: 1000, ...over,
    });
    const priced = model({ inputUsdPerMTok: 3, outputUsdPerMTok: 15, pricingVersion: 'owner-2026-11' });

    it('without verified prices a live call needs a token ceiling (USD budgets cannot be enforced)', () => {
        expect(checkBudget(b())).toMatchObject({ ok: false, reason: expect.stringContaining('no verified price') });
        expect(checkBudget(b({ brandPolicy: policy({ brandId: BRAND, monthlyTokenLimit: 100_000 }) }))).toEqual({ ok: true, maxOutputTokens: 1000, priced: false });
    });

    it('token, request and daily-run ceilings refuse before any call', () => {
        const tokens = policy({ monthlyTokenLimit: 10_000 });
        expect(checkBudget(b({ orgPolicy: tokens, usage: { ...EMPTY_USAGE, orgMonthTokens: 9_000 } }))).toMatchObject({ ok: false, reason: expect.stringContaining('token limit') });
        expect(checkBudget(b({ model: priced, connection: conn({ monthlyRequestLimit: 5 }), usage: { ...EMPTY_USAGE, connectionMonthRequests: 5 } }))).toMatchObject({ ok: false, reason: expect.stringContaining('request limit') });
        expect(checkBudget(b({ usage: { ...EMPTY_USAGE, agentRunsToday: 10 } }))).toMatchObject({ ok: false, reason: expect.stringContaining('Daily run limit') });
    });

    it('with verified prices it enforces monthly USD budgets at every level using the worst case', () => {
        expect(checkBudget(b({ model: priced }))).toEqual({ ok: true, maxOutputTokens: 1000, priced: true });
        expect(checkBudget(b({ model: priced, usage: { ...EMPTY_USAGE, agentMonthCostUsd: 24.99 } }))).toMatchObject({ ok: false, reason: expect.stringContaining('agent budget') });
        expect(checkBudget(b({ model: priced, brandPolicy: policy({ brandId: BRAND, monthlyBudgetUsd: 1 }), usage: { ...EMPTY_USAGE, brandMonthCostUsd: 0.999 } }))).toMatchObject({ ok: false, reason: expect.stringContaining('brand budget') });
        expect(checkBudget(b({ model: priced, orgPolicy: policy({ perUserMonthlyBudgetUsd: 0.5 }), usage: { ...EMPTY_USAGE, userMonthCostUsd: 0.5 } }))).toMatchObject({ ok: false, reason: expect.stringContaining('user budget') });
    });

    it('lowers the output cap to fit a per-request cost limit, or refuses when it cannot', () => {
        // worst case at 1000 out: 500*3 + 1000*15 = 16,500 µ$ = $0.0165; limit $0.009 → fit = (9000 - 1500) / 15 = 500
        expect(checkBudget(b({ model: priced, connection: conn({ maxCostPerRequestUsd: 0.009 }) }))).toEqual({ ok: true, maxOutputTokens: 500, priced: true });
        expect(checkBudget(b({ model: priced, connection: conn({ maxCostPerRequestUsd: 0.0016 }) }))).toMatchObject({ ok: false });
    });

    it('the smallest output cap across agent, connection and model wins', () => {
        expect(checkBudget(b({ model: model({ maxOutputTokens: 300 }), brandPolicy: policy({ brandId: BRAND }) }))).toMatchObject({ ok: true, maxOutputTokens: 300 });
    });

    it('simulated runs only check run limits; cost is never guessed', () => {
        expect(checkBudget(b({ live: false, brandPolicy: null, orgPolicy: null }))).toEqual({ ok: true, maxOutputTokens: 1000, priced: false });
        expect(costUsd(model(), 1000, 1000)).toBeNull();
        expect(costUsd(priced, 1_000_000, 100_000)).toBe(4.5);
    });
});

describe('secret slots (AISecretResolver)', () => {
    const env = (vars: Record<string, string>) => (n: string) => vars[n];
    it('resolves only allow-listed slots that match the provider', () => {
        const e = env({ ANTHROPIC_API_KEY: 'value-a', OPENAI_API_KEY: 'value-o', SUPABASE_SERVICE_ROLE_KEY: 'service' });
        expect(resolveSecret('anthropic', 'ANTHROPIC_API_KEY', e)).toBe('value-a');
        expect(() => resolveSecret('anthropic', 'OPENAI_API_KEY', e)).toThrow(expect.objectContaining({ category: 'not_configured' }));
        expect(() => resolveSecret('openai', 'SUPABASE_SERVICE_ROLE_KEY', e)).toThrow(expect.objectContaining({ category: 'not_configured' }));
        expect(() => resolveSecret('openai', null, e)).toThrow(expect.objectContaining({ category: 'not_configured' }));
        expect(() => resolveSecret('openai', 'OPENAI_API_KEY_EMPTY', e)).toThrow(/is empty/);
        expect(resolveSecret('simulated', null, e)).toBe('');
    });

    it('reports slot status as booleans and never echoes values', () => {
        const status = secretSlotStatus(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'], env({ ANTHROPIC_API_KEY: 'value-a' }));
        expect(status).toEqual([{ slot: 'ANTHROPIC_API_KEY', configured: true }, { slot: 'OPENAI_API_KEY', configured: false }]);
        expect(JSON.stringify(status)).not.toContain('value-a');
    });
});
