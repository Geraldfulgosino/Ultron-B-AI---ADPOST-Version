/**
 * Browser client for the integration Edge Functions (staging mode only).
 *
 * The browser sends the signed-in user's access token and the public (publishable) key — nothing
 * else. WordPress Application Passwords pass through this module exactly once (to wp_connect over
 * HTTPS) and are never stored, cached or logged here. Google tokens never reach the browser.
 * Ownership (agency/client/website) is decided by the server from the JWT, never by these inputs.
 */
import type { SupabaseConfig } from './config';

export type LiveProvider = 'wordpress' | 'google_analytics' | 'google_search_console' | 'site_crawler';
export type DatePreset = 'last_7_days' | 'last_28_days' | 'last_30_days' | 'last_90_days' | 'custom';

export class IntegrationRequestError extends Error {
    constructor(readonly status: number, readonly category: string | null, message: string, readonly retryAfterSeconds: number | null = null) {
        super(message);
        this.name = 'IntegrationRequestError';
    }
}

export interface IntegrationsClientDeps {
    config: SupabaseConfig;
    /** Returns the current user's access token (supabase-js session), or null when signed out. */
    accessToken: () => Promise<string | null>;
    fetch?: typeof fetch;
}

const UUID = /^[0-9a-f-]{36}$/i;

export function createIntegrationsClient(deps: IntegrationsClientDeps) {
    const doFetch = deps.fetch ?? fetch;
    async function call<T>(fn: 'integration-sync' | 'integration-google', body: Record<string, unknown>): Promise<T> {
        const token = await deps.accessToken();
        if (!token) throw new IntegrationRequestError(401, null, 'Sign in again to continue.');
        const res = await doFetch(`${deps.config.url}/functions/v1/${fn}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, apikey: deps.config.publishableKey, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as { error?: string; category?: string; retryAfterSeconds?: number } | null;
        if (!res.ok) throw new IntegrationRequestError(res.status, json?.category ?? null, json?.error ?? `Request failed (HTTP ${res.status}).`, json?.retryAfterSeconds ?? null);
        return json as T;
    }
    const site = (websiteId: string) => {
        if (!UUID.test(websiteId)) throw new IntegrationRequestError(400, 'invalid', 'Choose a website first.');
        return websiteId;
    };
    return {
        discoverWordPress: (websiteId: string) => call<Record<string, unknown>>('integration-sync', { action: 'discover', websiteId: site(websiteId) }),
        connectWordPress: (websiteId: string, username: string, applicationPassword: string) =>
            call<{ status: 'connected'; user: { name: string; roles: string[] }; warnings: string[] }>('integration-sync', { action: 'wp_connect', websiteId: site(websiteId), username, applicationPassword }),
        syncWordPress: (websiteId: string, types?: Array<'page' | 'post' | 'category' | 'tag' | 'media'>) => call<Record<string, unknown>>('integration-sync', { action: 'wp_sync', websiteId: site(websiteId), types }),
        crawl: (websiteId: string, maxPages?: number) => call<Record<string, unknown>>('integration-sync', { action: 'crawl', websiteId: site(websiteId), maxPages }),
        disconnect: (websiteId: string, provider: LiveProvider) => call<{ status: 'not_connected' }>('integration-sync', { action: 'disconnect', websiteId: site(websiteId), provider }),
        startGoogle: (websiteId: string, provider: 'google_analytics' | 'google_search_console') => call<{ authorizationUrl: string }>('integration-google', { action: 'start', websiteId: site(websiteId), provider }),
        completeGoogle: (q: { state: string | null; code: string | null; error: string | null }) => call<{ websiteId: string; provider: string; next: 'select_property' }>('integration-google', { action: 'callback', ...q }),
        googleProperties: (websiteId: string, provider: 'google_analytics' | 'google_search_console') =>
            call<{ properties: Array<{ id: string; name: string; account: string; coversWebsite: boolean | null }> }>('integration-google', { action: 'properties', websiteId: site(websiteId), provider }),
        selectGoogleProperty: (websiteId: string, provider: 'google_analytics' | 'google_search_console', propertyId: string) =>
            call<{ status: 'connected'; propertyId: string; label: string }>('integration-google', { action: 'select', websiteId: site(websiteId), provider, propertyId }),
        syncGoogle: (websiteId: string, provider: 'google_analytics' | 'google_search_console', preset: DatePreset = 'last_28_days', custom?: { from: string; to: string }) =>
            call<Record<string, unknown>>('integration-google', { action: 'sync', websiteId: site(websiteId), provider, preset, ...(custom ?? {}) }),
    };
}

export type IntegrationsClient = ReturnType<typeof createIntegrationsClient>;

/** Only Google's consent screen may be opened from startGoogle (defence against a tampered response). */
export function assertGoogleConsentUrl(url: string): string {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'accounts.google.com') throw new IntegrationRequestError(502, 'invalid', 'Unexpected authorization URL.');
    return u.toString();
}
