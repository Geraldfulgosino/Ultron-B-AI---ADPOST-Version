// @vitest-environment node
/** Technical SEO crawler on a deterministic fake website (no network). */
import { crawlWebsite, normalizeUrl, parseRobotsRules, robotsAllows } from '../../../../../supabase/functions/_shared/integrations/crawler.ts';

const ORIGIN = 'https://www.site-under-test.com';
const PUBLIC = async () => ['93.184.215.14'];
const page = (o: { title?: string | null; desc?: string | null; h1?: string[]; links?: string[]; body?: string; canonical?: string; robots?: string; viewport?: boolean; imgs?: string }) => `<!doctype html><html lang="en"><head>
${o.title === null ? '' : `<title>${o.title ?? 'A perfectly normal page title for tests'}</title>`}
${o.desc === null ? '' : `<meta name="description" content="${o.desc ?? 'A sufficiently long and descriptive meta description that explains what the page is about.'}">`}
${o.viewport === false ? '' : '<meta name="viewport" content="width=device-width">'}
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}
<script>window.location = 'https://evil.example.org'; fetch('http://169.254.169.254/latest/meta-data');</script>
</head><body>${(o.h1 ?? ['Heading']).map((h) => `<h1>${h}</h1>`).join('')}
${(o.links ?? []).map((l) => `<a href="${l}">link</a>`).join(' ')}
${o.imgs ?? ''}
<p>${o.body ?? 'word '.repeat(300)}</p></body></html>`;

function site(pages: Record<string, { status?: number; html?: string; location?: string; type?: string }>) {
    const fetched: string[] = [];
    const fetchFn = (async (input: string) => {
        fetched.push(input);
        const u = new URL(input);
        const p = pages[`${u.pathname}${u.search}`];
        if (!p) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response(p.html ?? '', { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8', ...(p.location ? { location: p.location } : {}) } });
    }) as unknown as typeof fetch;
    return { fetch: fetchFn, fetched };
}

const ROBOTS = `User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: ${ORIGIN}/sitemap_index.xml\n`;
const SITEMAP_INDEX = `<?xml version="1.0"?><sitemapindex><sitemap><loc>${ORIGIN}/page-sitemap.xml</loc></sitemap></sitemapindex>`;
const PAGE_SITEMAP = `<?xml version="1.0"?><urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/about/</loc></url><url><loc>${ORIGIN}/orphan/</loc></url><url><loc>${ORIGIN}/hidden/</loc></url></urlset>`;

function fixtureSite() {
    return site({
        '/robots.txt': { html: ROBOTS, type: 'text/plain' },
        '/sitemap_index.xml': { html: SITEMAP_INDEX, type: 'application/xml' },
        '/page-sitemap.xml': { html: PAGE_SITEMAP, type: 'application/xml' },
        '/': { html: page({ links: ['/about/', '/contact/', '/old/', '/missing/', '/wp-admin/options.php', 'https://partner-site.com/', '/doc.pdf', 'mailto:a@b.c'], imgs: '<img src="a.png"><img src="b.png" alt="">' }) },
        '/about/': { html: page({ title: 'About', desc: null, h1: [], links: ['/'] }) },
        '/contact/': { html: page({ title: 'A perfectly normal page title for tests', links: ['/'], viewport: false }) },
        '/old/': { status: 301, location: '/old-2/' },
        '/old-2/': { status: 301, location: '/about/' },
        '/orphan/': { html: page({ title: 'Orphan landing page with a decent title' }) },
        '/hidden/': { html: page({ title: 'Hidden page that is excluded by robots meta', robots: 'noindex,follow' }) },
        '/wp-admin/options.php': { html: page({}) },
    });
}

describe('crawler', () => {
    it('crawls only allowed same-site pages, respects robots.txt, never runs page scripts', async () => {
        const s = fixtureSite();
        const r = await crawlWebsite({ startUrl: `${ORIGIN}/`, allowedHosts: ['site-under-test.com'], crawlDelayMs: 0 }, { fetch: s.fetch, resolve: PUBLIC });
        expect(r.stoppedBy).toBe('complete');
        expect(r.robots).toMatchObject({ found: true, disallowedSkipped: 1 });
        expect(r.sitemapUrls).toBe(4);
        expect(s.fetched.some((u) => u.includes('/wp-admin/options.php'))).toBe(false);
        expect(s.fetched.some((u) => u.includes('partner-site.com') || u.includes('169.254') || u.includes('evil.example') || u.endsWith('.pdf'))).toBe(false);
        expect(r.pages.find((p) => p.url === `${ORIGIN}/`)).toMatchObject({ externalLinks: 1, images: 2, imagesMissingAlt: 1 });
    });

    it('produces evidence-backed findings, separating observed facts from heuristics', async () => {
        const s = fixtureSite();
        const r = await crawlWebsite({ startUrl: `${ORIGIN}/`, allowedHosts: ['site-under-test.com'], crawlDelayMs: 0 }, { fetch: s.fetch, resolve: PUBLIC });
        const by = (id: string) => r.findings.filter((f) => f.checkId === id);
        expect(by('meta_description_missing')[0]).toMatchObject({ kind: 'observed', subjectUrl: `${ORIGIN}/about/`, confidence: 1 });
        expect(by('h1_missing')[0]!.subjectUrl).toBe(`${ORIGIN}/about/`);
        expect(by('viewport_missing')[0]!.subjectUrl).toBe(`${ORIGIN}/contact/`);
        expect(by('redirect_chain')[0]!.evidence.chain).toHaveLength(3);
        expect(by('http_error')[0]).toMatchObject({ subjectUrl: `${ORIGIN}/missing/`, severity: 'medium' });
        expect(by('broken_internal_link')[0]).toMatchObject({ subjectUrl: `${ORIGIN}/missing/`, evidence: expect.objectContaining({ linkedFrom: [`${ORIGIN}/`] }) });
        expect(by('title_duplicate')[0]!.evidence.urls).toEqual(expect.arrayContaining([`${ORIGIN}/`, `${ORIGIN}/contact/`]));
        expect(by('noindex')[0]).toMatchObject({ severity: 'high', title: 'Noindex page is listed in the sitemap' });
        expect(by('orphan_candidate').map((f) => f.subjectUrl)).toEqual(expect.arrayContaining([`${ORIGIN}/orphan/`, `${ORIGIN}/hidden/`]));
        expect(by('orphan_candidate')[0]!.kind).toBe('heuristic');
        expect(by('title_length').every((f) => f.kind === 'heuristic')).toBe(true);
        // every finding carries evidence with an observation time and a stable fingerprint
        for (const f of r.findings) {
            expect(f.recommendation.length).toBeGreaterThan(5);
            expect(f.fingerprint).toMatch(/^[0-9a-f]{32}$/);
        }
        expect(new Set(r.findings.map((f) => f.fingerprint)).size).toBe(r.findings.length);
        // nothing claims indexing status
        expect(JSON.stringify(r.findings)).not.toMatch(/\bis indexed\b/i);
    });

    it('re-running the same crawl yields the same fingerprints (no duplicate findings)', async () => {
        const run = async () => (await crawlWebsite({ startUrl: `${ORIGIN}/`, allowedHosts: ['site-under-test.com'], crawlDelayMs: 0 }, { fetch: fixtureSite().fetch, resolve: PUBLIC })).findings.map((f) => f.fingerprint).sort();
        expect(await run()).toEqual(await run());
    });

    it('enforces depth, page limits, cancellation and the time budget', async () => {
        const chain = site({ '/': { html: page({ links: ['/a/'] }) }, '/a/': { html: page({ links: ['/b/'] }) }, '/b/': { html: page({ links: ['/c/'] }) }, '/c/': { html: page({}) } });
        const cfg = { startUrl: `${ORIGIN}/`, allowedHosts: ['www.site-under-test.com'], crawlDelayMs: 0, useSitemaps: false };
        expect((await crawlWebsite({ ...cfg, maxDepth: 1 }, { fetch: chain.fetch, resolve: PUBLIC })).pages.map((p) => p.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/a/`]);
        expect(await crawlWebsite({ ...cfg, maxPages: 2 }, { fetch: chain.fetch, resolve: PUBLIC })).toMatchObject({ stoppedBy: 'max_pages' });
        expect(await crawlWebsite({ ...cfg, signal: { cancelled: true } }, { fetch: chain.fetch, resolve: PUBLIC })).toMatchObject({ stoppedBy: 'cancelled', pages: [] });
        let t = 0;
        const clock = () => new Date(1_700_000_000_000 + (t += 60_000));
        expect(await crawlWebsite({ ...cfg, budgetMs: 100_000 }, { fetch: chain.fetch, resolve: PUBLIC, now: clock })).toMatchObject({ stoppedBy: 'budget' });
    });

    it('blocks private, loopback, link-local and metadata destinations, including via redirects and DNS', async () => {
        const evil = site({
            '/': { html: page({ links: ['/to-metadata/', '/to-localhost/'] }) },
            '/to-metadata/': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
            '/to-localhost/': { status: 302, location: 'http://localhost:8080/admin' },
        });
        const r = await crawlWebsite({ startUrl: `${ORIGIN}/`, allowedHosts: ['site-under-test.com'], crawlDelayMs: 0, useSitemaps: false }, { fetch: evil.fetch, resolve: PUBLIC });
        expect(evil.fetched.map((u) => new URL(u).hostname).filter((h) => h !== "www.site-under-test.com")).toEqual([]);
        expect(r.pages.filter((p) => p.error).map((p) => p.error)).toEqual([expect.stringMatching(/private_ip/), expect.stringMatching(/blocked_host|port/)]);
        // DNS rebinding style: the site's host starts resolving to a private address.
        let calls = 0;
        const rebinding = async () => (++calls > 2 ? ['10.0.0.7'] : ['93.184.215.14']);
        const r2 = await crawlWebsite({ startUrl: `${ORIGIN}/`, allowedHosts: ['site-under-test.com'], crawlDelayMs: 0, useSitemaps: false }, { fetch: fixtureSite().fetch, resolve: rebinding });
        expect(r2.pages.some((p) => /private_dns/.test(p.error ?? ''))).toBe(true);
        await expect(crawlWebsite({ startUrl: 'https://another-site.com/', allowedHosts: ['site-under-test.com'] }, { fetch: evil.fetch, resolve: PUBLIC })).rejects.toMatchObject({ category: 'blocked_url' });
        await expect(crawlWebsite({ startUrl: 'http://127.0.0.1/', allowedHosts: ['127.0.0.1'] }, { fetch: evil.fetch, resolve: PUBLIC })).resolves.toMatchObject({ pages: [expect.objectContaining({ error: expect.stringMatching(/private_ip/) })] });
    });

    it('robots rules: longest match, Allow wins ties, wildcards and $', () => {
        const rules = parseRobotsRules('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.php$\nDisallow: /tmp*\n\nUser-agent: ULTRON-B-SEO-Crawler\nDisallow: /no-ultron/');
        expect(rules.disallow).toEqual(['/no-ultron/']);
        const star = parseRobotsRules('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.php$\nDisallow: /tmp*', 'OtherBot');
        expect(robotsAllows(star, '/private/x')).toBe(false);
        expect(robotsAllows(star, '/private/public/y')).toBe(true);
        expect(robotsAllows(star, '/index.php')).toBe(false);
        expect(robotsAllows(star, '/index.php?x=1')).toBe(true);
        expect(robotsAllows(star, '/tmpfile')).toBe(false);
        expect(robotsAllows(star, '/blog/')).toBe(true);
    });

    it('normalizes URLs for de-duplication', () => {
        expect(normalizeUrl('HTTPS://Example.COM/a?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a?a=1&b=2');
        expect(normalizeUrl('javascript:alert(1)')).toBeNull();
        expect(normalizeUrl('/x', 'https://site.com/a/')).toBe('https://site.com/x');
    });
});
