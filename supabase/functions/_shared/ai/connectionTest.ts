/**
 * AIConnectionService.test: verifies a connection through the server with the lowest-cost
 * documented check, the provider's model-listing endpoint (no tokens are generated).
 * Returns only status metadata. The credential never leaves this function.
 */
import { statusForCategory } from './errors.ts';
import { resolveSecret, type AIProviderRegistry, type EnvReader } from './registry.ts';
import type { ConnectionConfig } from './routing.ts';
import { AIProviderError, type AIErrorCategory, type ConnectionStatus, type ModelInfo, type ProviderCode } from './types.ts';

export interface ConnectionTestResult {
    connectionId: string;
    provider: ProviderCode;
    ok: boolean;
    status: ConnectionStatus;
    errorCategory: AIErrorCategory | null;
    message: string;
    models: ModelInfo[];
    latencyMs: number;
    testedAt: string;
}

export async function testConnection(
    deps: { registry: AIProviderRegistry; env: EnvReader; fetch: typeof fetch; now?: () => number },
    c: ConnectionConfig,
): Promise<ConnectionTestResult> {
    const now = deps.now ?? (() => Date.now());
    const t0 = now();
    const done = (ok: boolean, category: AIErrorCategory | null, message: string, models: ModelInfo[] = []): ConnectionTestResult => ({
        connectionId: c.id, provider: c.provider, ok, status: ok ? 'connected' : statusForCategory(category), errorCategory: category,
        message, models: models.slice(0, 500), latencyMs: Math.max(0, now() - t0), testedAt: new Date(now()).toISOString(),
    });
    if (!c.enabled) return done(false, 'not_configured', 'The connection is disabled.');
    try {
        const apiKey = resolveSecret(c.provider, c.credentialReference, deps.env);
        const models = await deps.registry.get(c.provider).listModels({ apiKey, organization: c.organization, project: c.project, fetch: deps.fetch, timeoutMs: 15_000 });
        return done(true, null, `Connected. The provider reported ${models.length} model(s).`, models);
    } catch (e) {
        const pe = e instanceof AIProviderError ? e : new AIProviderError('unknown', 'The connection test failed.');
        return done(false, pe.category, pe.message);
    }
}
