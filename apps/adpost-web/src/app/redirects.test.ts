import { authLinkError, hasAuthTokens, loginPath, safeNext } from './redirects';

describe('safeNext: return URLs after sign-in', () => {
    it('keeps same-app paths with their query and hash', () => {
        expect(safeNext('/a/adpost/c/pod/dashboard')).toBe('/a/adpost/c/pod/dashboard');
        expect(safeNext('/a/adpost/c/pod/reports?range=30d#top')).toBe('/a/adpost/c/pod/reports?range=30d#top');
        expect(safeNext('/invitations/tok_123')).toBe('/invitations/tok_123');
    });

    it.each([
        ['missing', null],
        ['empty', ''],
        ['absolute URL', 'https://evil.example/'],
        ['scheme', 'javascript:alert(1)'],
        ['protocol-relative', '//evil.example/a'],
        ['backslash host', '/\\evil.example'],
        ['encoded control character', '/home\n'],
        ['relative path', 'home'],
        ['too long', `/${'a'.repeat(2001)}`],
    ])('rejects %s', (_label, next) => {
        expect(safeNext(next)).toBe('/home');
    });

    it('never returns to an auth page (no redirect loop)', () => {
        for (const p of ['/login', '/login?next=/login', '/register', '/forgot-password', '/reset-password', '/login/']) expect(safeNext(p)).toBe('/home');
        expect(safeNext('/login-help')).toBe('/login-help');
    });

    it('normalizes dot segments instead of trusting them', () => {
        expect(safeNext('/a/../login')).toBe('/home');
        expect(safeNext('/a/./b')).toBe('/a/b');
    });

    it('builds the login path with the current location', () => {
        expect(loginPath({ pathname: '/a/x/c/y/reports', search: '?range=7d' })).toBe('/login?next=%2Fa%2Fx%2Fc%2Fy%2Freports%3Frange%3D7d');
    });
});

describe('email link results', () => {
    it('maps Supabase error codes to fixed messages and never echoes the description', () => {
        const expired = authLinkError({ search: '', hash: '#error=access_denied&error_code=otp_expired&error_description=<script>x</script>' });
        expect(expired).toBe('This link is invalid or has expired. Request a new one.');
        const other = authLinkError({ search: '?error=server_error&error_description=Database+down', hash: '' });
        expect(other).toBe('This link could not be used. Request a new one.');
        expect(other).not.toContain('Database');
        expect(authLinkError({ search: '?next=/home', hash: '' })).toBeNull();
    });

    it('detects link tokens the SDK has not consumed yet', () => {
        expect(hasAuthTokens({ search: '', hash: '#access_token=x&type=recovery' })).toBe(true);
        expect(hasAuthTokens({ search: '?code=abc', hash: '' })).toBe(true);
        expect(hasAuthTokens({ search: '', hash: '' })).toBe(false);
    });
});
