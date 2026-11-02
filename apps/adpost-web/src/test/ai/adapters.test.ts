// @vitest-environment node
/** Anthropic and OpenAI adapters against recorded-shape fake responses. No real API is called. */
import { AnthropicAdapter, ANTHROPIC_VERSION, anthropicBody, toAnthropicMessages } from '../../../../../supabase/functions/_shared/ai/anthropic.ts';
import { OpenAIAdapter, openaiBody } from '../../../../../supabase/functions/_shared/ai/openai.ts';
import { sanitize } from '../../../../../supabase/functions/_shared/ai/errors.ts';
import { assertAllowedUrl, parseSse } from '../../../../../supabase/functions/_shared/ai/http.ts';
import { AIProviderError, collect, type ChatMessage, type GenerateRequest } from '../../../../../supabase/functions/_shared/ai/types.ts';
import { FAKE_KEY, fakeFetch, jsonResponse, sseResponse } from './fakes';

const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}`;
const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({ model: 'model-a', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 256, ...over });

const anthropicStream = [
    ev('message_start', { type: 'message_start', message: { id: 'msg_1', model: 'model-a-2026', usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 1 } } }),
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev('ping', { type: 'ping' }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } }),
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }),
    ev('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'seo_page_audit', input: {} } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"url": "https://pod' } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '.example/"}' } }),
    ev('content_block_stop', { type: 'content_block_stop', index: 1 }),
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } }),
    ev('message_stop', { type: 'message_stop' }),
];

describe('Anthropic adapter', () => {
    it('streams text and tool calls and reports provider usage and model', async () => {
        const { fetch, calls } = fakeFetch(() => sseResponse(anthropicStream, { 'request-id': 'req_abc' }));
        const seen: string[] = [];
        const r = await collect(new AnthropicAdapter().stream(req(), { apiKey: FAKE_KEY, fetch }), (e) => e.type === 'text' && seen.push(e.text));
        expect(seen).toEqual(['Hello ', 'world']);
        expect(r.text).toBe('Hello world');
        expect(r.toolCalls).toEqual([{ id: 'toolu_1', name: 'seo_page_audit', input: { url: 'https://pod.example/' } }]);
        expect(r.usage).toEqual({ inputTokens: 15, outputTokens: 42 });
        expect(r.stopReason).toBe('tool_use');
        expect(r.providerRequestId).toBe('req_abc');
        expect(r.model).toBe('model-a-2026');

        const [call] = calls;
        expect(call!.url).toBe('https://api.anthropic.com/v1/messages');
        const h = call!.init.headers as Record<string, string>;
        expect(h['x-api-key']).toBe(FAKE_KEY);
        expect(h['anthropic-version']).toBe(ANTHROPIC_VERSION);
        expect(call!.init.redirect).toBe('error');
        const body = JSON.parse(call!.init.body as string);
        expect(body).toMatchObject({ model: 'model-a', max_tokens: 256, system: 'sys', stream: true });
    });

    it('maps tool history to tool_use / tool_result blocks and tools to input_schema', () => {
        const history: ChatMessage[] = [
            { role: 'user', content: 'audit it' },
            { role: 'assistant', content: 'Checking.', toolCalls: [{ id: 't1', name: 'a', input: { x: 1 } }, { id: 't2', name: 'b', input: {} }] },
            { role: 'tool', toolCallId: 't1', name: 'a', content: 'r1' },
            { role: 'tool', toolCallId: 't2', name: 'b', content: 'r2', isError: true },
        ];
        const m = toAnthropicMessages(history);
        expect(m).toHaveLength(3);
        expect(m[1]!.content).toEqual([{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'a', input: { x: 1 } }, { type: 'tool_use', id: 't2', name: 'b', input: {} }]);
        expect(m[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }, { type: 'tool_result', tool_use_id: 't2', content: 'r2', is_error: true }] });
        const body = anthropicBody(req({ tools: [{ name: 'a', description: 'd', inputSchema: { type: 'object' } }] }));
        expect(body.tools).toEqual([{ name: 'a', description: 'd', input_schema: { type: 'object' } }]);
    });

    it.each([
        [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid_credentials', false],
        [403, { type: 'error', error: { type: 'permission_error', message: 'no' } }, 'permission_denied', false],
        [404, { type: 'error', error: { type: 'not_found_error', message: 'model' } }, 'model_not_found', false],
        [429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'rate_limited', true],
        [529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 'unavailable', true],
        [400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' } }, 'insufficient_credits', false],
        [400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 300000 tokens' } }, 'context_length', false],
    ])('HTTP %i → %s', async (status, body, category, retryable) => {
        const { fetch } = fakeFetch(() => jsonResponse(status, body, { 'request-id': 'req_err' }));
        const e = await collect(new AnthropicAdapter().stream(req(), { apiKey: FAKE_KEY, fetch })).catch((x) => x);
        expect(e).toBeInstanceOf(AIProviderError);
        expect(e).toMatchObject({ category, retryable, httpStatus: status, providerRequestId: 'req_err' });
        expect(e.message).not.toContain(FAKE_KEY);
    });

    it('maps a mid-stream error event and lists models through the free endpoint', async () => {
        const { fetch } = fakeFetch(() => sseResponse([ev('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })]));
        await expect(collect(new AnthropicAdapter().stream(req(), { apiKey: FAKE_KEY, fetch }))).rejects.toMatchObject({ category: 'unavailable', retryable: true });
        const list = fakeFetch(() => jsonResponse(200, { data: [{ id: 'model-a', display_name: 'Model A', type: 'model' }], has_more: false }));
        expect(await new AnthropicAdapter().listModels({ apiKey: FAKE_KEY, fetch: list.fetch })).toEqual([{ id: 'model-a', displayName: 'Model A' }]);
        expect(list.calls[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
        expect(list.calls[0]!.init.method).toBe('GET');
    });

    it('stop generation aborts the stream as cancelled', async () => {
        const ctl = new AbortController();
        const { fetch } = fakeFetch(() => sseResponse(anthropicStream, {}, 3));
        const run = collect(new AnthropicAdapter().stream(req({ signal: ctl.signal }), { apiKey: FAKE_KEY, fetch }), (e) => e.type === 'text' && ctl.abort());
        await expect(run).rejects.toMatchObject({ category: 'cancelled' });
    });

    it('a network failure and a timeout are normalized', async () => {
        const down = fakeFetch(() => { throw new TypeError('fetch failed'); });
        await expect(collect(new AnthropicAdapter().stream(req(), { apiKey: FAKE_KEY, fetch: down.fetch }))).rejects.toMatchObject({ category: 'unavailable', retryable: true });
        const slow = fakeFetch((_u, init) => new Promise<Response>((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
        await expect(collect(new AnthropicAdapter().stream(req(), { apiKey: FAKE_KEY, fetch: slow.fetch, timeoutMs: 20 }))).rejects.toMatchObject({ category: 'timeout' });
    });
});

const oa = (d: unknown) => `data: ${JSON.stringify(d)}`;
const openaiStream = [
    oa({ id: 'c1', model: 'gpt-x-2026', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }),
    oa({ id: 'c1', model: 'gpt-x-2026', choices: [{ index: 0, delta: { content: 'Hi ' } }] }),
    oa({ id: 'c1', choices: [{ index: 0, delta: { content: 'there' } }] }),
    oa({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'seo_', arguments: '' } }] } }] }),
    oa({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'robots_txt', arguments: '{"url":' } }] } }] }),
    oa({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"https://pod.example"}' } }] } }] }),
    oa({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    oa({ id: 'c1', choices: [], usage: { prompt_tokens: 30, completion_tokens: 9, total_tokens: 39 } }),
    'data: [DONE]',
];

describe('OpenAI adapter', () => {
    it('streams content, assembles fragmented tool calls and reads final usage', async () => {
        const { fetch, calls } = fakeFetch(() => sseResponse(openaiStream, { 'x-request-id': 'req_oa' }));
        const r = await collect(new OpenAIAdapter().stream(req(), { apiKey: FAKE_KEY, organization: 'org_1', project: 'proj_1', fetch }));
        expect(r.text).toBe('Hi there');
        expect(r.toolCalls).toEqual([{ id: 'call_1', name: 'seo_robots_txt', input: { url: 'https://pod.example' } }]);
        expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 9 });
        expect(r).toMatchObject({ stopReason: 'tool_use', providerRequestId: 'req_oa', model: 'gpt-x-2026' });
        const h = calls[0]!.init.headers as Record<string, string>;
        expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(h.authorization).toBe(`Bearer ${FAKE_KEY}`);
        expect(h['OpenAI-Organization']).toBe('org_1');
        expect(h['OpenAI-Project']).toBe('proj_1');
        const body = JSON.parse(calls[0]!.init.body as string);
        expect(body).toMatchObject({ model: 'model-a', max_completion_tokens: 256, stream: true, stream_options: { include_usage: true } });
        expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    });

    it('maps history, tools and JSON mode to Chat Completions fields', () => {
        const body = openaiBody(req({
            jsonObject: true,
            tools: [{ name: 'a', description: 'd', inputSchema: { type: 'object' } }],
            messages: [
                { role: 'user', content: 'q' },
                { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'a', input: { u: 1 } }] },
                { role: 'tool', toolCallId: 'c', name: 'a', content: 'done' },
            ],
        }));
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.tools).toEqual([{ type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object' } } }]);
        expect((body.messages as unknown[]).slice(1)).toEqual([
            { role: 'user', content: 'q' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'a', arguments: '{"u":1}' } }] },
            { role: 'tool', tool_call_id: 'c', content: 'done' },
        ]);
    });

    it.each([
        [401, { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided: sk-proj-abc***' } }, 'invalid_credentials'],
        [429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota' } }, 'insufficient_credits'],
        [429, { error: { type: 'requests', code: 'rate_limit_exceeded', message: 'Rate limit' } }, 'rate_limited'],
        [400, { error: { type: 'invalid_request_error', code: 'context_length_exceeded', message: 'maximum context length' } }, 'context_length'],
        [503, { error: { message: 'unavailable' } }, 'unavailable'],
    ])('HTTP %i → %s', async (status, body, category) => {
        const { fetch } = fakeFetch(() => jsonResponse(status, body));
        const e = await collect(new OpenAIAdapter().stream(req(), { apiKey: FAKE_KEY, fetch })).catch((x) => x);
        expect(e).toMatchObject({ category });
        expect(e.message).not.toMatch(/sk-proj/);
    });

    it('lists models', async () => {
        const { fetch, calls } = fakeFetch(() => jsonResponse(200, { object: 'list', data: [{ id: 'gpt-x', object: 'model' }] }));
        expect(await new OpenAIAdapter().listModels({ apiKey: FAKE_KEY, fetch })).toEqual([{ id: 'gpt-x', displayName: 'gpt-x' }]);
        expect(calls[0]!.url).toBe('https://api.openai.com/v1/models');
    });
});

describe('transport safety', () => {
    it('credentials can only be sent to the fixed provider origins', () => {
        expect(() => assertAllowedUrl('anthropic', 'https://api.anthropic.com/v1/messages')).not.toThrow();
        expect(() => assertAllowedUrl('anthropic', 'https://api.anthropic.com.evil.example/v1/messages')).toThrow();
        expect(() => assertAllowedUrl('openai', 'http://api.openai.com/v1/models')).toThrow();
        expect(() => assertAllowedUrl('openai', 'https://api.anthropic.com/v1/models')).toThrow();
    });

    it('sanitize redacts key-shaped strings, bearer headers and JWTs', () => {
        const s = sanitize('bad key sk-ant-api03-AAAAAAAAAAAA and sk-proj-BBBBBBBBBB, Bearer abc.def, eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl sb_secret_xyz');
        expect(s).not.toMatch(/sk-ant|sk-proj|abc\.def|eyJ|sb_secret/);
        expect(s.match(/\[redacted\]/g)!.length).toBeGreaterThanOrEqual(5);
    });

    it('the SSE parser handles CRLF, comments, multi-line data and split chunks', async () => {
        const text = ': comment\r\nevent: a\r\ndata: one\r\ndata: two\r\n\r\ndata: three\n\n';
        const bytes = new TextEncoder().encode(text);
        const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2)); c.close(); } });
        const out = [];
        for await (const m of parseSse(body)) out.push(m);
        expect(out).toEqual([{ event: 'a', data: 'one\ntwo' }, { event: null, data: 'three' }]);
    });
});
