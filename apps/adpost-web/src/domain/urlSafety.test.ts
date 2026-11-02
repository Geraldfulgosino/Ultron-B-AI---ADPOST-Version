import { assertResolvedPublic, isPublicIp, safeFetch, UrlSafetyError, validatePublicUrl } from './urlSafety';

const reason = (fn: () => unknown) => {
    try {
        fn();
        return 'ok';
    } catch (e) {
        return e instanceof UrlSafetyError ? e.reason : 'other';
    }
};

describe('validatePublicUrl (no network)', () => {
    it('accepts ordinary public sites', () => {
        expect(validatePublicUrl('https://shop.pod.example.com/products?x=1#frag').toString()).toBe('https://shop.pod.example.com/products?x=1');
        expect(reason(() => validatePublicUrl('http://93.184.216.34/'))).toBe('ok');
        expect(reason(() => validatePublicUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/'))).toBe('ok');
    });

    it.each([
        ['ftp://example.com/', 'scheme'], ['file:///etc/passwd', 'scheme'], ['javascript:alert(1)', 'scheme'], ['gopher://x.example.com', 'scheme'],
        ['https://user:pw@example.com/', 'credentials'], ['https://example.com:8080/', 'port'], ['http://example.com:22/', 'port'],
        ['http://localhost/', 'blocked_host'], ['http://foo.localhost/', 'blocked_host'], ['http://metadata.google.internal/', 'blocked_host'],
        ['http://printer.local/', 'blocked_host'], ['http://intranet/', 'host'],
        ['http://127.0.0.1/', 'private_ip'], ['http://10.1.2.3/', 'private_ip'], ['http://172.16.0.1/', 'private_ip'], ['http://192.168.1.1/', 'private_ip'],
        ['http://169.254.169.254/latest/meta-data/', 'private_ip'], ['http://100.64.0.1/', 'private_ip'], ['http://0.0.0.0/', 'private_ip'],
        // Obfuscated IPv4 forms normalised by the URL parser.
        ['http://2130706433/', 'private_ip'], ['http://0x7f.1/', 'private_ip'], ['http://127.1/', 'private_ip'], ['http://0177.0.0.1/', 'private_ip'],
        // IPv6 forms.
        ['http://[::1]/', 'private_ip'], ['http://[::]/', 'private_ip'], ['http://[fd00::1]/', 'private_ip'], ['http://[fe80::1]/', 'private_ip'],
        ['http://[::ffff:127.0.0.1]/', 'private_ip'], ['http://[::ffff:169.254.169.254]/', 'private_ip'], ['http://[::ffff:7f00:1]/', 'private_ip'],
        ['not a url', 'invalid'],
    ])('rejects %s (%s)', (url, why) => {
        expect(reason(() => validatePublicUrl(url))).toBe(why);
    });
});

describe('DNS answers', () => {
    it('rejects a host when ANY resolved address is private (rebinding-style split answers)', () => {
        expect(reason(() => assertResolvedPublic('evil.example.com', ['93.184.216.34', '10.0.0.5']))).toBe('private_dns');
        expect(reason(() => assertResolvedPublic('nx.example.com', []))).toBe('dns');
        expect(reason(() => assertResolvedPublic('ok.example.com', ['93.184.216.34', '2606:2800:220:1::1']))).toBe('ok');
        expect(isPublicIp('64:ff9b::7f00:1')).toBe(false);
    });
});

describe('safeFetch', () => {
    const publicDns = async () => ['93.184.216.34'];
    const page = (status: number, headers: Record<string, string> = {}, body = '') => new Response(status >= 300 && status < 400 ? null : body, { status, headers });

    it('follows redirects manually, recording the chain', async () => {
        const responses: Record<string, Response> = {
            'http://pod.example.com/': page(301, { location: 'https://pod.example.com/' }),
            'https://pod.example.com/': page(302, { location: '/home' }),
            'https://pod.example.com/home': page(200, { 'content-type': 'text/html' }, '<title>POD</title>'),
        };
        const seen: RequestInit[] = [];
        const r = await safeFetch('http://pod.example.com/', {
            resolve: publicDns,
            fetch: (async (u: string, init?: RequestInit) => (seen.push(init!), responses[u]!)) as typeof fetch,
        });
        expect(r.chain.map((c) => c.status)).toEqual([301, 302, 200]);
        expect(r.finalUrl).toBe('https://pod.example.com/home');
        expect(r.body).toBe('<title>POD</title>');
        expect(seen.every((i) => i.redirect === 'manual')).toBe(true);
    });

    it('refuses a redirect to an internal address (classic SSRF bypass)', async () => {
        const f = (async () => page(302, { location: 'http://169.254.169.254/latest/meta-data/' })) as unknown as typeof fetch;
        await expect(safeFetch('https://pod.example.com/', { resolve: publicDns, fetch: f })).rejects.toMatchObject({ reason: 'private_ip' });
    });

    it('refuses a public-looking hostname that resolves privately, before any request is made', async () => {
        let calls = 0;
        const f = (async () => (calls++, page(200))) as unknown as typeof fetch;
        await expect(safeFetch('https://rebind.example.com/', { resolve: async () => ['127.0.0.1'], fetch: f })).rejects.toMatchObject({ reason: 'private_dns' });
        expect(calls).toBe(0);
    });

    it('caps redirect hops and response size', async () => {
        const loop = (async () => page(302, { location: '/again' })) as unknown as typeof fetch;
        await expect(safeFetch('https://pod.example.com/', { resolve: publicDns, fetch: loop, maxRedirects: 3 })).rejects.toMatchObject({ reason: 'redirects' });
        const big = (async () => page(200, {}, 'x'.repeat(5000))) as unknown as typeof fetch;
        const r = await safeFetch('https://pod.example.com/', { resolve: publicDns, fetch: big, maxBytes: 1000 });
        expect([r.body.length, r.truncated]).toEqual([1000, true]);
    });

    it('turns timeouts and network failures into safe, generic errors', async () => {
        const hang = ((_u: string, init?: RequestInit) =>
            new Promise((_r, rej) => init!.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
        await expect(safeFetch('https://slow.example.com/', { resolve: publicDns, fetch: hang, timeoutMs: 20 })).rejects.toMatchObject({ reason: 'network', message: 'The site did not respond in time.' });
    });
});
