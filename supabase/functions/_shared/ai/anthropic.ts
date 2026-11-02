/**
 * Anthropic Messages API adapter (official REST API, https://docs.anthropic.com/en/api/messages).
 * Uses fetch directly instead of the SDK so the identical module runs on Deno and in Vitest
 * and can only reach the allow-listed origin. Streaming via SSE; tool use via tool_use /
 * tool_result content blocks. Usage numbers are the provider-reported ones.
 */
import { parseSse, providerFetch, PROVIDER_ORIGINS } from './http.ts';
import { AIProviderError, type AIProviderAdapter, type ChatMessage, type GenerateRequest, type ModelInfo, type ProviderCallContext, type StopReason, type StreamEvent, type ToolCall } from './types.ts';
import { httpError } from './errors.ts';

export const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT = 60_000;

type Block =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/** Normalized history → Anthropic messages (tool results grouped into one user turn). */
export function toAnthropicMessages(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string | Block[] }> {
    const out: Array<{ role: 'user' | 'assistant'; content: string | Block[] }> = [];
    for (const m of messages) {
        if (m.role === 'user') out.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') {
            const blocks: Block[] = [];
            if (m.content) blocks.push({ type: 'text', text: m.content });
            for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
            out.push({ role: 'assistant', content: blocks.length === 1 && blocks[0]!.type === 'text' ? m.content : blocks });
        } else {
            const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) };
            const prev = out[out.length - 1];
            if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content.every((b) => b.type === 'tool_result')) prev.content.push(block);
            else out.push({ role: 'user', content: [block] });
        }
    }
    return out;
}

export function anthropicBody(req: GenerateRequest): Record<string, unknown> {
    const system = req.jsonObject ? `${req.system}\n\nRespond with a single JSON object and nothing else.` : req.system;
    return {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(req.messages),
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        stream: true,
    };
}

const STOP: Record<string, StopReason> = { end_turn: 'end', stop_sequence: 'end', max_tokens: 'max_tokens', tool_use: 'tool_use', refusal: 'refusal' };

function headers(ctx: ProviderCallContext): Record<string, string> {
    return { 'x-api-key': ctx.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' };
}

export class AnthropicAdapter implements AIProviderAdapter {
    readonly code = 'anthropic' as const;
    readonly live = true;
    readonly capabilities = ['text', 'streaming', 'tools'] as const;

    async *stream(req: GenerateRequest, ctx: ProviderCallContext): AsyncIterable<StreamEvent> {
        const res = await providerFetch('anthropic', ctx.fetch, `${PROVIDER_ORIGINS.anthropic}/v1/messages`,
            { method: 'POST', headers: headers(ctx), body: JSON.stringify(anthropicBody(req)) },
            { timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT, signal: req.signal, requestIdHeader: 'request-id' });
        const requestId = res.headers.get('request-id');
        let model = req.model;
        let input = 0;
        let output = 0;
        let stop: StopReason = 'other';
        const tools = new Map<number, { id: string; name: string; json: string }>();

        for await (const msg of parseSse(res.body, req.signal)) {
            if (!msg.data) continue;
            let d: Record<string, any>;
            try { d = JSON.parse(msg.data); } catch { continue; }
            switch (d.type) {
                case 'message_start': {
                    model = d.message?.model ?? model;
                    const u = d.message?.usage ?? {};
                    input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
                    output = u.output_tokens ?? 0;
                    break;
                }
                case 'content_block_start':
                    if (d.content_block?.type === 'tool_use') tools.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: '' });
                    break;
                case 'content_block_delta':
                    if (d.delta?.type === 'text_delta' && d.delta.text) yield { type: 'text', text: d.delta.text };
                    else if (d.delta?.type === 'input_json_delta') {
                        const t = tools.get(d.index);
                        if (t) t.json += d.delta.partial_json ?? '';
                    }
                    break;
                case 'content_block_stop': {
                    const t = tools.get(d.index);
                    if (t) {
                        yield { type: 'tool_call', call: { id: t.id, name: t.name, input: parseToolInput(t.json) } satisfies ToolCall };
                        tools.delete(d.index);
                    }
                    break;
                }
                case 'message_delta':
                    if (d.delta?.stop_reason) stop = STOP[d.delta.stop_reason] ?? 'other';
                    if (typeof d.usage?.output_tokens === 'number') output = Math.max(output, d.usage.output_tokens);
                    if (typeof d.usage?.input_tokens === 'number') input = Math.max(input, d.usage.input_tokens);
                    break;
                case 'error':
                    throw httpError('anthropic', d.error?.type === 'overloaded_error' ? 529 : 500, d, requestId);
            }
        }
        if (req.signal?.aborted) throw new AIProviderError('cancelled', 'Generation was stopped.');
        yield { type: 'usage', usage: { inputTokens: input, outputTokens: output } };
        yield { type: 'done', stopReason: stop, providerRequestId: requestId, model };
    }

    async listModels(ctx: ProviderCallContext): Promise<ModelInfo[]> {
        const res = await providerFetch('anthropic', ctx.fetch, `${PROVIDER_ORIGINS.anthropic}/v1/models?limit=1000`,
            { method: 'GET', headers: headers(ctx) }, { timeoutMs: ctx.timeoutMs ?? 15_000, requestIdHeader: 'request-id' });
        const body = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
        return (body.data ?? []).map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
}

export function parseToolInput(json: string): Record<string, unknown> {
    if (!json.trim()) return {};
    try {
        const v = JSON.parse(json);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v };
    } catch {
        return { _invalid_json: true };
    }
}
