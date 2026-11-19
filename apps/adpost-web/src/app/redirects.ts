/**
 * Return-URL validation for `?next=`. Only same-app paths are allowed, and never the auth pages
 * themselves (that would loop back to sign-in after signing in).
 */
const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

export function safeNext(next: string | null | undefined, fallback = '/home'): string {
    if (!next || next.length > 2000) return fallback;
    // Relative to this origin only: no scheme, no protocol-relative `//host`, no `/\host`
    // (browsers treat a backslash like a slash), no control characters.
    if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
    let url: URL;
    try {
        url = new URL(next, 'https://app.invalid');
    } catch {
        return fallback;
    }
    if (url.origin !== 'https://app.invalid') return fallback;
    if (AUTH_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login?next=…` for the current location. */
export const loginPath = (location: { pathname: string; search: string }, extra?: Record<string, string>) => {
    const params = new URLSearchParams({ next: location.pathname + location.search, ...extra });
    return `/login?${params.toString()}`;
};

/**
 * Error codes Supabase Auth puts in an email link's redirect (`#error_code=…` or `?error_code=…`).
 * Raw `error_description` text is never shown.
 */
export function authLinkError(location: { search: string; hash: string }): string | null {
    const read = (s: string) => new URLSearchParams(s.replace(/^[#?]/, ''));
    const hash = read(location.hash);
    const query = read(location.search);
    const code = hash.get('error_code') ?? query.get('error_code');
    const error = hash.get('error') ?? query.get('error');
    if (!code && !error) return null;
    if (code === 'otp_expired' || code === 'flow_state_expired') return 'This link is invalid or has expired. Request a new one.';
    return 'This link could not be used. Request a new one.';
}

/** True while an email link's tokens are still in the URL (the SDK has not consumed them yet). */
export function hasAuthTokens(location: { search: string; hash: string }): boolean {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search);
    return hash.has('access_token') || hash.get('type') === 'recovery' || query.has('code') || query.has('token_hash');
}
