import { assertGoogleConsentUrl, createIntegrationsClient, IntegrationRequestError } from './integrationsClient';

const CONFIG = { url: 'https://ppwkxlwxzutigepaizob.supabase.co', publishableKey: 'sb_publishable_test', projectRef: 'ppwkxlwxzutigepaizob' };
const SITE = '11111111-1111-4111-8111-111111111111';

function fake(status = 200, body: unknown = { ok: true }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { f, calls };
}

describe('integrations client (browser → Edge Functions)', () => {
    it('sends only the user token and public key; the website id is the only scope input', async () => {
        const { f, calls } = fake();
        const c = createIntegrationsClient({ config: CONFIG, accessToken: async () => 'user-jwt', fetch: f });
        await c.syncWordPress(SITE, ['page']);
        expect(calls[0]!.url).toBe('https://ppwkxlwxzutigepaizob.supabase.co/functions/v1/integration-sync');
        expect(calls[0]!.init.headers).toEqual({ authorization: 'Bearer user-jwt', apikey: 'sb_publishable_test', 'content-type': 'application/json' });
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ action: 'wp_sync', websiteId: SITE, types: ['page'] });
    });

    it('passes the Application Password once and keeps nothing', async () => {
        const { f, calls } = fake(200, { status: 'connected', user: { name: 'r', roles: [] }, warnings: [] });
        const c = createIntegrationsClient({ config: CONFIG, accessToken: async () => 'jwt', fetch: f });
        await c.connectWordPress(SITE, 'reader', 'abcd efgh ijkl mnop qrst uvwx');
        expect(calls).toHaveLength(1);
        expect(JSON.stringify(c)).not.toContain('abcd');
        expect(Object.keys(localStorage).join()).not.toMatch(/wp|password|integration/i);
    });

    it('maps server errors (category, retry-after) and refuses when signed out or without a website', async () => {
        const c = createIntegrationsClient({ config: CONFIG, accessToken: async () => 'jwt', fetch: fake(429, { error: 'Too many syncs.', category: 'rate_limited', retryAfterSeconds: 60 }).f });
        await expect(c.crawl(SITE)).rejects.toMatchObject({ status: 429, category: 'rate_limited', retryAfterSeconds: 60, message: 'Too many syncs.' });
        const out = createIntegrationsClient({ config: CONFIG, accessToken: async () => null, fetch: fake().f });
        await expect(out.crawl(SITE)).rejects.toMatchObject({ status: 401 });
        expect(() => c.crawl('not-a-uuid')).toThrow(IntegrationRequestError);
    });

    it('opens only Google’s consent screen', () => {
        expect(assertGoogleConsentUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toContain('accounts.google.com');
        expect(() => assertGoogleConsentUrl('https://accounts.google.com.evil.example/x')).toThrow();
        expect(() => assertGoogleConsentUrl('javascript:alert(1)')).toThrow();
    });
});
