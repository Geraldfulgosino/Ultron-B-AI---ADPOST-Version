/**
 * AIProviderRegistry and AISecretResolver.
 *  - Adapters are looked up by provider code; unknown or disabled providers fail closed.
 *  - Secrets are resolved from server environment slots named on the connection. The slot
 *    must match the allow-list pattern AND the connection's provider, so a connection cannot
 *    read SUPABASE_SERVICE_ROLE_KEY or another provider's key. Values are never logged.
 */
import { AnthropicAdapter } from './anthropic.ts';
import { OpenAIAdapter } from './openai.ts';
import { AIProviderError, type AIProviderAdapter, type GenerateRequest, type ModelInfo, type ProviderCode, type StreamEvent } from './types.ts';

/** Offline, deterministic adapter. Always labelled simulated; never stands in for a failed live call. */
export class SimulatedAdapter implements AIProviderAdapter {
    readonly code = 'simulated' as const;
    readonly live = false;
    readonly capabilities = ['text', 'streaming'] as const;

    async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
        const last = [...req.messages].reverse().find((m) => m.role === 'user');
        const text = `[Simulated response: no AI model was called] I received: "${(last?.content ?? '').slice(0, 200)}"`;
        for (const part of text.match(/.{1,40}/gs) ?? []) {
            if (req.signal?.aborted) throw new AIProviderError('cancelled', 'Generation was stopped.');
            yield { type: 'text', text: part };
        }
        yield { type: 'done', stopReason: 'end', providerRequestId: null, model: req.model };
    }

    async listModels(): Promise<ModelInfo[]> {
        return [{ id: 'sim-deterministic-1', displayName: 'Simulated (offline)' }];
    }
}

export class AIProviderRegistry {
    private readonly adapters = new Map<ProviderCode, AIProviderAdapter>();
    constructor(adapters: AIProviderAdapter[] = [new AnthropicAdapter(), new OpenAIAdapter(), new SimulatedAdapter()]) {
        for (const a of adapters) this.adapters.set(a.code, a);
    }
    get(code: string): AIProviderAdapter {
        const a = this.adapters.get(code as ProviderCode);
        if (!a) throw new AIProviderError('not_configured', `Provider "${code}" is not supported.`);
        return a;
    }
    codes(): ProviderCode[] {
        return [...this.adapters.keys()];
    }
}

export const SECRET_SLOT_PATTERN = /^(ANTHROPIC|OPENAI)_API_KEY(_[A-Z0-9]{1,32})?$/;

export function slotMatchesProvider(slot: string, provider: ProviderCode): boolean {
    if (!SECRET_SLOT_PATTERN.test(slot)) return false;
    return (provider === 'anthropic' && slot.startsWith('ANTHROPIC_')) || (provider === 'openai' && slot.startsWith('OPENAI_'));
}

export type EnvReader = (name: string) => string | undefined;

/** Returns the credential for a connection, or throws not_configured. Never returns it to callers outside the server. */
export function resolveSecret(provider: ProviderCode, slot: string | null, env: EnvReader): string {
    if (provider === 'simulated') return '';
    if (!slot || !slotMatchesProvider(slot, provider)) {
        throw new AIProviderError('not_configured', 'This connection does not reference an allowed server-side secret slot.');
    }
    const value = env(slot)?.trim();
    if (!value) throw new AIProviderError('not_configured', `The server-side secret slot ${slot} is empty. An administrator must set it with "supabase secrets set".`);
    return value;
}

/** Report which allowed slots are populated (names and booleans only). */
export function secretSlotStatus(slots: string[], env: EnvReader): Array<{ slot: string; configured: boolean }> {
    return slots.filter((s) => SECRET_SLOT_PATTERN.test(s)).map((slot) => ({ slot, configured: !!env(slot)?.trim() }));
}
