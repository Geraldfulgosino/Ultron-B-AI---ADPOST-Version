/**
 * Website integration system (master prompt v7). Provider-independent types shared by every
 * connector (WordPress, GA4, Search Console, crawler) and by the Edge Functions that run them.
 *
 * Ownership is never taken from the browser: an Edge Function loads the website row with the
 * caller's JWT (RLS decides visibility), then passes that row to a connector. Connectors only
 * ever talk to the website's own host (or the provider's fixed API host).
 */
import type { Resolver } from '../urlSafety.ts';

export type IntegrationProvider = 'wordpress' | 'google_analytics' | 'google_search_console' | 'site_crawler';

/** Connection status shown in the UI. 'connected' is set only after a real provider request succeeded. */
export const INTEGRATION_STATUSES = [
    'not_connected', 'pending_authorization', 'connected', 'syncing', 'sync_completed', 'sync_failed',
    'credentials_expired', 'permission_denied', 'rate_limited', 'disabled',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export type IntegrationErrorCategory =
    | 'auth_failed' | 'credentials_expired' | 'permission_denied' | 'rate_limited' | 'not_found'
    | 'not_wordpress' | 'site_mismatch' | 'invalid_response' | 'network' | 'blocked_url' | 'provider_error'
    | 'limit_exceeded' | 'cancelled' | 'not_configured';

export class IntegrationError extends Error {
    constructor(
        readonly category: IntegrationErrorCategory,
        message: string,
        readonly retryAfterSeconds: number | null = null,
    ) {
        super(message);
        this.name = 'IntegrationError';
    }
}

/** Status a connection takes after an error of this category. */
export function statusForError(category: IntegrationErrorCategory): IntegrationStatus {
    switch (category) {
        case 'auth_failed':
        case 'credentials_expired':
            return 'credentials_expired';
        case 'permission_denied':
            return 'permission_denied';
        case 'rate_limited':
            return 'rate_limited';
        default:
            return 'sync_failed';
    }
}

export interface HttpDeps {
    resolve: Resolver;
    fetch: typeof fetch;
    now?: () => Date;
}

/** The website as loaded server-side under RLS (never from request parameters). */
export interface WebsiteRef {
    id: string;
    brandId: string;
    clientId: string | null;
    websiteUrl: string;
    isDemo: boolean;
}

export interface SyncSummary {
    provider: IntegrationProvider;
    kind: string;
    recordsRead: number;
    recordsWritten: number;
    truncated: boolean;
    startedAt: string;
    finishedAt: string;
}

/** Registry entry: what a connector can do, used by the UI and by the agent tool registry. */
export interface IntegrationDescriptor {
    provider: IntegrationProvider;
    label: string;
    authMethods: Array<'none' | 'application_password' | 'oauth2'>;
    readOnly: true;
    syncKinds: string[];
    /** True only when the connector has an executable implementation with passing tests (NOT the same as live-verified). */
    implemented: boolean;
}

export const INTEGRATION_REGISTRY: Record<IntegrationProvider, IntegrationDescriptor> = {
    wordpress: { provider: 'wordpress', label: 'WordPress', authMethods: ['none', 'application_password'], readOnly: true, syncKinds: ['discovery', 'pages', 'posts', 'categories', 'tags', 'media'], implemented: true },
    google_analytics: { provider: 'google_analytics', label: 'Google Analytics 4', authMethods: ['oauth2'], readOnly: true, syncKinds: ['daily_summary', 'dimensions'], implemented: true },
    google_search_console: { provider: 'google_search_console', label: 'Google Search Console', authMethods: ['oauth2'], readOnly: true, syncKinds: ['queries', 'pages'], implemented: true },
    site_crawler: { provider: 'site_crawler', label: 'Technical SEO crawler', authMethods: ['none'], readOnly: true, syncKinds: ['crawl'], implemented: true },
};

/** Demo websites (reserved .example domains) are never contacted by any connector. */
export function assertLiveWebsite(w: WebsiteRef): URL {
    if (w.isDemo) throw new IntegrationError('blocked_url', 'Demo websites are never connected to live providers.');
    let u: URL;
    try {
        u = new URL(w.websiteUrl);
    } catch {
        throw new IntegrationError('blocked_url', 'The website URL is not valid.');
    }
    if (u.protocol !== 'https:') throw new IntegrationError('blocked_url', 'Live integrations require an https:// website URL.');
    return u;
}

export const sameSite = (a: string, b: string) => {
    const bare = (h: string) => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return bare(a) === bare(b);
};
