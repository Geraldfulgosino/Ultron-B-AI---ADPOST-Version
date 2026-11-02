/** Deterministic fakes for the shared AI runtime. No network, no real provider, no real key. */
import { AIProviderError, type AIProviderAdapter, type Capability, type GenerateRequest, type ModelInfo, type ProviderCallContext, type ProviderCode, type StreamEvent, type ToolCall } from '../../../../../supabase/functions/_shared/ai/types.ts';
import type { ExecutionBegin, ExecutionStore, TurnOutcome, TurnRequest } from '../../../../../supabase/functions/_shared/ai/execution.ts';
import type { ConnectionConfig, ModelCatalogEntry, RoutingPolicy } from '../../../../../supabase/functions/_shared/ai/routing.ts';

export const FAKE_KEY = 'test-key-not-a-real-credential';

/** A Response whose body streams the given SSE text in small, awkwardly split chunks. */
export function sseResponse(blocks: string[], headers: Record<string, string> = {}, chunk = 7): Response {
    const text = blocks.map((b) => b + '\n\n').join('');
    const bytes = new TextEncoder().encode(text);
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(ctl) {
            if (i >= bytes.length) return ctl.close();
            ctl.enqueue(bytes.slice(i, i + chunk));
            i += chunk;
        },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export interface Recorded {
    url: string;
    init: RequestInit;
}

export function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; calls: Recorded[] } {
    const calls: Recorded[] = [];
    const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url, init });
        return handler(url, init);
    }) as typeof fetch;
    return { fetch: f, calls };
}

export type Step = { text?: string; toolCalls?: ToolCall[]; usage?: { inputTokens: number; outputTokens: number } | null; error?: AIProviderError; model?: string };

/** Adapter that plays a script, one step per stream() call, and records each request. */
export class ScriptedAdapter implements AIProviderAdapter {
    readonly requests: GenerateRequest[] = [];
    readonly keys: string[] = [];
    constructor(readonly code: ProviderCode, private readonly steps: Step[], readonly capabilities: readonly Capability[] = ['text', 'streaming', 'tools'], readonly live = true) {}

    async *stream(req: GenerateRequest, ctx: ProviderCallContext): AsyncIterable<StreamEvent> {
        this.requests.push(structuredClone({ ...req, signal: undefined }));
        this.keys.push(ctx.apiKey);
        const step = this.steps.shift() ?? { text: 'ok' };
        if (step.error) throw step.error;
        for (const part of (step.text ?? '').match(/.{1,5}/gs) ?? []) {
            if (req.signal?.aborted) throw new AIProviderError('cancelled', 'Generation was stopped.');
            yield { type: 'text', text: part };
        }
        for (const call of step.toolCalls ?? []) yield { type: 'tool_call', call };
        if (step.usage !== null) yield { type: 'usage', usage: step.usage ?? { inputTokens: 100, outputTokens: 20 } };
        yield { type: 'done', stopReason: step.toolCalls?.length ? 'tool_use' : 'end', providerRequestId: `req_${this.requests.length}`, model: step.model ?? req.model };
    }

    async listModels(): Promise<ModelInfo[]> {
        return [{ id: 'model-a', displayName: 'Model A' }];
    }
}

export class MemoryStore implements ExecutionStore {
    readonly begun: ExecutionBegin[] = [];
    readonly finished: Array<{ id: string; outcome: TurnOutcome }> = [];
    private n = 0;
    private readonly byKey = new Map<string, TurnOutcome>();

    async findByIdempotencyKey(brandId: string, key: string) {
        return this.byKey.get(`${brandId}:${key}`) ?? null;
    }
    async begin(rec: ExecutionBegin) {
        this.begun.push(rec);
        return `exe_${++this.n}`;
    }
    async finish(id: string, outcome: TurnOutcome, req: TurnRequest) {
        this.finished.push({ id, outcome: structuredClone(outcome) });
        this.byKey.set(`${req.brandId}:${req.idempotencyKey}`, structuredClone(outcome));
    }
}

export const AGENCY = 'agency-1';
export const BRAND = 'brand-pod';

export function conn(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
    return {
        id: 'conn-anthropic', agencyId: AGENCY, brandId: null, provider: 'anthropic', displayName: 'Company Anthropic API',
        credentialReference: 'ANTHROPIC_API_KEY', organization: null, project: null, enabled: true, status: 'connected',
        verifiedModels: ['model-a', 'model-b'], maxOutputTokens: 4000, monthlyBudgetUsd: null, maxCostPerRequestUsd: null, monthlyRequestLimit: null,
        ...over,
    };
}

export function model(over: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
    return { provider: 'anthropic', modelId: 'model-a', capabilities: ['text', 'streaming', 'tools'], maxOutputTokens: null, inputUsdPerMTok: null, outputUsdPerMTok: null, pricingVersion: null, ...over };
}

export function policy(over: Partial<RoutingPolicy> = {}): RoutingPolicy {
    return {
        agencyId: AGENCY, brandId: null, defaultConnectionId: null, defaultModel: null, allowCrossProviderFallback: false, monthlyBudgetUsd: null,
        perUserMonthlyBudgetUsd: null, maxCostPerRequestUsd: null, monthlyRequestLimit: null, monthlyTokenLimit: 1_000_000, ...over,
    };
}
