/**
 * OpenAI Chat Completions adapter (official REST API,
 * https://platform.openai.com/docs/api-reference/chat). fetch-based for the same reasons as
 * the Anthropic adapter. Streaming with stream_options.include_usage so the final chunk
 * carries provider-reported usage. Tool calls arrive as indexed argument fragments.
 */
import { parseSse, providerFetch, PROVIDER_ORIGINS } from './http.ts';
import { parseToolInput } from './anthropic.ts';
import { AIProviderError, type AIProviderAdapter, type ChatMessage, type GenerateRequest, type ModelInfo, type ProviderCallContext, type StopReason, type StreamEvent } from './types.ts';

const DEFAULT_TIMEOUT = 60_000;

export function toOpenAIMessages(system: string, messages: ChatMessage[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = system ? [{ role: 'system', content: system }] : [];
    for (const m of messages) {
        if (m.role === 'user') out.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') {
            out.push({
                role: 'assistant',
                content: m.content || null,
                ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
            });
        } else out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.isError ? `ERROR: ${m.content}` : m.content });
    }
    return out;
}

export function openaiBody(req: GenerateRequest): Record<string, unknown> {
    return {
        model: req.model,
        messages: toOpenAIMessages(req.system, req.messages),
        max_completion_tokens: req.maxOutputTokens,
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.jsonObject ? { response_format: { type: 'json_object' } } : {}),
        stream: true,
        stream_options: { include_usage: true },
    };
}

const STOP: Record<string, StopReason> = { stop: 'end', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'refusal' };

function headers(ctx: ProviderCallContext): Record<string, string> {
    return {
        authorization: `Bearer ${ctx.apiKey}`,
        'content-type': 'application/json',
        ...(ctx.organization ? { 'OpenAI-Organization': ctx.organization } : {}),
        ...(ctx.project ? { 'OpenAI-Project': ctx.project } : {}),
    };
}

export class OpenAIAdapter implements AIProviderAdapter {
    readonly code = 'openai' as const;
    readonly live = true;
    readonly capabilities = ['text', 'streaming', 'tools', 'structured_output'] as const;

    async *stream(req: GenerateRequest, ctx: ProviderCallContext): AsyncIterable<StreamEvent> {
        const res = await providerFetch('openai', ctx.fetch, `${PROVIDER_ORIGINS.openai}/v1/chat/completions`,
            { method: 'POST', headers: headers(ctx), body: JSON.stringify(openaiBody(req)) },
            { timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT, signal: req.signal, requestIdHeader: 'x-request-id' });
        const requestId = res.headers.get('x-request-id');
        let model = req.model;
        let stop: StopReason = 'other';
        let usage: { inputTokens: number; outputTokens: number } | null = null;
        const tools = new Map<number, { id: string; name: string; args: string }>();

        for await (const msg of parseSse(res.body, req.signal)) {
            if (!msg.data || msg.data === '[DONE]') continue;
            let d: Record<string, any>;
            try { d = JSON.parse(msg.data); } catch { continue; }
            if (d.error) throw new AIProviderError('unavailable', 'OpenAI returned an error during streaming.', true, null, requestId);
            if (d.model) model = d.model;
            if (d.usage) usage = { inputTokens: d.usage.prompt_tokens ?? 0, outputTokens: d.usage.completion_tokens ?? 0 };
            const choice = d.choices?.[0];
            if (!choice) continue;
            if (choice.delta?.content) yield { type: 'text', text: choice.delta.content };
            for (const tc of choice.delta?.tool_calls ?? []) {
                const t = tools.get(tc.index) ?? { id: '', name: '', args: '' };
                if (tc.id) t.id = tc.id;
                if (tc.function?.name) t.name += tc.function.name;
                if (tc.function?.arguments) t.args += tc.function.arguments;
                tools.set(tc.index, t);
            }
            if (choice.finish_reason) stop = STOP[choice.finish_reason] ?? 'other';
        }
        if (req.signal?.aborted) throw new AIProviderError('cancelled', 'Generation was stopped.');
        for (const [, t] of [...tools.entries()].sort((a, b) => a[0] - b[0])) {
            yield { type: 'tool_call', call: { id: t.id, name: t.name, input: parseToolInput(t.args) } };
        }
        if (usage) yield { type: 'usage', usage };
        yield { type: 'done', stopReason: stop, providerRequestId: requestId, model };
    }

    async listModels(ctx: ProviderCallContext): Promise<ModelInfo[]> {
        const res = await providerFetch('openai', ctx.fetch, `${PROVIDER_ORIGINS.openai}/v1/models`,
            { method: 'GET', headers: headers(ctx) }, { timeoutMs: ctx.timeoutMs ?? 15_000, requestIdHeader: 'x-request-id' });
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        return (body.data ?? []).map((m) => ({ id: m.id, displayName: m.id }));
    }
}
