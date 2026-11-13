/**
 * Read-only technical SEO crawler (bounded). Reusable for every authorized website.
 *
 * Safety
 *  - Every request (and every redirect hop) goes through safeFetch: http/https only, default
 *    ports, no credentials in URLs, DNS answers must all be public (no localhost, private,
 *    link-local or cloud-metadata ranges), byte and time caps.
 *  - Only the website's own host (and its www/apex twin) is crawled; links elsewhere are counted,
 *    never fetched. Redirects off the site are recorded and not followed further.
 *  - robots.txt path rules are respected for user-agent '*' (and our own agent group).
 *  - HTML is parsed as text; scripts are never executed. Page text is untrusted data.
 *  - Bounded: maxPages, maxDepth, a wall-clock budget and cancellation. Large crawls belong to a
 *    durable job runner (see SEO_CRAWLER_ARCHITECTURE.md), not one Edge Function invocation.
 *
 * Findings separate measured observations from heuristics, never claim indexing status, and
 * carry evidence, severity, confidence, a recommendation and a suggested task.
 */
import { safeFetch, UrlSafetyError, type SafeFetchResult } from '../urlSafety.ts';
import { extractPageFacts, parseAttributes } from '../ai/seoTools.ts';
import { IntegrationError, sameSite, type HttpDeps } from './types.ts';

export const CRAWLER_AGENT = 'ULTRON-B-SEO-Crawler';
const UA = `${CRAWLER_AGENT}/0.1 (read-only; low rate)`;

export interface CrawlConfig {
    startUrl: string;
    /** Hosts of the website record (normally one). The www/apex twin is always allowed. */
    allowedHosts: string[];
    maxPages?: number;
    maxDepth?: number;
    timeoutMs?: number;
    crawlDelayMs?: number;
    budgetMs?: number;
    respectRobots?: boolean;
    useSitemaps?: boolean;
    /** Known inventory (e.g. WordPress pages/posts). Enables orphan-page candidates when complete. */
    inventoryUrls?: string[];
    inventoryComplete?: boolean;
    signal?: { cancelled: boolean };
}

export interface CrawledPage {
    url: string;
    finalUrl: string;
    depth: number;
    status: number;
    redirectChain: Array<{ url: string; status: number }>;
    contentType: string;
    title: string | null;
    metaDescription: string | null;
    canonical: string | null;
    robotsMeta: string | null;
    xRobotsTag: string | null;
    h1: string[];
    headings: Array<{ level: number; text: string }>;
    internalLinks: string[];
    externalLinks: number;
    images: number;
    imagesMissingAlt: number;
    structuredDataTypes: string[];
    invalidJsonLd: number;
    hasViewport: boolean;
    wordCount: number;
    contentHash: string | null;
    relNext: string | null;
    relPrev: string | null;
    truncated: boolean;
    error: string | null;
}

export interface CrawlFinding {
    checkId: string;
    kind: 'observed' | 'heuristic';
    severity: 'high' | 'medium' | 'low' | 'info';
    confidence: number;
    title: string;
    subjectUrl: string | null;
    evidence: Record<string, unknown>;
    recommendation: string;
    suggestedTask: { title: string; team: 'seo' | 'web'; priority: 'high' | 'medium' | 'low' } | null;
    fingerprint: string;
}

export interface CrawlResult {
    startUrl: string;
    pages: CrawledPage[];
    findings: CrawlFinding[];
    robots: { found: boolean; status: number | null; sitemaps: string[]; disallowedSkipped: number };
    sitemapUrls: number;
    stoppedBy: 'complete' | 'max_pages' | 'budget' | 'cancelled';
    startedAt: string;
    finishedAt: string;
}

const SKIP_EXT = /\.(?:jpe?g|png|gif|webp|svg|ico|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|eot|css|js|xml|json|txt|docx?|xlsx?|pptx?)$/i;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function sha(text: string, len = 16): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].slice(0, len).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Canonical form for de-duplication: no fragment, default port, sorted query, no trailing-slash ambiguity for root. */
export function normalizeUrl(raw: string, base?: string): string | null {
    let u: URL;
    try {
        u = new URL(raw, base);
    } catch {
        return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    const params = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid$|gclid$|_ga$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    return u.toString();
}

// ── robots.txt (path rules for '*' and our agent; longest match wins, Allow wins ties) ─────────
export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelay: number | null; sitemaps: string[] }

export function parseRobotsRules(text: string, agent = CRAWLER_AGENT): RobotsRules {
    const groups: Array<{ agents: string[]; allow: string[]; disallow: string[]; delay: number | null }> = [];
    const sitemaps: string[] = [];
    let cur: (typeof groups)[number] | null = null;
    let lastAgent = false;
    for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
        const line = raw.replace(/#.*$/, '').trim();
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1]!.toLowerCase();
        const value = m[2]!.trim();
        if (key === 'user-agent') {
            if (!cur || !lastAgent) groups.push((cur = { agents: [], allow: [], disallow: [], delay: null }));
            cur.agents.push(value.toLowerCase());
            lastAgent = true;
            continue;
        }
        lastAgent = false;
        if (key === 'sitemap') sitemaps.push(value);
        else if (cur && key === 'allow' && value) cur.allow.push(value);
        else if (cur && key === 'disallow' && value) cur.disallow.push(value);
        else if (cur && key === 'crawl-delay' && Number.isFinite(Number(value))) cur.delay = Number(value);
    }
    const g = groups.find((x) => x.agents.some((a) => a !== '*' && agent.toLowerCase().startsWith(a))) ?? groups.find((x) => x.agents.includes('*'));
    return { allow: g?.allow ?? [], disallow: g?.disallow ?? [], crawlDelay: g?.delay ?? null, sitemaps };
}

function ruleMatch(rule: string, path: string): number {
    const anchored = rule.endsWith('$');
    const body = anchored ? rule.slice(0, -1) : rule;
    const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
    return re.test(path) ? body.length : -1;
}

export function robotsAllows(rules: RobotsRules, pathWithQuery: string): boolean {
    const allow = Math.max(-1, ...rules.allow.map((r) => ruleMatch(r, pathWithQuery)));
    const disallow = Math.max(-1, ...rules.disallow.map((r) => ruleMatch(r, pathWithQuery)));
    return disallow < 0 || allow >= disallow;
}

// ── HTML extraction (text-based, no DOM, no script execution) ─────────────────────────────────
export function extractCrawlFacts(html: string, pageUrl: string, isInternal: (u: URL) => boolean) {
    const facts = extractPageFacts(html);
    const body = html.slice(0, 1_500_000);
    const internal = new Set<string>();
    let external = 0;
    for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
        const a = parseAttributes(m[0]);
        if (!a.href || /^(mailto:|tel:|javascript:|#)/i.test(a.href)) continue;
        if (/\bnofollow\b/i.test(a.rel ?? '') && !a.href) continue;
        const n = normalizeUrl(a.href, pageUrl);
        if (!n) continue;
        if (isInternal(new URL(n))) internal.add(n);
        else external++;
    }
    const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].slice(0, 200).map((m) => ({ level: Number(m[1]), text: clip(decode(m[2]!.replace(/<[^>]*>/g, ' ')), 120) }));
    const metas = [...body.slice(0, 300_000).matchAll(/<meta\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
    const links = [...body.slice(0, 300_000).matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
    const rel = (r: string) => links.find((l) => (l.rel ?? '').toLowerCase().split(/\s+/).includes(r))?.href ?? null;
    const text = decode(body.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' '));
    return {
        ...facts,
        headings,
        internalLinks: [...internal].slice(0, 2000),
        externalLinks: external,
        hasViewport: metas.some((m) => (m.name ?? '').toLowerCase() === 'viewport'),
        wordCount: text ? text.split(' ').length : 0,
        text,
        relNext: rel('next'),
        relPrev: rel('prev'),
    };
}

async function fetchSafe(url: string, deps: HttpDeps, o: { timeoutMs: number; maxBytes: number; accept?: string }): Promise<SafeFetchResult | { error: string }> {
    try {
        return await safeFetch(url, { ...deps, maxRedirects: 5, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes, userAgent: UA, accept: o.accept });
    } catch (e) {
        if (e instanceof UrlSafetyError) return { error: `${e.reason}: ${e.message}` };
        throw e;
    }
}

export function parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] } {
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1]!));
    return /<sitemapindex\b/i.test(xml) ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

export async function crawlWebsite(cfg: CrawlConfig, deps: HttpDeps): Promise<CrawlResult> {
    const now = () => deps.now?.() ?? new Date();
    const startedAt = now();
    const maxPages = Math.min(Math.max(cfg.maxPages ?? 50, 1), 500);
    const maxDepth = Math.min(Math.max(cfg.maxDepth ?? 3, 0), 10);
    const timeoutMs = cfg.timeoutMs ?? 15_000;
    const budgetMs = cfg.budgetMs ?? 110_000;
    const start = normalizeUrl(cfg.startUrl);
    if (!start) throw new IntegrationError('blocked_url', 'The start URL is not valid.');
    const startHost = new URL(start).hostname;
    if (!cfg.allowedHosts.some((h) => sameSite(h, startHost))) throw new IntegrationError('blocked_url', 'The start URL is not one of this website’s hosts.');
    const isInternal = (u: URL) => cfg.allowedHosts.some((h) => sameSite(h, u.hostname));
    const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

    // robots.txt
    const origin = new URL(start).origin;
    let rules: RobotsRules = { allow: [], disallow: [], crawlDelay: null, sitemaps: [] };
    const robotsRes = await fetchSafe(`${origin}/robots.txt`, deps, { timeoutMs, maxBytes: 500_000, accept: 'text/plain' });
    const robotsFound = !('error' in robotsRes) && robotsRes.status === 200;
    if (robotsFound) rules = parseRobotsRules((robotsRes as SafeFetchResult).body);
    const respect = cfg.respectRobots !== false;
    const delay = Math.min(Math.max(cfg.crawlDelayMs ?? 250, (rules.crawlDelay ?? 0) * 1000), 5000);

    // Sitemaps (bounded): seeds for depth 1 and the "listed in sitemap" signal.
    const sitemapUrls = new Set<string>();
    if (cfg.useSitemaps !== false) {
        const queue = rules.sitemaps.length ? [...rules.sitemaps] : [`${origin}/sitemap.xml`];
        for (let i = 0; i < queue.length && i < 12; i++) {
            const sm = normalizeUrl(queue[i]!);
            if (!sm || !isInternal(new URL(sm))) continue;
            const r = await fetchSafe(sm, deps, { timeoutMs, maxBytes: 5_000_000, accept: 'application/xml,text/xml' });
            if ('error' in r || r.status !== 200) continue;
            const p = parseSitemapXml(r.body);
            queue.push(...p.sitemaps.slice(0, 20));
            for (const u of p.urls) {
                const n = normalizeUrl(u);
                if (n && isInternal(new URL(n)) && sitemapUrls.size < 5000) sitemapUrls.add(n);
            }
        }
    }

    const pages: CrawledPage[] = [];
    const seen = new Set<string>([start]);
    const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
    for (const u of sitemapUrls) if (!seen.has(u) && seen.size < maxPages * 3) { seen.add(u); queue.push({ url: u, depth: 1 }); }
    let disallowedSkipped = 0;
    let stoppedBy: CrawlResult['stoppedBy'] = 'complete';

    while (queue.length) {
        if (cfg.signal?.cancelled) { stoppedBy = 'cancelled'; break; }
        if (pages.length >= maxPages) { stoppedBy = 'max_pages'; break; }
        if (now().getTime() - startedAt.getTime() > budgetMs) { stoppedBy = 'budget'; break; }
        const { url, depth } = queue.shift()!;
        const u = new URL(url);
        if (SKIP_EXT.test(u.pathname)) continue;
        if (respect && !robotsAllows(rules, u.pathname + u.search)) { disallowedSkipped++; continue; }
        if (pages.length) await sleep(delay);
        const r = await fetchSafe(url, deps, { timeoutMs, maxBytes: 3_000_000, accept: 'text/html,application/xhtml+xml' });
        if ('error' in r) {
            pages.push(emptyPage(url, depth, 0, [], r.error));
            continue;
        }
        const ct = r.headers['content-type'] ?? '';
        const final = new URL(r.finalUrl);
        if (!isInternal(final)) {
            pages.push({ ...emptyPage(url, depth, r.status, r.chain, 'Redirected to another website; not followed.'), finalUrl: r.finalUrl });
            continue;
        }
        if (!/html/i.test(ct) || r.status >= 400) {
            pages.push({ ...emptyPage(url, depth, r.status, r.chain, null), finalUrl: r.finalUrl, contentType: ct });
            continue;
        }
        const f = extractCrawlFacts(r.body, r.finalUrl, isInternal);
        pages.push({
            url, finalUrl: r.finalUrl, depth, status: r.status, redirectChain: r.chain, contentType: ct,
            title: f.title, metaDescription: f.metaDescription, canonical: f.canonical, robotsMeta: f.robotsMeta, xRobotsTag: r.headers['x-robots-tag'] ?? null,
            h1: f.h1, headings: f.headings, internalLinks: f.internalLinks, externalLinks: f.externalLinks,
            images: f.images.total, imagesMissingAlt: f.images.missingAlt, structuredDataTypes: f.structuredDataTypes, invalidJsonLd: f.invalidJsonLdBlocks,
            hasViewport: f.hasViewport, wordCount: f.wordCount, contentHash: f.text.length > 200 ? await sha(f.text) : null,
            relNext: f.relNext, relPrev: f.relPrev, truncated: r.truncated, error: null,
        });
        if (depth < maxDepth) {
            for (const link of f.internalLinks) {
                if (!seen.has(link) && seen.size < maxPages * 5) { seen.add(link); queue.push({ url: link, depth: depth + 1 }); }
            }
        }
    }
    if (cfg.signal?.cancelled && stoppedBy === 'complete') stoppedBy = 'cancelled';

    const result: CrawlResult = {
        startUrl: start, pages, findings: [],
        robots: { found: robotsFound, status: 'error' in robotsRes ? null : robotsRes.status, sitemaps: rules.sitemaps.slice(0, 20), disallowedSkipped },
        sitemapUrls: sitemapUrls.size, stoppedBy, startedAt: startedAt.toISOString(), finishedAt: now().toISOString(),
    };
    result.findings = await analyzeCrawl(result, sitemapUrls, cfg);
    return result;
}

function emptyPage(url: string, depth: number, status: number, chain: CrawledPage['redirectChain'], error: string | null): CrawledPage {
    return {
        url, finalUrl: url, depth, status, redirectChain: chain, contentType: '', title: null, metaDescription: null, canonical: null, robotsMeta: null, xRobotsTag: null,
        h1: [], headings: [], internalLinks: [], externalLinks: 0, images: 0, imagesMissingAlt: 0, structuredDataTypes: [], invalidJsonLd: 0,
        hasViewport: false, wordCount: 0, contentHash: null, relNext: null, relPrev: null, truncated: false, error,
    };
}

/** Rules over the crawl. Observed = measured; heuristic = guideline. Nothing here asserts indexing. */
export async function analyzeCrawl(r: CrawlResult, sitemapUrls: Set<string>, cfg: Pick<CrawlConfig, 'inventoryUrls' | 'inventoryComplete'>): Promise<CrawlFinding[]> {
    const out: CrawlFinding[] = [];
    const add = async (f: Omit<CrawlFinding, 'fingerprint'>) => out.push({ ...f, fingerprint: await sha(`${f.checkId}|${f.subjectUrl ?? ''}|${f.kind}`) });
    const html = r.pages.filter((p) => !p.error && p.status >= 200 && p.status < 300 && /html/i.test(p.contentType));
    const at = r.finishedAt;

    if (!r.robots.found) await add({ checkId: 'robots_missing', kind: 'observed', severity: 'low', confidence: 1, title: 'No robots.txt', subjectUrl: null, evidence: { status: r.robots.status, observedAt: at }, recommendation: 'Publish a robots.txt that lists the XML sitemap.', suggestedTask: { title: 'Add robots.txt with Sitemap directive', team: 'web', priority: 'low' } });
    else if (!r.robots.sitemaps.length) await add({ checkId: 'robots_no_sitemap', kind: 'observed', severity: 'low', confidence: 1, title: 'robots.txt does not list a sitemap', subjectUrl: null, evidence: { observedAt: at }, recommendation: 'Add a "Sitemap:" line to robots.txt.', suggestedTask: null });
    if (!r.sitemapUrls) await add({ checkId: 'sitemap_missing', kind: 'observed', severity: 'medium', confidence: 0.9, title: 'No XML sitemap URLs found', subjectUrl: null, evidence: { sitemaps: r.robots.sitemaps, observedAt: at }, recommendation: 'Publish an XML sitemap and reference it in robots.txt and Search Console.', suggestedTask: { title: 'Publish and submit an XML sitemap', team: 'seo', priority: 'medium' } });

    for (const p of r.pages) {
        if (p.error && p.status === 0) await add({ checkId: 'fetch_error', kind: 'observed', severity: 'medium', confidence: 1, title: 'Page could not be fetched', subjectUrl: p.url, evidence: { error: p.error, observedAt: at }, recommendation: 'Check that the page is reachable.', suggestedTask: null });
        if (p.status >= 400) await add({ checkId: 'http_error', kind: 'observed', severity: p.status >= 500 ? 'high' : 'medium', confidence: 1, title: `HTTP ${p.status}`, subjectUrl: p.url, evidence: { status: p.status, chain: p.redirectChain, observedAt: at }, recommendation: 'Fix or redirect the URL, and update links that point to it.', suggestedTask: { title: `Fix HTTP ${p.status} at ${p.url}`, team: 'web', priority: 'high' } });
        if (p.redirectChain.length > 2) await add({ checkId: 'redirect_chain', kind: 'observed', severity: 'medium', confidence: 1, title: `${p.redirectChain.length - 1} redirects in a row`, subjectUrl: p.url, evidence: { chain: p.redirectChain, observedAt: at }, recommendation: 'Link and redirect directly to the final URL.', suggestedTask: null });
    }
    for (const p of html) {
        const ev = { finalUrl: p.finalUrl, observedAt: at };
        const noindex = /noindex/i.test(p.robotsMeta ?? '') || /noindex/i.test(p.xRobotsTag ?? '');
        if (noindex) await add({ checkId: 'noindex', kind: 'observed', severity: sitemapUrls.has(p.url) ? 'high' : 'medium', confidence: 1, title: sitemapUrls.has(p.url) ? 'Noindex page is listed in the sitemap' : 'Page asks not to be indexed', subjectUrl: p.url, evidence: { ...ev, robotsMeta: p.robotsMeta, xRobotsTag: p.xRobotsTag, inSitemap: sitemapUrls.has(p.url) }, recommendation: 'Confirm the page should be excluded; if not, remove noindex. Excluded pages should not be in the sitemap.', suggestedTask: null });
        if (!p.title) await add({ checkId: 'title_missing', kind: 'observed', severity: 'high', confidence: 1, title: 'Missing <title>', subjectUrl: p.url, evidence: ev, recommendation: 'Add a unique, descriptive title.', suggestedTask: { title: `Write a title for ${p.url}`, team: 'seo', priority: 'high' } });
        else if (p.title.length < 30 || p.title.length > 60) await add({ checkId: 'title_length', kind: 'heuristic', severity: 'low', confidence: 0.6, title: `Title is ${p.title.length} characters`, subjectUrl: p.url, evidence: { ...ev, title: p.title, guideline: '30–60 characters' }, recommendation: 'Consider a title of roughly 30–60 characters so it is not truncated in results.', suggestedTask: null });
        if (!p.metaDescription) await add({ checkId: 'meta_description_missing', kind: 'observed', severity: 'medium', confidence: 1, title: 'Missing meta description', subjectUrl: p.url, evidence: ev, recommendation: 'Add a meta description that summarises the page.', suggestedTask: { title: `Write a meta description for ${p.url}`, team: 'seo', priority: 'medium' } });
        else if (p.metaDescription.length > 160 || p.metaDescription.length < 70) await add({ checkId: 'meta_description_length', kind: 'heuristic', severity: 'low', confidence: 0.5, title: `Meta description is ${p.metaDescription.length} characters`, subjectUrl: p.url, evidence: { ...ev, metaDescription: p.metaDescription, guideline: '70–160 characters' }, recommendation: 'Consider 70–160 characters.', suggestedTask: null });
        if (p.h1.length === 0) await add({ checkId: 'h1_missing', kind: 'observed', severity: 'medium', confidence: 1, title: 'No <h1>', subjectUrl: p.url, evidence: ev, recommendation: 'Give the page one clear main heading.', suggestedTask: { title: `Add an H1 to ${p.url}`, team: 'web', priority: 'medium' } });
        else if (p.h1.length > 1) await add({ checkId: 'h1_multiple', kind: 'heuristic', severity: 'low', confidence: 0.6, title: `${p.h1.length} <h1> elements`, subjectUrl: p.url, evidence: { ...ev, h1: p.h1.slice(0, 5) }, recommendation: 'Usually one main heading is clearer; page builders often add extra H1s in headers or sliders.', suggestedTask: null });
        const skips = p.headings.filter((h, i) => i > 0 && h.level > p.headings[i - 1]!.level + 1).slice(0, 5);
        if (skips.length) await add({ checkId: 'heading_skip', kind: 'heuristic', severity: 'info', confidence: 0.5, title: 'Heading levels are skipped', subjectUrl: p.url, evidence: { ...ev, examples: skips }, recommendation: 'Use headings in order (H2 → H3) for structure and accessibility.', suggestedTask: null });
        if (!p.canonical) await add({ checkId: 'canonical_missing', kind: 'observed', severity: 'low', confidence: 1, title: 'No canonical link', subjectUrl: p.url, evidence: ev, recommendation: 'Add a self-referencing canonical link.', suggestedTask: null });
        else {
            const c = normalizeUrl(p.canonical, p.finalUrl);
            if (c && c !== normalizeUrl(p.finalUrl)) await add({ checkId: 'canonical_other', kind: 'observed', severity: 'info', confidence: 1, title: 'Canonical points to another URL', subjectUrl: p.url, evidence: { ...ev, canonical: c }, recommendation: 'Confirm this page is meant to consolidate into the canonical URL.', suggestedTask: null });
        }
        if (p.imagesMissingAlt) await add({ checkId: 'img_alt_missing', kind: 'observed', severity: 'low', confidence: 1, title: `${p.imagesMissingAlt} of ${p.images} images without alt`, subjectUrl: p.url, evidence: { ...ev, images: p.images, missingAlt: p.imagesMissingAlt }, recommendation: 'Add alt text to meaningful images (empty alt="" for decorative ones).', suggestedTask: { title: `Add image alt text on ${p.url}`, team: 'web', priority: 'low' } });
        if (!p.hasViewport) await add({ checkId: 'viewport_missing', kind: 'observed', severity: 'medium', confidence: 1, title: 'No mobile viewport meta tag', subjectUrl: p.url, evidence: ev, recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', suggestedTask: null });
        if (p.invalidJsonLd) await add({ checkId: 'jsonld_invalid', kind: 'observed', severity: 'medium', confidence: 1, title: `${p.invalidJsonLd} invalid JSON-LD block(s)`, subjectUrl: p.url, evidence: ev, recommendation: 'Fix the structured data so it parses as JSON.', suggestedTask: null });
        if (p.wordCount < 200) await add({ checkId: 'thin_content', kind: 'heuristic', severity: 'low', confidence: 0.4, title: `About ${p.wordCount} words of visible text`, subjectUrl: p.url, evidence: { ...ev, wordCount: p.wordCount }, recommendation: 'Check whether the page answers its topic fully; word count alone is not a quality measure.', suggestedTask: null });
    }

    // Duplicates across pages
    const dup = async (key: 'title' | 'metaDescription' | 'contentHash', checkId: string, label: string) => {
        const groups = new Map<string, string[]>();
        for (const p of html) {
            const v = p[key];
            if (v) groups.set(v, [...(groups.get(v) ?? []), p.url]);
        }
        for (const [value, urls] of groups) {
            if (urls.length > 1) await add({ checkId, kind: key === 'contentHash' ? 'heuristic' : 'observed', severity: key === 'contentHash' ? 'low' : 'medium', confidence: key === 'contentHash' ? 0.7 : 1, title: `${label} shared by ${urls.length} pages`, subjectUrl: urls[0]!, evidence: { urls: urls.slice(0, 20), value: key === 'contentHash' ? undefined : clip(value, 200), observedAt: at }, recommendation: key === 'contentHash' ? 'Review whether these pages are near-identical; consolidate or differentiate them.' : `Write a unique ${label.toLowerCase()} for each page.`, suggestedTask: null });
        }
    };
    await dup('title', 'title_duplicate', 'Title');
    await dup('metaDescription', 'meta_description_duplicate', 'Meta description');
    await dup('contentHash', 'content_duplicate_candidate', 'Identical visible text');

    // Broken internal links (only where the target was actually fetched)
    const byUrl = new Map(r.pages.map((p) => [p.url, p]));
    const broken = new Map<string, string[]>();
    for (const p of html) for (const l of p.internalLinks) {
        const t = byUrl.get(l);
        if (t && t.status >= 400) broken.set(l, [...(broken.get(l) ?? []), p.url]);
    }
    for (const [target, from] of broken) await add({ checkId: 'broken_internal_link', kind: 'observed', severity: 'high', confidence: 1, title: `Internal links to a ${byUrl.get(target)!.status} page`, subjectUrl: target, evidence: { status: byUrl.get(target)!.status, linkedFrom: from.slice(0, 20), observedAt: at }, recommendation: 'Update or remove the links, or redirect the target.', suggestedTask: { title: `Fix links to ${target}`, team: 'web', priority: 'high' } });

    // Internal link distribution (incoming links among crawled pages)
    const incoming = new Map<string, number>();
    for (const p of html) for (const l of new Set(p.internalLinks)) incoming.set(l, (incoming.get(l) ?? 0) + 1);
    // Orphan candidates: listed in the sitemap/inventory but never linked from a crawled page.
    // Only meaningful when the crawl finished and the inventory is complete.
    if (r.stoppedBy === 'complete') {
        const listed = new Set<string>([...sitemapUrls, ...(cfg.inventoryComplete ? (cfg.inventoryUrls ?? []).map((u) => normalizeUrl(u)).filter((u): u is string => !!u) : [])]);
        for (const u of listed) {
            if (u === r.startUrl || incoming.get(u)) continue;
            await add({ checkId: 'orphan_candidate', kind: 'heuristic', severity: 'low', confidence: cfg.inventoryComplete ? 0.7 : 0.5, title: 'Listed page with no internal links found', subjectUrl: u, evidence: { inSitemap: sitemapUrls.has(u), crawledPages: html.length, observedAt: at }, recommendation: 'Link to this page from related content if it should rank; otherwise consider removing it from the sitemap.', suggestedTask: null });
        }
    }
    return out;
}
