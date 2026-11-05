/**
 * SSRF guard for SEO fetchers (Phase 17J). Pure TypeScript, no runtime deps, so the same
 * module runs in tests, Supabase Edge Functions (Deno) and the future worker.
 *
 * Design adapted from claude-seo scripts/url_safety.py (MIT, (c) 2026 agricidaniel, 6be93f4):
 * validate the URL, resolve DNS and require EVERY address to be public, and re-validate
 * every redirect hop instead of letting the HTTP client follow redirects.
 * See docs/development/SEO_EXECUTION_SECURITY.md for residual risks (DNS rebinding).
 */

export class UrlSafetyError extends Error {
    constructor(
        public readonly reason: string,
        message: string,
    ) {
        super(message);
        this.name = 'UrlSafetyError';
    }
}

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data', 'kubernetes.default']);
/**
 * Internal names, plus the reserved test TLDs of RFC 2606 / RFC 6761 (.example, .test, .invalid):
 * demo and fixture websites use them and must never be sent to a crawler, verifier or API tool.
 */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.svc', '.cluster.local', '.example', '.test', '.invalid'];
const RESERVED_TLDS = new Set(['example', 'test', 'invalid']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** [network, prefixLength] ranges that are not publicly routable. */
const V4_BLOCKED: Array<[number, number]> = [
    [ip4('0.0.0.0'), 8], [ip4('10.0.0.0'), 8], [ip4('100.64.0.0'), 10], [ip4('127.0.0.0'), 8],
    [ip4('169.254.0.0'), 16], [ip4('172.16.0.0'), 12], [ip4('192.0.0.0'), 24], [ip4('192.0.2.0'), 24],
    [ip4('192.88.99.0'), 24], [ip4('192.168.0.0'), 16], [ip4('198.18.0.0'), 15], [ip4('198.51.100.0'), 24],
    [ip4('203.0.113.0'), 24], [ip4('224.0.0.0'), 4], [ip4('240.0.0.0'), 4],
];

function ip4(s: string): number {
    return s.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function isIPv4(s: string): boolean {
    return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((o) => Number(o) <= 255);
}

export function isPublicIPv4(ip: string): boolean {
    if (!isIPv4(ip)) return false;
    const n = ip4(ip);
    return !V4_BLOCKED.some(([net, len]) => (len === 0 ? true : (n >>> (32 - len)) === (net >>> (32 - len))));
}

/** Expands an IPv6 literal (no brackets) to 8 hextets, or null if invalid. Handles embedded IPv4. */
function expandIPv6(ip: string): number[] | null {
    let s = ip.toLowerCase().split('%')[0]!;
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (v4) {
        if (!isIPv4(v4[1]!)) return null;
        const n = ip4(v4[1]!);
        s = s.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
    }
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
    const parts = [...head, ...Array(fill).fill('0'), ...tail];
    if (parts.length !== 8 || !parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
    return parts.map((p) => parseInt(p, 16));
}

export function isPublicIPv6(ip: string): boolean {
    const h = expandIPv6(ip);
    if (!h) return false;
    if (h.every((x) => x === 0)) return false; // ::
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return false; // ::1
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4.
    if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
        return isPublicIPv4(`${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`);
    }
    if (h[0] === 0x64 && h[1] === 0xff9b) return isPublicIPv4(`${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`); // NAT64
    if ((h[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((h[0]! & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((h[0]! & 0xff00) === 0xff00) return false; // multicast
    if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // documentation
    return (h[0]! & 0xe000) === 0x2000; // only global unicast 2000::/3
}

export function isPublicIp(ip: string): boolean {
    return isIPv4(ip) ? isPublicIPv4(ip) : isPublicIPv6(ip);
}

/**
 * Validates a user/agent-supplied URL WITHOUT network access. WHATWG URL parsing first
 * normalises obfuscated hosts (e.g. http://2130706433, http://0x7f.1, http://127.1), so
 * those resolve to 127.0.0.1 here and are rejected.
 */
export function validatePublicUrl(input: string): URL {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new UrlSafetyError('invalid', 'Not a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UrlSafetyError('scheme', 'Only http and https URLs can be audited.');
    if (url.username || url.password) throw new UrlSafetyError('credentials', 'URLs with embedded credentials are not allowed.');
    if (!ALLOWED_PORTS.has(url.port)) throw new UrlSafetyError('port', 'Only the default web ports (80, 443) are allowed.');
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host) throw new UrlSafetyError('host', 'URL has no host.');
    const bare = host.startsWith('[') ? host.slice(1, -1) : host;
    if (isIPv4(bare) || bare.includes(':')) {
        if (!isPublicIp(bare)) throw new UrlSafetyError('private_ip', 'Private, loopback and reserved addresses cannot be audited.');
    } else {
        if (RESERVED_TLDS.has(host) || /.(example|test|invalid)$/.test(host)) throw new UrlSafetyError('reserved_domain', 'Reserved example/test domains (demo records) are never fetched.');
        if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new UrlSafetyError('blocked_host', 'Internal hostnames cannot be audited.');
        if (!host.includes('.')) throw new UrlSafetyError('host', 'Use a fully qualified public domain name.');
    }
    url.hash = '';
    return url;
}

/** After DNS resolution: every A/AAAA answer must be public (one private answer = reject). */
export function assertResolvedPublic(host: string, addresses: string[]): void {
    if (addresses.length === 0) throw new UrlSafetyError('dns', `${host} did not resolve.`);
    const bad = addresses.filter((a) => !isPublicIp(a));
    if (bad.length) throw new UrlSafetyError('private_dns', `${host} resolves to a non-public address.`);
}

export type Resolver = (host: string) => Promise<string[]>;

export interface SafeFetchOptions {
    resolve: Resolver;
    fetch: typeof fetch;
    maxRedirects?: number;
    timeoutMs?: number;
    maxBytes?: number;
    userAgent?: string;
}

export interface SafeFetchResult {
    finalUrl: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    truncated: boolean;
    /** Every hop with its status: the evidence for redirect findings. */
    chain: Array<{ url: string; status: number }>;
}

/**
 * Fetch with SSRF checks on every hop, manual redirects, timeout and a byte cap.
 * The response body is UNTRUSTED content: callers must never treat it as instructions.
 */
export async function safeFetch(input: string, o: SafeFetchOptions): Promise<SafeFetchResult> {
    const maxRedirects = o.maxRedirects ?? 5;
    const maxBytes = o.maxBytes ?? 2_000_000;
    const chain: SafeFetchResult['chain'] = [];
    let url = validatePublicUrl(input);
    for (let hop = 0; ; hop++) {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (!isIPv4(host) && !host.includes(':')) assertResolvedPublic(host, await o.resolve(host));
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 15_000);
        let res: Response;
        try {
            res = await o.fetch(url.toString(), {
                redirect: 'manual',
                signal: ctrl.signal,
                headers: { 'user-agent': o.userAgent ?? 'ULTRON-B-SEO-Auditor/0.1 (+respectful; low rate)', accept: 'text/html,application/xml,text/plain;q=0.9,*/*;q=0.1' },
            });
        } catch (e) {
            throw new UrlSafetyError('network', (e as Error).name === 'AbortError' ? 'The site did not respond in time.' : 'The site could not be reached.');
        } finally {
            clearTimeout(timer);
        }
        chain.push({ url: url.toString(), status: res.status });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            if (hop >= maxRedirects) throw new UrlSafetyError('redirects', `More than ${maxRedirects} redirects.`);
            url = validatePublicUrl(new URL(location, url).toString());
            continue;
        }
        const { text, truncated } = await readCapped(res, maxBytes);
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => (headers[k] = v));
        return { finalUrl: url.toString(), status: res.status, headers, body: text, truncated, chain };
    }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    if (!res.body) return { text: '', truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > maxBytes) {
            chunks.push(value.slice(0, maxBytes - size));
            truncated = true;
            await reader.cancel();
            break;
        }
        chunks.push(value);
        size += value.byteLength;
    }
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) {
        all.set(c, off);
        off += c.byteLength;
    }
    return { text: new TextDecoder().decode(all), truncated };
}
