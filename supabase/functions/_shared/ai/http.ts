/** HTTP helpers shared by adapters: fixed endpoints, timeouts, SSE parsing. */
import { httpError, networkError, readJsonSafe } from './errors.ts';
import type { ProviderCode } from './types.ts';

/** Endpoint allow-list. Adapters can only call these origins; there is no user-supplied base URL. */
export const PROVIDER_ORIGINS: Record<Exclude<ProviderCode, 'simulated'>, string> = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
};

export function assertAllowedUrl(provider: Exclude<ProviderCode, 'simulated'>, url: string): void {
    const u = new URL(url);
    if (u.origin !== PROVIDER_ORIGINS[provider]) throw new Error(`Refusing to send credentials to ${u.origin}`);
}

/**
 * fetch with a timeout and the caller's abort signal; non-2xx responses become
 * normalized errors (the body is parsed for its error type, never echoed).
 */
export async function providerFetch(
    provider: Exclude<ProviderCode, 'simulated'>,
    f: typeof fetch,
    url: string,
    init: RequestInit,
    opts: { timeoutMs: number; signal?: AbortSignal; requestIdHeader: string },
): Promise<Response> {
    assertAllowedUrl(provider, url);
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, opts.timeoutMs);
    const onAbort = () => ctl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) ctl.abort();
    let res: Response;
    try {
        res = await f(url, { ...init, signal: ctl.signal, redirect: 'error' });
    } catch (e) {
        opts.signal?.removeEventListener('abort', onAbort);
        throw networkError(e, opts.signal, timedOut);
    } finally {
        // The timeout covers the time to first byte; the caller's signal stays linked so
        // "stop generation" also aborts an in-progress body stream.
        clearTimeout(timer);
    }
    if (!res.ok) throw httpError(provider, res.status, await readJsonSafe(res), res.headers.get(opts.requestIdHeader));
    return res;
}

export interface SseMessage {
    event: string | null;
    data: string;
}

/** Minimal Server-Sent Events parser over a byte stream. */
export async function* parseSse(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncGenerator<SseMessage> {
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
        while (true) {
            if (signal?.aborted) throw networkError(null, signal);
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
                chunk = await reader.read();
            } catch (e) {
                throw networkError(e, signal);
            }
            if (chunk.done) break;
            buf += decoder.decode(chunk.value, { stream: true });
            let idx: number;
            while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
                const raw = buf.slice(0, idx);
                buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
                const msg = parseBlock(raw);
                if (msg) yield msg;
            }
        }
        const tail = parseBlock(buf);
        if (tail) yield tail;
    } finally {
        reader.releaseLock();
    }
}

function parseBlock(raw: string): SseMessage | null {
    let event: string | null = null;
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith(':')) continue;
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    }
    return data.length || event ? { event, data: data.join('\n') } : null;
}
