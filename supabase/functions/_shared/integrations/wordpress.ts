/**
 * WordPress REST API connector (read-only). Reusable for every WordPress website in the platform.
 *
 * - Talks only to the website's own host, through safeFetch (SSRF checks on every hop, manual
 *   redirects, byte and time caps). The Authorization header is dropped on cross-origin redirects.
 * - Public data needs no credentials. Authenticated reads use a WordPress Application Password
 *   (HTTPS only) supplied by the server from encrypted storage; never the main WordPress password.
 * - Never writes to WordPress: every request is a GET.
 * - Responses are untrusted data. Titles and excerpts are stored as plain text, never as instructions.
 */
import { safeFetch, UrlSafetyError } from '../urlSafety.ts';
import { IntegrationError, sameSite, type HttpDeps } from './types.ts';

export interface WpCredentials {
    username: string;
    applicationPassword: string;
}

export type WpContentType = 'page' | 'post' | 'category' | 'tag' | 'media';

export interface WpContentRecord {
    externalId: number;
    type: WpContentType;
    url: string;
    slug: string;
    title: string;
    status: string | null;
    publishedAt: string | null;
    modifiedAt: string | null;
    authorId: number | null;
    parentId: number | null;
    featuredMediaId: number | null;
    categoryIds: number[];
    tagIds: number[];
    excerpt: string | null;
    altText: string | null;
    mimeType: string | null;
    count: number | null;
    /** Changes when title, link, excerpt, status or modified date change (duplicate-free re-syncs). */
    fingerprint: string;
}

export interface WpDiscovery {
    siteName: string;
    homeUrl: string;
    restRoot: string;
    namespaces: string[];
    seoPlugin: 'rank_math' | 'yoast' | 'aioseo' | 'seopress' | null;
    pageBuilder: 'elementor' | null;
    siteKit: boolean;
    applicationPasswordsAvailable: boolean;
    counts: { pages: number | null; posts: number | null; media: number | null; categories: number | null; tags: number | null };
    /** Media counts may be visible while the list itself is empty without authentication. */
    notes: string[];
    discoveredAt: string;
}

export interface WpConnectionTest {
    userId: number;
    name: string;
    roles: string[];
    canEditPosts: boolean;
    warnings: string[];
    testedAt: string;
}

const LIMITS = { maxRedirects: 3, timeoutMs: 20_000, maxBytes: 5_000_000 };
const UA = 'ULTRON-B-WordPress-Connector/0.1 (read-only)';

const REST_BASE: Record<WpContentType, string> = { page: 'pages', post: 'posts', category: 'categories', tag: 'tags', media: 'media' };
const FIELDS: Record<WpContentType, string> = {
    page: 'id,link,slug,title,status,date_gmt,modified_gmt,author,parent,featured_media,excerpt',
    post: 'id,link,slug,title,status,date_gmt,modified_gmt,author,featured_media,categories,tags,excerpt',
    category: 'id,link,slug,name,count,parent',
    tag: 'id,link,slug,name,count',
    media: 'id,link,slug,title,date_gmt,modified_gmt,author,source_url,alt_text,mime_type,post',
};

const decode = (s: string) => s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
const plain = (html: unknown, max = 300) => {
    if (typeof html !== 'string') return null;
    const t = decode(html.replace(/<[^>]*>/g, ' '));
    return t ? (t.length > max ? t.slice(0, max - 1) + '…' : t) : null;
};
const isoGmt = (v: unknown) => (typeof v === 'string' && v ? (v.endsWith('Z') ? v : `${v}Z`) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

async function fingerprint(parts: unknown[]): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
    return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function authHeader(site: URL, creds: WpCredentials | null): Record<string, string> {
    if (!creds) return {};
    if (site.protocol !== 'https:') throw new IntegrationError('blocked_url', 'Application Passwords are only sent over HTTPS.');
    const user = creds.username.trim();
    const pass = creds.applicationPassword.replace(/\s+/g, '');
    if (!user || pass.length < 16) throw new IntegrationError('auth_failed', 'Enter the WordPress username and a full Application Password.');
    const bytes = new TextEncoder().encode(`${user}:${pass}`);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return { authorization: `Basic ${btoa(bin)}` };
}

interface WpResponse { status: number; headers: Record<string, string>; json: unknown }

/** One GET to the site's REST API with error classification. `path` starts with '/'. */
export async function wpGet(site: URL, path: string, creds: WpCredentials | null, deps: HttpDeps): Promise<WpResponse> {
    const url = new URL(`/wp-json${path}`, site.origin);
    let r;
    try {
        r = await safeFetch(url.toString(), { ...deps, ...LIMITS, userAgent: UA, accept: 'application/json', headers: authHeader(site, creds) });
    } catch (e) {
        if (e instanceof UrlSafetyError) throw new IntegrationError(e.reason === 'network' ? 'network' : 'blocked_url', e.message);
        throw e;
    }
    if (!sameSite(new URL(r.finalUrl).hostname, site.hostname)) throw new IntegrationError('site_mismatch', 'The WordPress API redirected to a different website.');
    const retryAfter = Number(r.headers['retry-after']);
    if (r.status === 429) throw new IntegrationError('rate_limited', 'WordPress is rate limiting requests. Try again later.', Number.isFinite(retryAfter) ? retryAfter : null);
    if (r.status === 401) throw new IntegrationError(creds ? 'auth_failed' : 'permission_denied', creds ? 'WordPress rejected the Application Password.' : 'This WordPress endpoint requires authentication.');
    if (r.status === 403) throw new IntegrationError('permission_denied', 'The WordPress user does not have permission for this request.');
    if (r.status === 404) throw new IntegrationError('not_found', 'The WordPress REST API endpoint was not found.');
    if (r.status >= 500) throw new IntegrationError('provider_error', `WordPress returned HTTP ${r.status}.`);
    if (r.truncated) throw new IntegrationError('limit_exceeded', 'The WordPress response exceeded the size limit.');
    const ct = r.headers['content-type'] ?? '';
    let json: unknown;
    try {
        json = JSON.parse(r.body);
    } catch {
        throw new IntegrationError(ct.includes('html') ? 'not_wordpress' : 'invalid_response', 'The response is not WordPress REST API JSON.');
    }
    if (r.status >= 400) {
        const code = (json as { code?: string })?.code ?? '';
        if (/forbidden|cannot|invalid_param/i.test(code)) throw new IntegrationError('permission_denied', 'WordPress refused this request for the connected user.');
        throw new IntegrationError('invalid_response', `WordPress returned HTTP ${r.status}.`);
    }
    return { status: r.status, headers: r.headers, json };
}

const total = (h: Record<string, string>) => {
    const n = Number(h['x-wp-total']);
    return Number.isFinite(n) && h['x-wp-total'] !== undefined ? n : null;
};

export async function discoverWordPress(siteUrl: string, deps: HttpDeps): Promise<WpDiscovery> {
    const site = new URL(siteUrl);
    const root = await wpGet(site, '/', null, deps);
    const j = root.json as Record<string, unknown>;
    if (!j || typeof j !== 'object' || !Array.isArray(j.namespaces) || !j.namespaces.includes('wp/v2')) {
        throw new IntegrationError('not_wordpress', 'No WordPress REST API (wp/v2) was found on this website.');
    }
    const home = typeof j.home === 'string' ? j.home : typeof j.url === 'string' ? j.url : '';
    if (!home || !sameSite(new URL(home).hostname, site.hostname)) {
        throw new IntegrationError('site_mismatch', 'The WordPress site reports a different home URL than this website record.');
    }
    const ns = (j.namespaces as unknown[]).filter((x): x is string => typeof x === 'string');
    const has = (p: string) => ns.some((n) => n === p || n.startsWith(`${p}/`));
    const count = async (type: WpContentType) => {
        try {
            const r = await wpGet(site, `/wp/v2/${REST_BASE[type]}?per_page=1&_fields=id`, null, deps);
            return { n: total(r.headers), listed: Array.isArray(r.json) ? r.json.length : 0 };
        } catch (e) {
            if (e instanceof IntegrationError && (e.category === 'permission_denied' || e.category === 'not_found')) return { n: null, listed: 0 };
            throw e;
        }
    };
    const [pages, posts, media, categories, tags] = [await count('page'), await count('post'), await count('media'), await count('category'), await count('tag')];
    const notes: string[] = [];
    if ((media.n ?? 0) > 0 && media.listed === 0) notes.push('Media items are counted but not listed without authentication.');
    const auth = (j.authentication && typeof j.authentication === 'object') ? Object.keys(j.authentication as object) : [];
    return {
        siteName: plain(j.name, 200) ?? '',
        homeUrl: home,
        restRoot: new URL('/wp-json/', site.origin).toString(),
        namespaces: ns.slice(0, 80),
        seoPlugin: has('rankmath/v1') ? 'rank_math' : has('yoast/v1') ? 'yoast' : has('aioseo/v1') ? 'aioseo' : has('seopress/v1') ? 'seopress' : null,
        pageBuilder: has('elementor/v1') ? 'elementor' : null,
        siteKit: has('google-site-kit/v1'),
        applicationPasswordsAvailable: auth.includes('application-passwords'),
        counts: { pages: pages.n, posts: posts.n, media: media.n, categories: categories.n, tags: tags.n },
        notes,
        discoveredAt: (deps.now?.() ?? new Date()).toISOString(),
    };
}

/** Verifies an Application Password with GET /wp/v2/users/me (no writes). */
export async function testWordPressCredentials(siteUrl: string, creds: WpCredentials, deps: HttpDeps): Promise<WpConnectionTest> {
    const site = new URL(siteUrl);
    const r = await wpGet(site, '/wp/v2/users/me?context=edit&_fields=id,name,roles,capabilities', creds, deps);
    const u = r.json as { id?: number; name?: string; roles?: unknown; capabilities?: Record<string, boolean> };
    if (typeof u?.id !== 'number') throw new IntegrationError('invalid_response', 'WordPress did not return the connected user.');
    const roles = Array.isArray(u.roles) ? u.roles.filter((x): x is string => typeof x === 'string') : [];
    const caps = u.capabilities ?? {};
    const warnings: string[] = [];
    if (roles.includes('administrator') || caps.manage_options) warnings.push('This WordPress user is an administrator. A dedicated user with fewer capabilities is safer for a read-only integration.');
    return { userId: u.id, name: plain(u.name, 120) ?? '', roles, canEditPosts: !!caps.edit_posts, warnings, testedAt: (deps.now?.() ?? new Date()).toISOString() };
}

async function normalize(type: WpContentType, raw: Record<string, unknown>): Promise<WpContentRecord | null> {
    const id = num(raw.id);
    if (id === null) return null;
    const title = type === 'category' || type === 'tag' ? plain(raw.name, 300) : plain((raw.title as { rendered?: string })?.rendered, 300);
    const excerpt = plain((raw.excerpt as { rendered?: string })?.rendered, 300);
    const url = type === 'media' && typeof raw.source_url === 'string' ? raw.source_url : typeof raw.link === 'string' ? raw.link : '';
    const rec: Omit<WpContentRecord, 'fingerprint'> = {
        externalId: id,
        type,
        url,
        slug: typeof raw.slug === 'string' ? raw.slug : '',
        title: title ?? '',
        status: typeof raw.status === 'string' ? raw.status : type === 'page' || type === 'post' ? 'publish' : null,
        publishedAt: isoGmt(raw.date_gmt),
        modifiedAt: isoGmt(raw.modified_gmt),
        authorId: num(raw.author),
        parentId: num(raw.parent) || null,
        featuredMediaId: num(raw.featured_media) || null,
        categoryIds: ids(raw.categories),
        tagIds: ids(raw.tags),
        excerpt,
        altText: type === 'media' ? (typeof raw.alt_text === 'string' ? raw.alt_text : '') : null,
        mimeType: typeof raw.mime_type === 'string' ? raw.mime_type : null,
        count: num(raw.count),
    };
    return { ...rec, fingerprint: await fingerprint([rec.url, rec.title, rec.excerpt, rec.status, rec.modifiedAt, rec.altText, rec.count]) };
}

export interface ListOptions {
    creds?: WpCredentials | null;
    maxItems?: number;
    perPage?: number;
    signal?: { cancelled: boolean };
}

/** Lists one content type with pagination (X-WP-TotalPages), de-duplicated by WordPress id. */
export async function listWordPressContent(siteUrl: string, type: WpContentType, deps: HttpDeps, o: ListOptions = {}): Promise<{ records: WpContentRecord[]; total: number | null; truncated: boolean }> {
    const site = new URL(siteUrl);
    const perPage = Math.min(Math.max(o.perPage ?? 100, 1), 100);
    const maxItems = Math.min(o.maxItems ?? 2000, 10_000);
    const status = o.creds && (type === 'page' || type === 'post') ? '&status=publish,future,draft,pending,private' : '';
    const seen = new Map<number, WpContentRecord>();
    let totalItems: number | null = null;
    for (let page = 1; ; page++) {
        if (o.signal?.cancelled) throw new IntegrationError('cancelled', 'The sync was cancelled.');
        const r = await wpGet(site, `/wp/v2/${REST_BASE[type]}?per_page=${perPage}&page=${page}&orderby=id&order=asc&_fields=${FIELDS[type]}${status}`, o.creds ?? null, deps);
        if (!Array.isArray(r.json)) throw new IntegrationError('invalid_response', `WordPress returned an unexpected ${type} list.`);
        totalItems ??= total(r.headers);
        for (const raw of r.json) {
            const rec = raw && typeof raw === 'object' ? await normalize(type, raw as Record<string, unknown>) : null;
            if (rec && !seen.has(rec.externalId)) seen.set(rec.externalId, rec);
            if (seen.size >= maxItems) return { records: [...seen.values()], total: totalItems, truncated: true };
        }
        const pages = Number(r.headers['x-wp-totalpages']);
        if (r.json.length < perPage || (Number.isFinite(pages) && page >= pages)) break;
        if (page >= 200) return { records: [...seen.values()], total: totalItems, truncated: true };
    }
    return { records: [...seen.values()], total: totalItems, truncated: false };
}
