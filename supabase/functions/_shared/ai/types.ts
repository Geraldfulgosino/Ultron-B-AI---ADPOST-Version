/**
 * Provider-independent AI runtime types (master prompt v5.0, section 7).
 * Pure TypeScript: runs unchanged in Supabase Edge Functions (Deno) and in Vitest.
 * Nothing above the adapter boundary sees an Anthropic- or OpenAI-specific object.
 */

export type ProviderCode = 'anthropic' | 'openai' | 'simulated';

export type ConnectionStatus =
    | 'not_configured' | 'configured' | 'testing' | 'connected' | 'invalid_credentials' | 'permission_denied'
    | 'insufficient_credits' | 'rate_limited' | 'unavailable' | 'disabled';

export type AIErrorCategory =
    | 'not_configured'
    | 'invalid_credentials'
    | 'permission_denied'
    | 'insufficient_credits'
    | 'rate_limited'
    | 'unavailable'
    | 'timeout'
    | 'cancelled'
    | 'invalid_request'
    | 'context_length'
    | 'model_not_found'
    | 'budget_exceeded'
    | 'not_authorized'
    | 'unsupported_capability'
    | 'unknown';

export type Capability = 'text' | 'streaming' | 'tools' | 'structured_output' | 'vision' | 'reasoning';

export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export type ChatMessage =
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
    | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolSpec {
    name: string;
    description: string;
    /** JSON Schema (object). */
    inputSchema: Record<string, unknown>;
}

export interface GenerateRequest {
    model: string;
    system: string;
    messages: ChatMessage[];
    maxOutputTokens: number;
    tools?: ToolSpec[];
    temperature?: number;
    /** Ask for a JSON object answer (structured output) where the provider supports it. */
    jsonObject?: boolean;
    signal?: AbortSignal;
}

export interface Usage {
    inputTokens: number;
    outputTokens: number;
}

export type StopReason = 'end' | 'max_tokens' | 'tool_use' | 'refusal' | 'cancelled' | 'other';

export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'tool_call'; call: ToolCall }
    | { type: 'usage'; usage: Usage }
    | { type: 'done'; stopReason: StopReason; providerRequestId: string | null; model: string };

export interface GenerateResult {
    text: string;
    toolCalls: ToolCall[];
    /** Provider-reported usage; null when the provider reported none (never guessed). */
    usage: Usage | null;
    stopReason: StopReason;
    providerRequestId: string | null;
    /** Model id the provider says served the request. */
    model: string;
}

/** Everything an adapter needs to make an authenticated call. The secret never leaves the server. */
export interface ProviderCallContext {
    apiKey: string;
    organization?: string | null;
    project?: string | null;
    fetch: typeof fetch;
    timeoutMs?: number;
}

export interface ModelInfo {
    id: string;
    displayName: string;
}

export interface AIProviderAdapter {
    readonly code: ProviderCode;
    readonly live: boolean;
    /** Capabilities the adapter implements (the model must also support them). */
    readonly capabilities: readonly Capability[];
    stream(req: GenerateRequest, ctx: ProviderCallContext): AsyncIterable<StreamEvent>;
    /** Lowest-cost credential check: the provider's free model-listing endpoint. */
    listModels(ctx: ProviderCallContext): Promise<ModelInfo[]>;
}

export class AIProviderError extends Error {
    constructor(
        readonly category: AIErrorCategory,
        message: string,
        readonly retryable = false,
        readonly httpStatus: number | null = null,
        readonly providerRequestId: string | null = null,
    ) {
        super(message);
        this.name = 'AIProviderError';
    }
}

/** Collect a stream into a single result (used by non-streaming callers and tests). */
export async function collect(events: AsyncIterable<StreamEvent>, onEvent?: (e: StreamEvent) => void): Promise<GenerateResult> {
    let text = '';
    const toolCalls: ToolCall[] = [];
    let usage = null as Usage | null;
    let stopReason: StopReason = 'other';
    let providerRequestId: string | null = null;
    let model = '';
    for await (const e of events) {
        onEvent?.(e);
        if (e.type === 'text') text += e.text;
        else if (e.type === 'tool_call') toolCalls.push(e.call);
        else if (e.type === 'usage') usage = { inputTokens: (usage?.inputTokens ?? 0) + e.usage.inputTokens, outputTokens: (usage?.outputTokens ?? 0) + e.usage.outputTokens };
        else { stopReason = e.stopReason; providerRequestId = e.providerRequestId; model = e.model; }
    }
    return { text, toolCalls, usage, stopReason, providerRequestId, model };
}
