/**
 * Executable SEO skills (provider-independent). Methods adapted from claude-seo
 * (MIT, 6be93f4: seo-page, seo-technical, seo-sitemap, seo-geo). Every fetch goes through
 * safeFetch (SSRF-checked, redirect hops re-validated, byte and time caps) and only to a
 * host that belongs to one of the brand's websites. Page content is untrusted data:
 * results contain extracted facts and short excerpts, never instructions.
 *
 * Findings are heuristics with evidence. Nothing here produces search volumes, rankings
 * or other third-party metrics.
 */
import { safeFetch, UrlSafetyError, type Resolver, type SafeFetchResult } from '../urlSafety.ts';

export interface FetchDeps {
    resolve: Resolver;
    fetch: typeof fetch;
}

export interface Finding {
    id: string;
    severity: 'high' | 'medium' | 'low' | 'info';
    message: string;
    evidence: string;
}

export interface SkillResult {
    skillId: string;
    url: string;
    finalUrl: string | null;
    status: number | null;
    fetchedAt: string;
    data: Record<string, unknown>;
    findings: Finding[];
    truncated: boolean;
    redirectChain: Array<{ url: string; status: number }>;
}

/** The target must be one of the brand's own hosts (exact, or the www/apex twin). */
export function assertAuthorizedHost(url: string, allowedHosts: string[]): URL {
    let u: URL;
    try { u = new URL(url); } catch { throw new UrlSafetyError('invalid_url', 'Not a valid URL.'); }
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const bare = (h: string) => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!allowedHosts.some((h) => bare(h) === bare(host))) {
        throw new UrlSafetyError('not_authorized', `${host} is not one of this brand's websites. Add it under Websites first.`);
    }
    return u;
}

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const stripTags = (s: string) => decode(s.replace(/<[^>]*>/g, ' '));

export function parseAttributes(tag: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag))) out[m[1]!.toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
    return out;
}

/** Extract SEO-relevant facts from HTML without a DOM (works in Deno and Node). */
export function extractPageFacts(html: string) {
    const head = html.slice(0, 500_000);
    const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
    const meta = (key: string) => metas.find((a) => (a.name ?? a.property ?? '').toLowerCase() === key)?.content ?? null;
    const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
    const canonical = links.find((a) => (a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.href ?? null;
    const h1 = [...head.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clip(stripTags(m[1]!), 120));
    const imgs = [...head.matchAll(/<img\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
    const types: string[] = [];
    let invalidJsonLd = 0;
    for (const m of head.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const collect = (v: unknown): void => {
                if (Array.isArray(v)) return v.forEach(collect);
                if (v && typeof v === 'object') {
                    const o = v as Record<string, unknown>;
                    const t = o['@type'];
                    if (typeof t === 'string') types.push(t);
                    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.push(x));
                    if (o['@graph']) collect(o['@graph']);
                }
            };
            collect(JSON.parse(m[1]!));
        } catch { invalidJsonLd++; }
    }
    const lang = parseAttributes(head.match(/<html\b[^>]*>/i)?.[0] ?? '').lang ?? null;
    return {
        title: title ? clip(decode(title), 200) : null,
        metaDescription: meta('description') ? clip(meta('description')!, 320) : null,
        robotsMeta: meta('robots'),
        canonical,
        lang,
        h1,
        openGraph: { title: meta('og:title'), description: meta('og:description') ? clip(meta('og:description')!, 200) : null, image: meta('og:image') },
        images: { total: imgs.length, missingAlt: imgs.filter((a) => !('alt' in a)).length },
        structuredDataTypes: [...new Set(types)].slice(0, 30),
        invalidJsonLdBlocks: invalidJsonLd,
    };
}

function base(skillId: string, url: string, r: SafeFetchResult | null): Omit<SkillResult, 'data' | 'findings'> {
    return { skillId, url, finalUrl: r?.finalUrl ?? null, status: r?.status ?? null, fetchedAt: new Date().toISOString(), truncated: r?.truncated ?? false, redirectChain: r?.chain ?? [] };
}

const FETCH_LIMITS = { maxRedirects: 5, timeoutMs: 15_000, maxBytes: 2_000_000 };

export async function pageMetadataSkill(url: string, allowedHosts: string[], deps: FetchDeps): Promise<SkillResult> {
    assertAuthorizedHost(url, allowedHosts);
    const r = await safeFetch(url, { ...deps, ...FETCH_LIMITS });
    const f = extractPageFacts(r.body);
    const findings: Finding[] = [];
    const xRobots = r.headers['x-robots-tag'] ?? null;
    if (r.status >= 400) findings.push({ id: 'http_error', severity: 'high', message: `The page returned HTTP ${r.status}.`, evidence: `GET ${r.finalUrl} → ${r.status}` });
    if (r.chain.length > 2) findings.push({ id: 'redirect_chain', severity: 'medium', message: `${r.chain.length - 1} redirects before the final page.`, evidence: r.chain.map((h) => `${h.status} ${h.url}`).join(' → ') });
    if (!f.title) findings.push({ id: 'title_missing', severity: 'high', message: 'No <title> element.', evidence: 'No <title> found in the HTML.' });
    else if (f.title.length < 30 || f.title.length > 60) findings.push({ id: 'title_length', severity: 'low', message: `Title is ${f.title.length} characters (common guideline: 30–60).`, evidence: f.title });
    if (!f.metaDescription) findings.push({ id: 'meta_description_missing', severity: 'medium', message: 'No meta description.', evidence: 'No <meta name="description">.' });
    else if (f.metaDescription.length > 160) findings.push({ id: 'meta_description_length', severity: 'low', message: `Meta description is ${f.metaDescription.length} characters and may be truncated in results.`, evidence: clip(f.metaDescription) });
    if (!f.canonical) findings.push({ id: 'canonical_missing', severity: 'low', message: 'No canonical link.', evidence: 'No <link rel="canonical">.' });
    const noindex = /noindex/i.test(f.robotsMeta ?? '') || /noindex/i.test(xRobots ?? '');
    if (noindex) findings.push({ id: 'noindex', severity: 'high', message: 'The page asks search engines not to index it.', evidence: `robots meta: ${f.robotsMeta ?? '-'}; X-Robots-Tag: ${xRobots ?? '-'}` });
    if (f.h1.length !== 1) findings.push({ id: 'h1_count', severity: 'low', message: `${f.h1.length} <h1> elements (one is typical).`, evidence: f.h1.join(' | ') || 'none' });
    if (f.images.missingAlt) findings.push({ id: 'img_alt', severity: 'low', message: `${f.images.missingAlt} of ${f.images.total} images have no alt attribute.`, evidence: 'Counted <img> tags without alt.' });
    if (f.invalidJsonLdBlocks) findings.push({ id: 'jsonld_invalid', severity: 'medium', message: `${f.invalidJsonLdBlocks} JSON-LD block(s) are not valid JSON.`, evidence: 'JSON.parse failed.' });
    if (r.truncated) findings.push({ id: 'truncated', severity: 'info', message: 'The page exceeded the 2 MB cap; analysis used the first part only.', evidence: 'Body truncated.' });
    return { ...base('tech.page_audit', url, r), data: { ...f, xRobotsTag: xRobots, contentType: r.headers['content-type'] ?? null }, findings };
}

export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export function parseRobots(text: string) {
    const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
    const sitemaps: string[] = [];
    let current: (typeof groups)[number] | null = null;
    let lastWasAgent = false;
    for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
        const line = raw.replace(/#.*$/, '').trim();
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1]!.toLowerCase();
        const value = m[2]!.trim();
        if (key === 'user-agent') {
            if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (key === 'sitemap') sitemaps.push(value);
        else if (current && key === 'allow') current.allow.push(value);
        else if (current && key === 'disallow') current.disallow.push(value);
    }
    /** Root access for an agent: the most specific group (exact name, else '*'); '/' disallowed and not re-allowed = blocked. */
    const rootBlocked = (agent: string) => {
        const g = groups.find((x) => x.agents.includes(agent.toLowerCase())) ?? groups.find((x) => x.agents.includes('*'));
        if (!g) return false;
        return g.disallow.includes('/') && !g.allow.includes('/');
    };
    return { groups: groups.length, sitemaps, rootBlocked };
}

export async function robotsSkill(url: string, allowedHosts: string[], deps: FetchDeps): Promise<SkillResult> {
    const u = assertAuthorizedHost(url, allowedHosts);
    const target = `${u.protocol}//${u.host}/robots.txt`;
    const r = await safeFetch(target, { ...deps, ...FETCH_LIMITS, maxBytes: 500_000 });
    const findings: Finding[] = [];
    if (r.status === 404) {
        findings.push({ id: 'robots_missing', severity: 'low', message: 'No robots.txt (all crawlers allowed by default).', evidence: `GET ${target} → 404` });
        return { ...base('tech.robots', target, r), data: { exists: false }, findings };
    }
    if (r.status >= 400) findings.push({ id: 'robots_error', severity: 'medium', message: `robots.txt returned HTTP ${r.status}.`, evidence: `GET ${target} → ${r.status}` });
    const p = parseRobots(r.body);
    const ai = Object.fromEntries(AI_CRAWLERS.map((a) => [a, p.rootBlocked(a) ? 'blocked' : 'allowed']));
    if (p.rootBlocked('Googlebot')) findings.push({ id: 'googlebot_blocked', severity: 'high', message: 'Googlebot is disallowed from the whole site.', evidence: 'Disallow: / applies to Googlebot.' });
    if (!p.sitemaps.length) findings.push({ id: 'no_sitemap_directive', severity: 'low', message: 'robots.txt does not list a Sitemap.', evidence: 'No "Sitemap:" line.' });
    const blockedAi = AI_CRAWLERS.filter((a) => ai[a] === 'blocked');
    if (blockedAi.length) findings.push({ id: 'ai_crawlers_blocked', severity: 'info', message: `Blocked AI crawlers: ${blockedAi.join(', ')}. This may be intentional.`, evidence: 'Disallow: / for these user agents.' });
    return { ...base('tech.robots', target, r), data: { exists: true, groups: p.groups, sitemaps: p.sitemaps.slice(0, 20), aiCrawlers: ai }, findings };
}

export async function sitemapSkill(url: string, allowedHosts: string[], deps: FetchDeps): Promise<SkillResult> {
    const u = assertAuthorizedHost(url, allowedHosts);
    const target = u.pathname === '/' || !u.pathname ? `${u.protocol}//${u.host}/sitemap.xml` : u.toString();
    const r = await safeFetch(target, { ...deps, ...FETCH_LIMITS, maxBytes: 5_000_000 });
    const findings: Finding[] = [];
    if (r.status >= 400) {
        findings.push({ id: 'sitemap_unavailable', severity: 'medium', message: `Sitemap returned HTTP ${r.status}.`, evidence: `GET ${target} → ${r.status}` });
        return { ...base('tech.sitemap', target, r), data: { exists: false }, findings };
    }
    const isIndex = /<sitemapindex\b/i.test(r.body);
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]!));
    const lastmods = (r.body.match(/<lastmod>/gi) ?? []).length;
    if (!/<(urlset|sitemapindex)\b/i.test(r.body)) findings.push({ id: 'sitemap_format', severity: 'high', message: 'The response is not an XML sitemap (no <urlset> or <sitemapindex>).', evidence: clip(r.body.slice(0, 200)) });
    if (locs.length > 50_000) findings.push({ id: 'sitemap_too_large', severity: 'medium', message: `${locs.length} URLs exceed the 50,000 per-file limit.`, evidence: 'Counted <loc> entries.' });
    if (locs.length && !lastmods) findings.push({ id: 'no_lastmod', severity: 'low', message: 'No <lastmod> dates.', evidence: 'No <lastmod> elements.' });
    const offHost = locs.filter((l) => { try { return new URL(l).host !== u.host; } catch { return true; } }).length;
    if (offHost) findings.push({ id: 'off_host_urls', severity: 'medium', message: `${offHost} URLs point to another host.`, evidence: 'Compared <loc> hosts to the sitemap host.' });
    if (r.truncated) findings.push({ id: 'truncated', severity: 'info', message: 'The sitemap exceeded the size cap; counts are partial.', evidence: 'Body truncated.' });
    return { ...base('tech.sitemap', target, r), data: { exists: true, kind: isIndex ? 'index' : 'urlset', urls: locs.length, withLastmod: lastmods, sample: locs.slice(0, 10) }, findings };
}

export async function llmsTxtSkill(url: string, allowedHosts: string[], deps: FetchDeps): Promise<SkillResult> {
    const u = assertAuthorizedHost(url, allowedHosts);
    const target = `${u.protocol}//${u.host}/llms.txt`;
    const r = await safeFetch(target, { ...deps, ...FETCH_LIMITS, maxBytes: 500_000 });
    const exists = r.status === 200 && !/<html\b/i.test(r.body.slice(0, 500));
    const heading = exists ? r.body.match(/^#\s+(.+)$/m)?.[1] ?? null : null;
    const findings: Finding[] = exists
        ? (heading ? [] : [{ id: 'llms_no_heading', severity: 'low', message: 'llms.txt has no "# Title" heading.', evidence: clip(r.body.slice(0, 120)) }])
        : [{ id: 'llms_missing', severity: 'info', message: 'No /llms.txt file (optional, emerging convention).', evidence: `GET ${target} → ${r.status}` }];
    return { ...base('ai.llms_txt', target, r), data: { exists, heading: heading ? clip(heading, 120) : null, bytes: exists ? r.body.length : 0 }, findings };
}
