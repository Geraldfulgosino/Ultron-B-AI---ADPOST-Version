/**
 * Google OAuth 2.0 (authorization code + PKCE) and API transport for GA4 and Search Console.
 *
 * - Server-side only: the client secret, authorization codes, access and refresh tokens never reach
 *   the browser. The browser is only redirected to accounts.google.com and back to the callback.
 * - Read-only scopes: analytics.readonly and webmasters.readonly.
 * - state is random, stored as a SHA-256 hash with the PKCE verifier (encrypted), bound to the user
 *   and website, single-use and short-lived.
 * - Requests go only to fixed Google API hosts (no user-supplied URLs).
 */
import { IntegrationError } from './types.ts';

export const GOOGLE_SCOPES = {
    google_analytics: ['https://www.googleapis.com/auth/analytics.readonly'],
    google_search_console: ['https://www.googleapis.com/auth/webmasters.readonly'],
} as const;
export type GoogleProvider = keyof typeof GOOGLE_SCOPES;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_API_HOSTS = new Set(['oauth2.googleapis.com', 'analyticsadmin.googleapis.com', 'analyticsdata.googleapis.com', 'www.googleapis.com', 'searchconsole.googleapis.com']);

export interface GoogleOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64url = (b: Uint8Array) => {
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export async function sha256Hex(s: string): Promise<string> {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

/** A fresh state and PKCE pair. Store sha256(state) and the (encrypted) verifier; send state + challenge. */
export async function createOAuthRequest() {
    const state = hex(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    return { state, stateHash: await sha256Hex(state), verifier, challenge };
}

export function buildAuthorizationUrl(cfg: Pick<GoogleOAuthConfig, 'clientId' | 'redirectUri'>, provider: GoogleProvider, state: string, challenge: string, loginHint?: string): string {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', GOOGLE_SCOPES[provider].join(' '));
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('include_granted_scopes', 'false');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    if (loginHint) u.searchParams.set('login_hint', loginHint);
    return u.toString();
}

export interface StoredOAuthState {
    stateHash: string;
    provider: GoogleProvider;
    userId: string;
    websiteId: string;
    redirectUri: string;
    expiresAt: string;
    consumedAt: string | null;
}

/** Callback checks: state matches a stored, unexpired, unused request of the same signed-in user. */
export async function validateOAuthCallback(
    q: { state?: string | null; code?: string | null; error?: string | null },
    stored: StoredOAuthState | null,
    callerId: string | null,
    now: Date = new Date(),
): Promise<{ code: string }> {
    if (q.error) throw new IntegrationError(q.error === 'access_denied' ? 'permission_denied' : 'auth_failed', q.error === 'access_denied' ? 'Google access was not granted.' : 'Google returned an authorization error.');
    if (!q.state || !/^[0-9a-f]{64}$/.test(q.state)) throw new IntegrationError('auth_failed', 'Missing or malformed OAuth state.');
    if (!q.code || q.code.length > 2048) throw new IntegrationError('auth_failed', 'Missing authorization code.');
    if (!stored || stored.stateHash !== (await sha256Hex(q.state))) throw new IntegrationError('auth_failed', 'Unknown OAuth state. Start the connection again.');
    if (stored.consumedAt) throw new IntegrationError('auth_failed', 'This authorization was already used.');
    if (new Date(stored.expiresAt).getTime() < now.getTime()) throw new IntegrationError('auth_failed', 'The authorization expired. Start the connection again.');
    if (!callerId || callerId !== stored.userId) throw new IntegrationError('permission_denied', 'The authorization belongs to another user.');
    return { code: q.code };
}

export interface GoogleTokens {
    accessToken: string;
    expiresAt: string;
    refreshToken: string | null;
    scopes: string[];
}

function classifyGoogle(status: number, body: unknown): IntegrationError {
    const err = (body as { error?: string | { status?: string; message?: string } })?.error;
    const code = typeof err === 'string' ? err : err?.status ?? '';
    if (code === 'invalid_grant' || status === 401) return new IntegrationError('credentials_expired', 'Google authorization expired or was revoked. Reconnect the integration.');
    if (status === 403 || code === 'PERMISSION_DENIED') return new IntegrationError('permission_denied', 'The connected Google account cannot access this resource.');
    if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new IntegrationError('rate_limited', 'Google API quota or rate limit reached. Try again later.');
    if (status === 404) return new IntegrationError('not_found', 'The Google resource was not found.');
    if (status === 400) return new IntegrationError('invalid_response', 'Google rejected the request.');
    return new IntegrationError('provider_error', `Google returned HTTP ${status}.`);
}

async function tokenRequest(fetchFn: typeof fetch, body: Record<string, string>, now: Date): Promise<GoogleTokens> {
    const res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok || !json) throw classifyGoogle(res.status, json);
    if (typeof json.access_token !== 'string') throw new IntegrationError('invalid_response', 'Google did not return an access token.');
    return {
        accessToken: json.access_token,
        expiresAt: new Date(now.getTime() + (Number(json.expires_in) || 3600) * 1000).toISOString(),
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
        scopes: typeof json.scope === 'string' ? json.scope.split(' ') : [],
    };
}

export async function exchangeAuthorizationCode(cfg: GoogleOAuthConfig, provider: GoogleProvider, code: string, verifier: string, fetchFn: typeof fetch, now = new Date()): Promise<GoogleTokens & { refreshToken: string }> {
    const t = await tokenRequest(fetchFn, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri }, now);
    const missing = GOOGLE_SCOPES[provider].filter((s) => !t.scopes.includes(s));
    if (missing.length) throw new IntegrationError('permission_denied', 'The required read-only Google permission was not granted.');
    if (!t.refreshToken) throw new IntegrationError('auth_failed', 'Google did not return a refresh token. Remove the app from the Google account and connect again.');
    return { ...t, refreshToken: t.refreshToken };
}

export async function refreshAccessToken(cfg: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>, refreshToken: string, fetchFn: typeof fetch, now = new Date()): Promise<GoogleTokens> {
    return tokenRequest(fetchFn, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }, now);
}

/** Revokes the grant at Google. Local credentials are deleted whatever Google answers. */
export async function revokeGoogleToken(token: string, fetchFn: typeof fetch): Promise<boolean> {
    const res = await fetchFn(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
    return res.ok;
}

/** Authorized JSON request to a fixed Google API host. */
export async function googleApi<T>(fetchFn: typeof fetch, accessToken: string, url: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !GOOGLE_API_HOSTS.has(u.hostname)) throw new IntegrationError('blocked_url', 'Only Google API hosts are allowed.');
    const res = await fetchFn(u.toString(), {
        method: init.method ?? 'GET',
        redirect: 'error',
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw classifyGoogle(res.status, json);
    if (json === null) throw new IntegrationError('invalid_response', 'Google returned an empty response.');
    return json as T;
}

// ── Date ranges (reporting time zone aware) ────────────────────────────────────────────────────
export type DatePreset = 'last_7_days' | 'last_28_days' | 'last_30_days' | 'last_90_days' | 'custom';
export interface DateRange { from: string; to: string }

const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

/** "Today" in a reporting time zone (GA4 property / site time zone), as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
        return now.toISOString().slice(0, 10);
    }
}

/** Complete days ending yesterday (today is partial), plus the previous period of equal length. */
export function resolveDateRange(preset: DatePreset, today: string, custom?: DateRange): { current: DateRange; previous: DateRange } {
    let current: DateRange;
    if (preset === 'custom') {
        if (!custom || !/^\d{4}-\d{2}-\d{2}$/.test(custom.from) || !/^\d{4}-\d{2}-\d{2}$/.test(custom.to) || custom.from > custom.to) throw new IntegrationError('invalid_response', 'Choose a valid custom date range.');
        if (daysBetween(custom.from, custom.to) > 500) throw new IntegrationError('limit_exceeded', 'Custom ranges are limited to 16 months.');
        current = custom;
    } else {
        const n = { last_7_days: 7, last_28_days: 28, last_30_days: 30, last_90_days: 90 }[preset];
        current = { from: addDays(today, -n), to: addDays(today, -1) };
    }
    const len = daysBetween(current.from, current.to) + 1;
    return { current, previous: { from: addDays(current.from, -len), to: addDays(current.from, -1) } };
}
