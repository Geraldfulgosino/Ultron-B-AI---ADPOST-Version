import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config';

/** One browser client per page load (PKCE flow; session persisted by supabase-js in localStorage). */
export function createSupabaseBrowserClient(config: SupabaseConfig): SupabaseClient {
    return createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
        realtime: { params: { eventsPerSecond: 5 } },
    });
}

export type ConnectionStatus =
    | { state: 'ok'; latencyMs: number }
    | { state: 'unreachable'; detail: string }
    | { state: 'rejected'; httpStatus: number };

/**
 * Lightweight reachability probe against the Auth health endpoint. Sends only the public key,
 * reads no data, and never echoes the key back in its result.
 */
export async function checkConnection(config: SupabaseConfig, fetcher: typeof fetch = fetch, timeoutMs = 8000): Promise<ConnectionStatus> {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetcher(`${config.url}/auth/v1/health`, { headers: { apikey: config.publishableKey }, signal: ctrl.signal });
        if (!res.ok) return { state: 'rejected', httpStatus: res.status };
        return { state: 'ok', latencyMs: Date.now() - started };
    } catch (e) {
        return { state: 'unreachable', detail: (e as Error).name === 'AbortError' ? `no response within ${timeoutMs} ms` : 'network error' };
    } finally {
        clearTimeout(timer);
    }
}
