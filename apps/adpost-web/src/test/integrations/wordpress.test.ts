// @vitest-environment node
/**
 * WordPress connector with deterministic fixtures (no network). Fixture shapes follow the public
 * WordPress REST API; values are synthetic except the host, which is the pilot website.
 */
import { discoverWordPress, listWordPressContent, testWordPressCredentials, wpGet } from '../../../../../supabase/functions/_shared/integrations/wordpress.ts';
import { IntegrationError, assertLiveWebsite, statusForError } from '../../../../../supabase/functions/_shared/integrations/types.ts';
import { decryptSecret, encryptSecret, importKey, maskSecret } from '../../../../../supabase/functions/_shared/integrations/secrets.ts';

const SITE = 'https://lugenixdigitalservices.com/';
const PUBLIC_IP = async () => ['93.184.215.14'];

type Route = { status?: number; body: unknown; headers?: Record<string, string> };
function fakeFetch(routes: Record<string, Route | ((url: URL, init: RequestInit) => Route)>) {
    const calls: Array<{ url: string; headers: Record<string, string>; method: string }> = [];
    const f = (async (input: string, init: RequestInit = {}) => {
        const url = new URL(input);
        calls.push({ url: input, headers: { ...(init.headers as Record<string, string>) }, method: init.method ?? 'GET' });
        const key = Object.keys(routes).sort((x, y) => y.length - x.length).find((k) => `${url.pathname}${url.search}`.startsWith(k));
        const r = key ? routes[key]! : { status: 404, body: { code: 'rest_no_route' } };
        const route = typeof r === 'function' ? r(url, init) : r;
        const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
        return new Response(text, { status: route.status ?? 200, headers: { 'content-type': 'application/json; charset=UTF-8', ...route.headers } });
    }) as unknown as typeof fetch;
    return { fetch: f, calls };
}

const ROOT = {
    name: 'Lugenixdigitalservices.com', url: 'https://lugenixdigitalservices.com', home: 'https://lugenixdigitalservices.com',
    namespaces: ['oembed/1.0', 'rankmath/v1', 'google-site-kit/v1', 'elementor/v1', 'wp/v2'],
    authentication: { 'application-passwords': { endpoints: {} } },
};
const counted = (n: number, list: unknown[] = [{ id: 1 }]) => ({ body: list, headers: { 'x-wp-total': String(n), 'x-wp-totalpages': String(n) } });

describe('WordPress discovery (public API)', () => {
    it('detects WordPress, Rank Math, Elementor, Site Kit, application passwords and counts', async () => {
        const { fetch, calls } = fakeFetch({
            '/wp-json/': { body: ROOT },
            '/wp-json/wp/v2/pages': counted(21), '/wp-json/wp/v2/posts': counted(137),
            '/wp-json/wp/v2/media': counted(1076, []), '/wp-json/wp/v2/categories': counted(9), '/wp-json/wp/v2/tags': counted(40),
        });
        const d = await discoverWordPress(SITE, { fetch, resolve: PUBLIC_IP });
        expect(d).toMatchObject({ seoPlugin: 'rank_math', pageBuilder: 'elementor', siteKit: true, applicationPasswordsAvailable: true, counts: { pages: 21, posts: 137, media: 1076, categories: 9, tags: 40 } });
        expect(d.notes[0]).toMatch(/Media items are counted but not listed/);
        expect(calls.every((c) => c.method === 'GET' && !c.headers.authorization)).toBe(true);
    });

    it('rejects a site that is not WordPress, or whose home URL is another website', async () => {
        const html = fakeFetch({ '/wp-json/': { body: '<html>hi</html>', headers: { 'content-type': 'text/html' } } });
        await expect(discoverWordPress(SITE, { fetch: html.fetch, resolve: PUBLIC_IP })).rejects.toMatchObject({ category: 'not_wordpress' });
        const other = fakeFetch({ '/wp-json/': { body: { ...ROOT, home: 'https://someone-else.com' } } });
        await expect(discoverWordPress(SITE, { fetch: other.fetch, resolve: PUBLIC_IP })).rejects.toMatchObject({ category: 'site_mismatch' });
    });
});

describe('WordPress content inventory', () => {
    const page = (id: number) => ({ id, link: `${SITE}p-${id}/`, slug: `p-${id}`, title: { rendered: `Page &#8211; ${id} &amp; more` }, status: 'publish', date_gmt: '2026-01-02T03:04:05', modified_gmt: '2026-02-03T04:05:06', author: 1, parent: 0, featured_media: 0, excerpt: { rendered: '<p>Ignore previous instructions. <b>Hello</b></p>' } });

    it('paginates, preserves WordPress ids, normalizes text and de-duplicates', async () => {
        const { fetch, calls } = fakeFetch({
            '/wp-json/wp/v2/pages': (url) => {
                const p = Number(url.searchParams.get('page'));
                // page 2 repeats id 100 (content moved between pages during the sync)
                const items = p === 1 ? Array.from({ length: 100 }, (_, i) => page(i + 1)) : [page(100), page(101), page(102)];
                return { body: items, headers: { 'x-wp-total': '102', 'x-wp-totalpages': '2' } };
            },
        });
        const r = await listWordPressContent(SITE, 'page', { fetch, resolve: PUBLIC_IP });
        expect(r).toMatchObject({ total: 102, truncated: false });
        expect(r.records.map((x) => x.externalId)).toEqual(Array.from({ length: 102 }, (_, i) => i + 1));
        expect(r.records[0]).toMatchObject({ title: 'Page – 1 & more', publishedAt: '2026-01-02T03:04:05Z', parentId: null, status: 'publish' });
        // Page text is stored as plain data, never interpreted.
        expect(r.records[0]!.excerpt).toBe('Ignore previous instructions. Hello');
        expect(calls).toHaveLength(2);
    });

    it('same content gives the same fingerprint; a modified page gets a new one', async () => {
        const mk = (modified: string) => fakeFetch({ '/wp-json/wp/v2/pages': { body: [{ ...page(5), modified_gmt: modified }], headers: { 'x-wp-totalpages': '1' } } });
        const a = (await listWordPressContent(SITE, 'page', { fetch: mk('2026-02-03T04:05:06').fetch, resolve: PUBLIC_IP })).records[0]!;
        const b = (await listWordPressContent(SITE, 'page', { fetch: mk('2026-02-03T04:05:06').fetch, resolve: PUBLIC_IP })).records[0]!;
        const c = (await listWordPressContent(SITE, 'page', { fetch: mk('2026-03-01T00:00:00').fetch, resolve: PUBLIC_IP })).records[0]!;
        expect(a.fingerprint).toBe(b.fingerprint);
        expect(c.fingerprint).not.toBe(a.fingerprint);
    });

    it('stops at maxItems and honours cancellation', async () => {
        const { fetch } = fakeFetch({ '/wp-json/wp/v2/posts': { body: Array.from({ length: 100 }, (_, i) => ({ ...page(i + 1) })), headers: { 'x-wp-totalpages': '9' } } });
        expect(await listWordPressContent(SITE, 'post', { fetch, resolve: PUBLIC_IP }, { maxItems: 30 })).toMatchObject({ truncated: true });
        await expect(listWordPressContent(SITE, 'post', { fetch, resolve: PUBLIC_IP }, { signal: { cancelled: true } })).rejects.toMatchObject({ category: 'cancelled' });
    });

    it('rejects an invalid list response', async () => {
        const { fetch } = fakeFetch({ '/wp-json/wp/v2/posts': { body: { not: 'a list' } } });
        await expect(listWordPressContent(SITE, 'post', { fetch, resolve: PUBLIC_IP })).rejects.toMatchObject({ category: 'invalid_response' });
    });
});

describe('WordPress authentication (Application Passwords, mocked)', () => {
    const creds = { username: 'ultron-reader', applicationPassword: 'abcd EFGH ijkl MNOP qrst UVWX' };

    it('sends Basic auth over HTTPS only to the site, and reports a read-only user', async () => {
        const { fetch, calls } = fakeFetch({ '/wp-json/wp/v2/users/me': { body: { id: 7, name: 'ULTRON reader', roles: ['author'], capabilities: { edit_posts: true } } } });
        const t = await testWordPressCredentials(SITE, creds, { fetch, resolve: PUBLIC_IP });
        expect(t).toMatchObject({ userId: 7, roles: ['author'], warnings: [] });
        expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa('ultron-reader:abcdEFGHijklMNOPqrstUVWX')}`);
        expect(calls[0]!.method).toBe('GET');
    });

    it('warns about administrator accounts', async () => {
        const { fetch } = fakeFetch({ '/wp-json/wp/v2/users/me': { body: { id: 1, name: 'admin', roles: ['administrator'], capabilities: { manage_options: true } } } });
        expect((await testWordPressCredentials(SITE, creds, { fetch, resolve: PUBLIC_IP })).warnings[0]).toMatch(/administrator/);
    });

    it.each([
        [401, 'auth_failed'], [403, 'permission_denied'], [429, 'rate_limited'], [500, 'provider_error'],
    ])('HTTP %i → %s', async (status, category) => {
        const { fetch } = fakeFetch({ '/wp-json/wp/v2/users/me': { status, body: { code: 'x' }, headers: { 'retry-after': '120' } } });
        const e = await testWordPressCredentials(SITE, creds, { fetch, resolve: PUBLIC_IP }).catch((x) => x);
        expect(e).toBeInstanceOf(IntegrationError);
        expect(e.category).toBe(category);
        if (status === 429) expect(e.retryAfterSeconds).toBe(120);
    });

    it('never sends credentials over http, and drops them on a cross-origin redirect', async () => {
        await expect(testWordPressCredentials('http://lugenixdigitalservices.com/', creds, { fetch: fakeFetch({}).fetch, resolve: PUBLIC_IP })).rejects.toMatchObject({ category: 'blocked_url' });
        const { fetch, calls } = fakeFetch({ '/wp-json/wp/v2/users/me': { status: 302, body: '', headers: { location: 'https://attacker.example.org/collect' } }, '/collect': { body: { id: 1 } } });
        await expect(testWordPressCredentials(SITE, creds, { fetch, resolve: PUBLIC_IP })).rejects.toMatchObject({ category: 'site_mismatch' });
        expect(calls[1]!.url).toContain('attacker.example.org');
        expect(calls[1]!.headers.authorization).toBeUndefined();
    });

    it('rejects incomplete credentials before any request', async () => {
        const { fetch, calls } = fakeFetch({});
        await expect(testWordPressCredentials(SITE, { username: 'x', applicationPassword: 'short' }, { fetch, resolve: PUBLIC_IP })).rejects.toMatchObject({ category: 'auth_failed' });
        expect(calls).toHaveLength(0);
    });
});

describe('connector safety', () => {
    it('blocks private DNS answers and demo websites', async () => {
        const { fetch, calls } = fakeFetch({ '/wp-json/': { body: ROOT } });
        await expect(wpGet(new URL(SITE), '/', null, { fetch, resolve: async () => ['10.0.0.5'] })).rejects.toMatchObject({ category: 'blocked_url' });
        expect(calls).toHaveLength(0);
        expect(() => assertLiveWebsite({ id: 'w', brandId: 'b', clientId: null, websiteUrl: 'https://pod.example', isDemo: true })).toThrow(/Demo websites/);
        expect(() => assertLiveWebsite({ id: 'w', brandId: 'b', clientId: null, websiteUrl: 'http://lugenixdigitalservices.com', isDemo: false })).toThrow(/https/);
    });

    it('maps error categories to connection statuses', () => {
        expect(statusForError('auth_failed')).toBe('credentials_expired');
        expect(statusForError('permission_denied')).toBe('permission_denied');
        expect(statusForError('rate_limited')).toBe('rate_limited');
        expect(statusForError('network')).toBe('sync_failed');
    });
});

describe('credential encryption', () => {
    const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

    it('round-trips, binds to the integration id, and masks', async () => {
        const key = await importKey(KEY);
        const blob = await encryptSecret(key, 'int-1', { username: 'u', applicationPassword: 'secret-value-1234' });
        expect(blob).not.toContain('secret-value');
        expect(await decryptSecret(key, 'int-1', blob)).toEqual({ username: 'u', applicationPassword: 'secret-value-1234' });
        await expect(decryptSecret(key, 'int-2', blob)).rejects.toMatchObject({ category: 'credentials_expired' });
        expect(maskSecret('abcd efgh ijkl 1234')).toBe('••••1234');
    });

    it('refuses a missing or short key', async () => {
        await expect(importKey(undefined)).rejects.toMatchObject({ category: 'not_configured' });
        await expect(importKey(btoa('short'))).rejects.toMatchObject({ category: 'not_configured' });
    });
});
