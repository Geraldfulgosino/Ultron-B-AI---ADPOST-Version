/**
 * Error normalization at the adapter boundary. Provider error bodies are mapped to a
 * small set of categories; messages are sanitized so no credential-like string, header
 * or request body ever reaches logs, the database or the browser.
 */
import { AIProviderError, type AIErrorCategory, type ConnectionStatus, type ProviderCode } from './types.ts';

const SECRETISH = /(sk-[A-Za-z0-9_-]{6,}|sk_[A-Za-z0-9_-]{6,}|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+\S+|x-api-key\S*)/gi;

/** Remove anything that looks like a credential and cap the length. */
export function sanitize(message: string, max = 300): string {
    return message.replace(SECRETISH, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, max);
}

interface ErrorBody {
    error?: { type?: string; code?: string | null; message?: string };
    type?: string;
}

/** Map an HTTP failure from a provider to a normalized error. */
export function httpError(provider: ProviderCode, status: number, body: unknown, requestId: string | null): AIProviderError {
    const b = (body && typeof body === 'object' ? body : {}) as ErrorBody;
    const type = (b.error?.type ?? '').toLowerCase();
    const code = (b.error?.code ?? '').toString().toLowerCase();
    const msg = (b.error?.message ?? '').toLowerCase();
    let category: AIErrorCategory = 'unknown';
    let retryable = false;

    if (status === 401 || type === 'authentication_error' || code === 'invalid_api_key') category = 'invalid_credentials';
    else if (status === 402 || type === 'billing_error' || code === 'insufficient_quota' || msg.includes('credit balance') || msg.includes('exceeded your current quota')) category = 'insufficient_credits';
    else if (status === 403 || type === 'permission_error') category = 'permission_denied';
    else if (status === 404 || type === 'not_found_error' || code === 'model_not_found') category = 'model_not_found';
    else if (status === 429 || type === 'rate_limit_error') { category = 'rate_limited'; retryable = true; }
    else if (code === 'context_length_exceeded' || msg.includes('context length') || msg.includes('prompt is too long')) category = 'context_length';
    else if (status === 400 || status === 413 || status === 422 || type === 'invalid_request_error') category = 'invalid_request';
    else if (status >= 500 || type === 'api_error' || type === 'overloaded_error') { category = 'unavailable'; retryable = true; }

    const label = provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Provider';
    return new AIProviderError(category, `${label} ${CATEGORY_TEXT[category]} (HTTP ${status}).`, retryable, status, requestId);
}

export function networkError(e: unknown, signal?: AbortSignal, timedOut = false): AIProviderError {
    if (timedOut) return new AIProviderError('timeout', 'The provider did not respond in time.', true);
    if (signal?.aborted || (e as { name?: string })?.name === 'AbortError') return new AIProviderError('cancelled', 'Generation was stopped.', false);
    return new AIProviderError('unavailable', 'Could not reach the provider.', true);
}

/** User-facing, credential-free explanation per category. */
export const CATEGORY_TEXT: Record<AIErrorCategory, string> = {
    not_configured: 'is not configured: no server-side credential is available for this connection',
    invalid_credentials: 'rejected the credential',
    permission_denied: 'denied access for this credential',
    insufficient_credits: 'reports insufficient credits or quota',
    rate_limited: 'rate-limited the request',
    unavailable: 'is temporarily unavailable',
    timeout: 'timed out',
    cancelled: 'request was cancelled',
    invalid_request: 'rejected the request as invalid',
    context_length: 'rejected the request: the conversation is too long for this model',
    model_not_found: 'does not offer this model to this credential',
    budget_exceeded: 'request was blocked by a budget limit',
    not_authorized: 'request is not authorized',
    unsupported_capability: 'model lacks a capability this agent needs',
    unknown: 'returned an unexpected error',
};

/** Health status recorded on the connection after a test. */
export function statusForCategory(category: AIErrorCategory | null): ConnectionStatus {
    switch (category) {
        case null: return 'connected';
        case 'not_configured': return 'not_configured';
        case 'invalid_credentials': return 'invalid_credentials';
        case 'permission_denied': return 'permission_denied';
        case 'insufficient_credits': return 'insufficient_credits';
        case 'rate_limited': return 'rate_limited';
        default: return 'unavailable';
    }
}

export async function readJsonSafe(res: Response): Promise<unknown> {
    try {
        const text = await res.text();
        return text ? JSON.parse(text.slice(0, 20_000)) : null;
    } catch {
        return null;
    }
}
