/**
 * AIModelRoutingService: decides which connection and model serve an agent turn.
 *
 * Priority: authorized conversation override → agent assignment → brand default →
 * organization default → approved platform fallback. The FIRST configured level is used;
 * if it is unusable the turn fails visibly. A lower level is never used silently, because
 * that could send company data to a provider nobody chose for this agent. Fallbacks come
 * only from the assignment's explicit fallback policy.
 */
import { AIProviderError, type AIErrorCategory, type Capability, type ConnectionStatus, type ProviderCode } from './types.ts';

export interface ConnectionConfig {
    id: string;
    agencyId: string;
    brandId: string | null;
    provider: ProviderCode;
    displayName: string;
    credentialReference: string | null;
    organization: string | null;
    project: string | null;
    enabled: boolean;
    status: ConnectionStatus;
    /** Provider-reported model ids from the last successful test ([] = not yet tested). */
    verifiedModels: string[];
    maxOutputTokens: number;
    monthlyBudgetUsd: number | null;
    maxCostPerRequestUsd: number | null;
    monthlyRequestLimit: number | null;
}

export interface ModelCatalogEntry {
    provider: ProviderCode;
    modelId: string;
    capabilities: Capability[];
    maxOutputTokens: number | null;
    /** USD per million tokens; both null unless an admin entered verified prices. */
    inputUsdPerMTok: number | null;
    outputUsdPerMTok: number | null;
    pricingVersion: string | null;
}

export type FallbackPolicy = 'disabled' | 'retry_same' | 'secondary_model' | 'secondary_provider';

export interface AssignmentConfig {
    agentInstanceId: string;
    connectionId: string;
    modelId: string;
    generationConfig: { temperature?: number };
    fallbackPolicy: FallbackPolicy;
    fallbackConnectionId: string | null;
    fallbackModelId: string | null;
    enabled: boolean;
}

export interface RoutingPolicy {
    agencyId: string;
    brandId: string | null;
    defaultConnectionId: string | null;
    defaultModel: string | null;
    allowCrossProviderFallback: boolean;
    monthlyBudgetUsd: number | null;
    perUserMonthlyBudgetUsd: number | null;
    maxCostPerRequestUsd: number | null;
    monthlyRequestLimit: number | null;
    monthlyTokenLimit: number | null;
}

export type RouteSource = 'conversation_override' | 'agent_assignment' | 'brand_default' | 'organization_default' | 'platform_fallback';

export interface RouteTarget {
    connection: ConnectionConfig;
    modelId: string;
    model: ModelCatalogEntry | null;
    /** Optional capabilities the target supports (e.g. tools) and may be used this turn. */
    enabledCapabilities: Capability[];
}

export interface Route {
    source: RouteSource;
    primary: RouteTarget;
    fallbacks: RouteTarget[];
    maxRetries: number;
    temperature: number | undefined;
}

export interface RouteInput {
    agencyId: string;
    brandId: string;
    override?: { connectionId: string; modelId: string; authorized: boolean } | null;
    assignment?: AssignmentConfig | null;
    brandPolicy?: RoutingPolicy | null;
    orgPolicy?: RoutingPolicy | null;
    platformFallback?: { connectionId: string; modelId: string } | null;
    connections: ConnectionConfig[];
    models: ModelCatalogEntry[];
    adapterCapabilities: (p: ProviderCode) => readonly Capability[];
    required: Capability[];
    optional?: Capability[];
}

const fail = (category: AIErrorCategory, msg: string) => new AIProviderError(category, msg);

/** Throws a visible error when the target cannot serve this brand with these capabilities. */
export function validateTarget(input: RouteInput, connectionId: string, modelId: string): RouteTarget {
    const c = input.connections.find((x) => x.id === connectionId);
    if (!c) throw fail('not_configured', 'The selected AI connection does not exist or is not visible to this brand.');
    if (c.agencyId !== input.agencyId || (c.brandId !== null && c.brandId !== input.brandId)) {
        throw fail('not_authorized', `Connection "${c.displayName}" is not available to this brand.`);
    }
    if (!c.enabled || c.status === 'disabled') throw fail('not_configured', `Connection "${c.displayName}" is disabled.`);
    const healthy = c.provider === 'simulated' ? c.status === 'configured' || c.status === 'connected' : c.status === 'connected';
    if (!healthy) {
        throw fail(c.status === 'not_configured' || c.status === 'configured' ? 'not_configured' : (c.status as AIErrorCategory),
            `Connection "${c.displayName}" is not verified (status: ${c.status.replace(/_/g, ' ')}). Run a connection test first.`);
    }
    if (c.provider !== 'simulated' && c.verifiedModels.length && !c.verifiedModels.includes(modelId)) {
        throw fail('model_not_found', `Model "${modelId}" was not reported by ${c.displayName} in its last test.`);
    }
    const model = input.models.find((m) => m.provider === c.provider && m.modelId === modelId) ?? null;
    const adapterCaps = input.adapterCapabilities(c.provider);
    // Without a catalog entry only the adapter's baseline (text, streaming) is assumed; tools must be confirmed in the catalog.
    const modelCaps: readonly Capability[] = model ? model.capabilities : adapterCaps.filter((x) => x === 'text' || x === 'streaming');
    const supports = (cap: Capability) => adapterCaps.includes(cap) && (cap === 'text' || modelCaps.includes(cap));
    const missing = input.required.filter((cap) => !supports(cap));
    if (missing.length) throw fail('unsupported_capability', `Model "${modelId}" is not confirmed to support: ${missing.join(', ')}.`);
    return { connection: c, modelId, model, enabledCapabilities: (input.optional ?? []).filter(supports) };
}

export function resolveRoute(input: RouteInput): Route {
    const a = input.assignment?.enabled ? input.assignment : null;
    let source: RouteSource;
    let primary: RouteTarget;
    if (input.override) {
        if (!input.override.authorized) throw fail('not_authorized', 'Only brand administrators may override the model for a conversation.');
        source = 'conversation_override';
        primary = validateTarget(input, input.override.connectionId, input.override.modelId);
    } else if (a) {
        source = 'agent_assignment';
        primary = validateTarget(input, a.connectionId, a.modelId);
    } else if (input.brandPolicy?.defaultConnectionId && input.brandPolicy.defaultModel) {
        source = 'brand_default';
        primary = validateTarget(input, input.brandPolicy.defaultConnectionId, input.brandPolicy.defaultModel);
    } else if (input.orgPolicy?.defaultConnectionId && input.orgPolicy.defaultModel) {
        source = 'organization_default';
        primary = validateTarget(input, input.orgPolicy.defaultConnectionId, input.orgPolicy.defaultModel);
    } else if (input.platformFallback) {
        source = 'platform_fallback';
        primary = validateTarget(input, input.platformFallback.connectionId, input.platformFallback.modelId);
    } else {
        throw fail('not_configured', 'No AI model is assigned to this agent, and no brand or organization default is set.');
    }

    const fallbacks: RouteTarget[] = [];
    let maxRetries = 0;
    if (a && source === 'agent_assignment') {
        if (a.fallbackPolicy === 'retry_same') maxRetries = 2;
        if (a.fallbackPolicy === 'secondary_model' && a.fallbackModelId) {
            fallbacks.push(validateTarget(input, a.connectionId, a.fallbackModelId));
        }
        if (a.fallbackPolicy === 'secondary_provider' && a.fallbackConnectionId && a.fallbackModelId) {
            const target = validateTarget(input, a.fallbackConnectionId, a.fallbackModelId);
            if (target.connection.provider !== primary.connection.provider) {
                const consent = !!input.orgPolicy?.allowCrossProviderFallback && !!input.brandPolicy?.allowCrossProviderFallback;
                if (!consent) throw fail('not_authorized', 'Cross-provider fallback is configured but not authorized by both the organization and the brand.');
            }
            fallbacks.push(target);
        }
    }
    return { source, primary, fallbacks, maxRetries, temperature: a?.generationConfig.temperature };
}

/** Errors after which trying a fallback target is reasonable. */
export function shouldFallback(category: AIErrorCategory, sameConnection: boolean): boolean {
    const providerSide: AIErrorCategory[] = ['rate_limited', 'unavailable', 'timeout', 'model_not_found', 'context_length'];
    const credentialSide: AIErrorCategory[] = ['invalid_credentials', 'permission_denied', 'insufficient_credits'];
    return providerSide.includes(category) || (!sameConnection && credentialSide.includes(category));
}
