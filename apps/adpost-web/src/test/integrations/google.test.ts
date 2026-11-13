// @vitest-environment node
/** Google OAuth, GA4 and Search Console connectors with fakes. No Google request is made. */
import {
    buildAuthorizationUrl, createOAuthRequest, exchangeAuthorizationCode, googleApi, refreshAccessToken, resolveDateRange, revokeGoogleToken, sha256Hex, todayIn, validateOAuthCallback,
    type StoredOAuthState,
} from '../../../../../supabase/functions/_shared/integrations/google.ts';
import { listGa4Properties, runGa4Report, summarizeGa4, verifyGa4Property } from '../../../../../supabase/functions/_shared/integrations/ga4.ts';
import { findOpportunities, listGscSites, propertyCoversWebsite, querySearchAnalytics, verifyGscProperty, type GscRow } from '../../../../../supabase/functions/_shared/integrations/gsc.ts';

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown };
function fake(handler: Handler) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (input: string, init: RequestInit = {}) => {
        calls.push({ url: input, init });
        const r = handler(new URL(input), init);
        return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { fetch: f, calls };
}
const CFG = { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'server-only-secret', redirectUri: 'https://ppwkxlwxzutigepaizob.supabase.co/functions/v1/integration-oauth-callback' };

describe('Google OAuth (authorization code + PKCE)', () => {
    it('builds a read-only, offline, PKCE authorization URL', async () => {
        const req = await createOAuthRequest();
        expect(req.state).toMatch(/^[0-9a-f]{64}$/);
        expect(req.stateHash).toBe(await sha256Hex(req.state));
        const u = new URL(buildAuthorizationUrl(CFG, 'google_analytics', req.state, req.challenge));
        expect(u.origin).toBe('https://accounts.google.com');
        expect(Object.fromEntries(u.searchParams)).toMatchObject({ scope: 'https://www.googleapis.com/auth/analytics.readonly', access_type: 'offline', code_challenge_method: 'S256', state: req.state, response_type: 'code' });
        expect(u.toString()).not.toContain(CFG.clientSecret);
        expect(new URL(buildAuthorizationUrl(CFG, 'google_search_console', req.state, req.challenge)).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    });

    it('validates the callback: state, single use, expiry, same user', async () => {
        const req = await createOAuthRequest();
        const stored: StoredOAuthState = { stateHash: req.stateHash, provider: 'google_analytics', userId: 'u1', websiteId: 'w1', redirectUri: CFG.redirectUri, expiresAt: '2026-11-13T12:10:00Z', consumedAt: null };
        const now = new Date('2026-11-13T12:00:00Z');
        await expect(validateOAuthCallback({ state: req.state, code: 'c' }, stored, 'u1', now)).resolves.toEqual({ code: 'c' });
        await expect(validateOAuthCallback({ state: 'a'.repeat(64), code: 'c' }, stored, 'u1', now)).rejects.toMatchObject({ category: 'auth_failed' });
        await expect(validateOAuthCallback({ state: req.state, code: 'c' }, { ...stored, consumedAt: '2026-11-13T12:01:00Z' }, 'u1', now)).rejects.toThrow(/already used/);
        await expect(validateOAuthCallback({ state: req.state, code: 'c' }, stored, 'u1', new Date('2026-11-13T13:00:00Z'))).rejects.toThrow(/expired/);
        await expect(validateOAuthCallback({ state: req.state, code: 'c' }, stored, 'u2', now)).rejects.toMatchObject({ category: 'permission_denied' });
        await expect(validateOAuthCallback({ error: 'access_denied' }, stored, 'u1', now)).rejects.toMatchObject({ category: 'permission_denied' });
        await expect(validateOAuthCallback({ state: req.state }, stored, 'u1', now)).rejects.toThrow(/code/);
    });

    it('exchanges the code server-side and requires the read-only scope and a refresh token', async () => {
        const ok = fake(() => ({ body: { access_token: 'at', expires_in: 3599, refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/analytics.readonly' } }));
        const t = await exchangeAuthorizationCode(CFG, 'google_analytics', 'code', 'verifier', ok.fetch, new Date('2026-11-13T00:00:00Z'));
        expect(t).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresAt: '2026-11-13T00:59:59.000Z' });
        expect(String(ok.calls[0]!.init.body)).toContain('code_verifier=verifier');
        const noScope = fake(() => ({ body: { access_token: 'at', refresh_token: 'rt', scope: 'openid' } }));
        await expect(exchangeAuthorizationCode(CFG, 'google_analytics', 'code', 'v', noScope.fetch)).rejects.toMatchObject({ category: 'permission_denied' });
        const noRefresh = fake(() => ({ body: { access_token: 'at', scope: 'https://www.googleapis.com/auth/analytics.readonly' } }));
        await expect(exchangeAuthorizationCode(CFG, 'google_analytics', 'code', 'v', noRefresh.fetch)).rejects.toMatchObject({ category: 'auth_failed' });
    });

    it('refresh: an expired or revoked grant becomes credentials_expired; revoke calls Google', async () => {
        const expired = fake(() => ({ status: 400, body: { error: 'invalid_grant' } }));
        await expect(refreshAccessToken(CFG, 'rt', expired.fetch)).rejects.toMatchObject({ category: 'credentials_expired' });
        const fresh = fake(() => ({ body: { access_token: 'at2', expires_in: 3600 } }));
        expect((await refreshAccessToken(CFG, 'rt', fresh.fetch)).accessToken).toBe('at2');
        const rev = fake(() => ({ body: {} }));
        expect(await revokeGoogleToken('rt', rev.fetch)).toBe(true);
        expect(rev.calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
    });

    it('API transport only talks to Google API hosts and classifies errors', async () => {
        await expect(googleApi(fake(() => ({ body: {} })).fetch, 't', 'https://evil.example.org/x')).rejects.toMatchObject({ category: 'blocked_url' });
        for (const [status, category] of [[401, 'credentials_expired'], [403, 'permission_denied'], [429, 'rate_limited'], [503, 'provider_error']] as const) {
            await expect(googleApi(fake(() => ({ status, body: { error: { status: 'X' } } })).fetch, 't', 'https://analyticsdata.googleapis.com/v1beta/x')).rejects.toMatchObject({ category });
        }
    });

    it('date ranges: complete days ending yesterday, equal previous period, time zone aware', () => {
        expect(resolveDateRange('last_7_days', '2026-11-13')).toEqual({ current: { from: '2026-11-06', to: '2026-11-12' }, previous: { from: '2026-10-30', to: '2026-11-05' } });
        expect(resolveDateRange('last_28_days', '2026-03-01').current).toEqual({ from: '2026-02-01', to: '2026-02-28' });
        expect(resolveDateRange('custom', '2026-11-13', { from: '2026-10-01', to: '2026-10-31' }).previous).toEqual({ from: '2026-08-31', to: '2026-09-30' });
        expect(() => resolveDateRange('custom', '2026-11-13', { from: '2026-10-31', to: '2026-10-01' })).toThrow();
        // 2026-11-13 03:00 UTC is still 2026-11-12 in Los Angeles
        expect(todayIn('America/Los_Angeles', new Date('2026-11-13T03:00:00Z'))).toBe('2026-11-12');
    });
});

describe('GA4', () => {
    const summaries = { accountSummaries: [{ account: 'accounts/1', displayName: 'Lugenix', propertySummaries: [{ property: 'properties/111', displayName: 'lugenixdigitalservices.com' }] }] };

    it('lists properties and refuses one the account cannot access (never guessed)', async () => {
        const f = fake(() => ({ body: summaries }));
        expect(await listGa4Properties(f.fetch, 't')).toEqual([{ propertyId: 'properties/111', displayName: 'lugenixdigitalservices.com', account: 'accounts/1', accountName: 'Lugenix' }]);
        await expect(verifyGa4Property(f.fetch, 't', 'properties/999')).rejects.toMatchObject({ category: 'permission_denied' });
        await expect(verifyGa4Property(f.fetch, 't', 'UA-12345-1')).rejects.toThrow(/GA4 property/);
    });

    it('runs a paginated report, maps metrics by header name, keeps missing values null', async () => {
        const headers = { dimensionHeaders: [{ name: 'date' }, { name: 'deviceCategory' }], metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'engagementRate', 'keyEvents'].map((name) => ({ name })) };
        const f = fake((_u, init) => {
            const body = JSON.parse(String(init.body));
            const rows = body.offset === 0
                ? Array.from({ length: 10_000 }, (_, i) => ({ dimensionValues: [{ value: '20261101' }, { value: `d${i}` }], metricValues: [{ value: '2' }, { value: '1' }, { value: '1' }, { value: '0.5' }, { value: '' }] }))
                : [{ dimensionValues: [{ value: '20261102' }, { value: 'mobile' }], metricValues: [{ value: '7' }, { value: '5' }, { value: '3' }, { value: '0.43' }, { value: '1' }] }];
            return { body: { ...headers, rows, rowCount: 10_001, metadata: { timeZone: 'America/New_York' } } };
        });
        const r = await runGa4Report(f.fetch, 't', 'properties/111', { from: '2026-11-01', to: '2026-11-02' }, 'deviceCategory');
        expect(r).toMatchObject({ truncated: false, timeZone: 'America/New_York' });
        expect(r.rows).toHaveLength(10_001);
        expect(r.rows.at(-1)).toMatchObject({ date: '2026-11-02', dimensionValue: 'mobile', sessions: 7, activeUsers: 5, engagementRate: 0.43, keyEvents: 1, screenPageViews: null });
        expect(r.rows[0]!.keyEvents).toBeNull();
        expect(f.calls).toHaveLength(2);
        expect(JSON.parse(String(f.calls[0]!.init.body)).metrics.map((m: { name: string }) => m.name)).toContain('keyEvents');
    });

    it('no-data periods give no rows and no summary (never zeros)', async () => {
        const f = fake(() => ({ body: { rowCount: 0 } }));
        const r = await runGa4Report(f.fetch, 't', 'properties/111', { from: '2026-11-01', to: '2026-11-07' }, 'total');
        expect(r.rows).toEqual([]);
        expect(summarizeGa4(r.rows)).toBeNull();
    });

    it('summaries recompute ratios instead of summing them', () => {
        const day = (d: string, s: number, e: number) => ({ date: d, dimension: 'total' as const, dimensionValue: '', activeUsers: 1, totalUsers: 1, sessions: s, engagedSessions: e, engagementRate: e / s, screenPageViews: 1, eventCount: 1, keyEvents: null });
        expect(summarizeGa4([day('2026-11-01', 10, 5), day('2026-11-02', 30, 6)])).toMatchObject({ sessions: 40, engagedSessions: 11, engagementRate: 11 / 40, keyEvents: null });
    });
});

describe('Search Console', () => {
    it('validates property coverage by URL, never by name', () => {
        const site = 'https://lugenixdigitalservices.com/';
        expect(propertyCoversWebsite('sc-domain:lugenixdigitalservices.com', site)).toBe(true);
        expect(propertyCoversWebsite('sc-domain:lugenixdigitalservices.com', 'https://www.lugenixdigitalservices.com/')).toBe(true);
        expect(propertyCoversWebsite('https://lugenixdigitalservices.com/', site)).toBe(true);
        expect(propertyCoversWebsite('http://lugenixdigitalservices.com/', site)).toBe(false);
        expect(propertyCoversWebsite('https://www.lugenixdigitalservices.com/', site)).toBe(false);
        expect(propertyCoversWebsite('https://lugenixdigitalservices.com/blog/', site)).toBe(false);
        expect(propertyCoversWebsite('sc-domain:lugenixdigitalservices.co', site)).toBe(false);
        expect(propertyCoversWebsite('sc-domain:notlugenixdigitalservices.com', site)).toBe(false);
    });

    it('lists verified properties only and refuses unrelated or inaccessible ones', async () => {
        const f = fake(() => ({ body: { siteEntry: [{ siteUrl: 'sc-domain:lugenixdigitalservices.com', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.com/', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://pending.com/', permissionLevel: 'siteUnverifiedUser' }] } }));
        expect((await listGscSites(f.fetch, 't')).map((s) => s.siteUrl)).toEqual(['sc-domain:lugenixdigitalservices.com', 'https://other.com/']);
        await expect(verifyGscProperty(f.fetch, 't', 'https://other.com/', 'https://lugenixdigitalservices.com/')).rejects.toMatchObject({ category: 'site_mismatch' });
        await expect(verifyGscProperty(f.fetch, 't', 'https://pending.com/', 'https://pending.com/')).rejects.toMatchObject({ category: 'permission_denied' });
        expect(await verifyGscProperty(f.fetch, 't', 'sc-domain:lugenixdigitalservices.com', 'https://lugenixdigitalservices.com/')).toMatchObject({ kind: 'domain' });
    });

    it('queries with pagination and marks fresh (still changing) days', async () => {
        const f = fake((_u, init) => {
            const b = JSON.parse(String(init.body));
            const rows = b.startRow === 0
                ? Array.from({ length: 25_000 }, (_, i) => ({ keys: ['2026-11-01', `q${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 4.2 }))
                : [{ keys: ['2026-11-11', 'web design'], clicks: 2, impressions: 50, ctr: 0.04, position: 6 }, { keys: ['bad-date', 'x'], clicks: 1, impressions: 1, ctr: 1, position: 1 }];
            return { body: { rows, metadata: { first_incomplete_date: '2026-11-10' } } };
        });
        const r = await querySearchAnalytics(f.fetch, 't', 'sc-domain:lugenixdigitalservices.com', { from: '2026-11-01', to: '2026-11-12' }, 'query');
        expect(r.rows).toHaveLength(25_001);
        expect(r.rows.at(-1)).toMatchObject({ dimensionValue: 'web design', dataState: 'fresh' });
        expect(r.rows[0]!.dataState).toBe('final');
        expect(f.calls[0]!.url).toContain(encodeURIComponent('sc-domain:lugenixdigitalservices.com'));
    });

    it('finds evidence-backed opportunities with both date ranges and no invented metrics', () => {
        const row = (date: string, q: string, clicks: number, impressions: number, position: number): GscRow => ({ date, dimension: 'query', dimensionValue: q, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position, dataState: 'final' });
        const ranges = { current: { from: '2026-11-01', to: '2026-11-07' }, previous: { from: '2026-10-25', to: '2026-10-31' } };
        const current = [row('2026-11-01', 'wordpress seo agency', 1, 400, 6), row('2026-11-01', 'crm integration', 2, 120, 12), row('2026-11-01', 'dental marketing', 5, 200, 4)];
        const previous = [row('2026-10-25', 'dental marketing', 30, 220, 5), row('2026-10-25', 'crm integration', 1, 100, 17), row('2026-10-25', 'old query', 15, 90, 7)];
        const ops = findOpportunities('query', current, previous, ranges);
        const ids = ops.map((o) => `${o.checkId}:${o.subject}`);
        expect(ids).toEqual(expect.arrayContaining(['gsc_low_ctr:wordpress seo agency', 'gsc_near_page_one:crm integration', 'gsc_query_clicks_drop:dental marketing', 'gsc_position_improved:crm integration', 'gsc_query_clicks_drop:old query']));
        for (const o of ops) {
            expect(o.evidence.currentRange).toEqual(ranges.current);
            expect(o.evidence.note).toMatch(/not a live ranking/);
        }
        expect(JSON.stringify(ops)).not.toMatch(/volume|difficulty/i);
        expect(ops[0]!.severity).toBe('high');
    });
});
