/**
 * VCA demonstration dataset (local mock adapter only).
 *
 * Fills the four VCA clients (CMS, LIPSKY, HLDC, LOOP19) with interconnected, SYNTHETIC records:
 * 90 days of GA4/GSC-shaped metrics, weekly queries and landing pages, simulated audits,
 * simulated integrations, SEO insights, a sprint project with tasks and approvals, knowledge
 * documents, simulated agent/team conversations and execution history.
 *
 * Rules:
 * - Deterministic: a fixed seed per client and a fixed end date, so every run produces the same rows.
 * - Idempotent: applied once per client (seed step `vca-demo-v1:<key>`); records the user deleted
 *   or changed afterwards are never re-created or overwritten on refresh.
 * - Owned: every row id starts with `vd_<key>_`. The demo reset deletes exactly those rows.
 * - Attached only to the existing demo production website of each client (reserved .example
 *   domain). Website records, addresses and user-created data are never modified.
 * - No network, no provider calls, no real credentials or Google property ids. Everything is
 *   labelled simulated/synthetic in the data (`simulated`, mode 'simulated', titles) and the UI.
 * The baselines are invented for demonstration, not measured client performance.
 */
import type * as T from '@/domain/types';
import { addDays } from '@/domain/analytics';
import { healthScore } from '@/domain/audit';
import { chunkText } from '@/domain/knowledge';
import { hashString, mulberry32 } from '@/lib/random';
import type { DbSnapshot, LocalDatabase, TableName } from './db';

export const VCA_DEMO_SET = 'vca-demo-v1';
export const VCA_DEMO_END = '2026-11-22';
export const VCA_DEMO_DAYS = 90;
const START = addDays(VCA_DEMO_END, -(VCA_DEMO_DAYS - 1));
const WEEKS = Math.ceil(VCA_DEMO_DAYS / 7);
const ADMIN = 'usr_vca_admin';
const SIM_CONNECTION = 'aic_simulator_vca';
const SIM_MODEL = 'sim-deterministic-1';
export const DEMO_NOTICE = 'SIMULATED DEMO DATA: synthetic records for demonstration, not measured client performance.';

export type VcaDemoKey = 'cms' | 'lipsky' | 'hldc' | 'loop19';

interface QuerySpec {
    q: string;
    /** Relative impression weight. */
    imp: number;
    ctr: number;
    pos: number;
    /** From `day`, CTR and position move to these values over two weeks (story events). */
    change?: { day: number; ctr: number; pos: number };
}
interface PageSpec { path: string; share: number; conv: number; bounce: number; fade?: number }
interface IssueSpec { code: string; label: string; category: T.AuditCategory; severity: T.Severity; start: number; end: number; jumpWeek?: number; jump?: number }

interface ClientSpec {
    key: VcaDemoKey;
    slug: string;
    name: string;
    monthly: { sessions: number; clicks: number; impressions: number };
    story: 'decline' | 'growth' | 'flat' | 'recovery';
    storyText: string;
    themes: string;
    engagement: number;
    keyEventRate: number;
    basePosition: number;
    devices: Record<T.DeviceKey, number>;
    pagesCrawled: number;
    lab: { mobileLcpMs: number; desktopLcpMs: number; cls: number; inpMs: number };
    queries: QuerySpec[];
    pages: PageSpec[];
    issues: IssueSpec[];
    visibility: number;
}

const COUNTRIES = { 'United States': 0.86, Canada: 0.05, 'United Kingdom': 0.03, India: 0.02, Other: 0.04 };
const SOURCES = { Direct: 0.42, Referral: 0.2, 'Organic Social': 0.12, 'Paid Search': 0.16, Email: 0.1 };

const COMMON_ISSUES = (o: Partial<Record<string, [number, number]>>): IssueSpec[] => {
    const base: IssueSpec[] = [
        { code: 'missing_meta_description', label: 'Missing meta description', category: 'on_page', severity: 'medium', start: 12, end: 8 },
        { code: 'duplicate_title', label: 'Duplicate title tag', category: 'on_page', severity: 'medium', start: 6, end: 5 },
        { code: 'missing_title', label: 'Missing title tag', category: 'on_page', severity: 'high', start: 1, end: 0 },
        { code: 'title_too_long', label: 'Title longer than 60 characters', category: 'on_page', severity: 'low', start: 14, end: 11 },
        { code: 'missing_h1', label: 'Missing H1 heading', category: 'on_page', severity: 'medium', start: 3, end: 2 },
        { code: 'broken_internal_links', label: 'Broken internal links', category: 'links', severity: 'high', start: 4, end: 2 },
        { code: 'orphan_pages', label: 'Orphan pages (no internal links in)', category: 'links', severity: 'medium', start: 5, end: 4 },
        { code: 'low_internal_links', label: 'Fewer than 3 internal links in', category: 'links', severity: 'low', start: 11, end: 9 },
        { code: 'redirect_chains', label: 'Redirect chains', category: 'indexability', severity: 'low', start: 3, end: 2 },
        { code: 'canonical_mismatch', label: 'Canonical points elsewhere', category: 'indexability', severity: 'medium', start: 2, end: 1 },
        { code: 'slow_mobile_lcp', label: 'Mobile LCP over 2.5 s (lab)', category: 'performance', severity: 'high', start: 9, end: 7 },
        { code: 'large_images', label: 'Images over 300 KB', category: 'performance', severity: 'medium', start: 16, end: 12 },
        { code: 'missing_schema', label: 'No structured data', category: 'structured_data', severity: 'low', start: 20, end: 17 },
    ];
    return base.map((i) => (o[i.code] ? { ...i, start: o[i.code]![0], end: o[i.code]![1] } : i));
};

export const VCA_DEMO_CLIENTS: ClientSpec[] = [
    {
        key: 'cms', slug: 'cms', name: 'CMS',
        monthly: { sessions: 12_400, clicks: 4_350, impressions: 138_000 },
        story: 'decline',
        storyText: 'Organic clicks fell this month after the simulated ranking drop for "construction seo services" and new duplicate titles from a site template update.',
        themes: 'Construction marketing, digital marketing for contractors, construction SEO and website development.',
        engagement: 0.61, keyEventRate: 0.021, basePosition: 11.8,
        devices: { desktop: 0.56, mobile: 0.39, tablet: 0.05 },
        pagesCrawled: 64,
        lab: { mobileLcpMs: 3100, desktopLcpMs: 1700, cls: 0.07, inpMs: 190 },
        visibility: 31,
        queries: [
            { q: 'construction seo services', imp: 16, ctr: 0.072, pos: 4.1, change: { day: 62, ctr: 0.028, pos: 8.2 } },
            { q: 'construction marketing agency', imp: 14, ctr: 0.048, pos: 5.6 },
            { q: 'digital marketing for contractors', imp: 13, ctr: 0.041, pos: 6.3 },
            { q: 'contractor website design', imp: 11, ctr: 0.036, pos: 7.4 },
            { q: 'marketing for general contractors', imp: 10, ctr: 0.012, pos: 6.8 },
            { q: 'construction lead generation', imp: 9, ctr: 0.031, pos: 9.7 },
            { q: 'construction company website development', imp: 8, ctr: 0.029, pos: 10.9 },
            { q: 'seo for home builders', imp: 7, ctr: 0.045, pos: 5.2 },
            { q: 'how to market a construction company', imp: 7, ctr: 0.018, pos: 11.6 },
            { q: 'contractor ppc management', imp: 5, ctr: 0.027, pos: 12.8 },
        ],
        pages: [
            { path: '/', share: 0.24, conv: 0.018, bounce: 0.41 },
            { path: '/services/construction-seo', share: 0.17, conv: 0.026, bounce: 0.38, fade: 0.68 },
            { path: '/services/contractor-websites', share: 0.13, conv: 0.031, bounce: 0.36 },
            { path: '/services/digital-marketing', share: 0.11, conv: 0.022, bounce: 0.44 },
            { path: '/blog/marketing-ideas-for-contractors', share: 0.09, conv: 0.006, bounce: 0.63 },
            { path: '/case-studies', share: 0.06, conv: 0.019, bounce: 0.39 },
            { path: '/contact', share: 0.05, conv: 0.11, bounce: 0.22 },
            { path: '/blog/construction-seo-checklist', share: 0.05, conv: 0.004, bounce: 0.67 },
        ],
        issues: COMMON_ISSUES({ duplicate_title: [2, 11], missing_meta_description: [9, 14] }).map((i) => (i.code === 'duplicate_title' ? { ...i, jumpWeek: 9 } : i)),
    },
    {
        key: 'lipsky', slug: 'lipsky', name: 'LIPSKY',
        monthly: { sessions: 18_700, clicks: 6_900, impressions: 184_000 },
        story: 'growth',
        storyText: 'Steady organic growth driven by remodeling cost guides; the main gap is low CTR on high-impression service queries.',
        themes: 'Construction services, home improvement, remodeling and contractor-related keywords.',
        engagement: 0.64, keyEventRate: 0.024, basePosition: 9.6,
        devices: { desktop: 0.41, mobile: 0.53, tablet: 0.06 },
        pagesCrawled: 88,
        lab: { mobileLcpMs: 2700, desktopLcpMs: 1500, cls: 0.05, inpMs: 170 },
        visibility: 44,
        queries: [
            { q: 'kitchen remodeling contractor', imp: 16, ctr: 0.052, pos: 4.8 },
            { q: 'bathroom remodel cost', imp: 15, ctr: 0.014, pos: 6.1 },
            { q: 'home improvement contractor near me', imp: 13, ctr: 0.047, pos: 5.4 },
            { q: 'basement finishing company', imp: 10, ctr: 0.043, pos: 6.9 },
            { q: 'home addition contractor', imp: 9, ctr: 0.034, pos: 8.8 },
            { q: 'licensed general contractor', imp: 9, ctr: 0.029, pos: 9.9 },
            { q: 'whole home renovation', imp: 8, ctr: 0.038, pos: 7.7 },
            { q: 'how long does a kitchen remodel take', imp: 8, ctr: 0.021, pos: 8.4 },
            { q: 'deck builders', imp: 6, ctr: 0.031, pos: 11.2 },
            { q: 'remodeling company reviews', imp: 5, ctr: 0.057, pos: 3.9 },
        ],
        pages: [
            { path: '/', share: 0.21, conv: 0.02, bounce: 0.4 },
            { path: '/kitchen-remodeling', share: 0.16, conv: 0.033, bounce: 0.35 },
            { path: '/bathroom-remodeling', share: 0.13, conv: 0.029, bounce: 0.37 },
            { path: '/guides/bathroom-remodel-cost', share: 0.12, conv: 0.007, bounce: 0.58 },
            { path: '/basement-finishing', share: 0.08, conv: 0.027, bounce: 0.39 },
            { path: '/home-additions', share: 0.07, conv: 0.024, bounce: 0.42 },
            { path: '/reviews', share: 0.06, conv: 0.03, bounce: 0.31 },
            { path: '/contact', share: 0.05, conv: 0.12, bounce: 0.21 },
        ],
        issues: COMMON_ISSUES({ missing_meta_description: [15, 7], slow_mobile_lcp: [12, 6], large_images: [24, 13] }),
    },
    {
        key: 'hldc', slug: 'hamptons', name: 'HLDC',
        monthly: { sessions: 8_600, clicks: 2_750, impressions: 96_000 },
        story: 'flat',
        storyText: 'Traffic is flat; mobile visitors engage far less than desktop visitors, pointing to a mobile performance problem (simulated lab data).',
        themes: 'Generic construction-industry examples (no HLDC company profile is available locally, so no facts about the company are assumed).',
        engagement: 0.53, keyEventRate: 0.017, basePosition: 14.2,
        devices: { desktop: 0.47, mobile: 0.47, tablet: 0.06 },
        pagesCrawled: 41,
        lab: { mobileLcpMs: 4300, desktopLcpMs: 2100, cls: 0.19, inpMs: 310 },
        visibility: 22,
        queries: [
            { q: 'custom home builder', imp: 15, ctr: 0.039, pos: 7.9 },
            { q: 'design build contractor', imp: 13, ctr: 0.033, pos: 9.2 },
            { q: 'construction management services', imp: 12, ctr: 0.011, pos: 8.6 },
            { q: 'new home construction timeline', imp: 10, ctr: 0.024, pos: 12.4 },
            { q: 'residential construction company', imp: 9, ctr: 0.031, pos: 10.8 },
            { q: 'luxury home renovation', imp: 9, ctr: 0.027, pos: 13.6 },
            { q: 'home building cost per square foot', imp: 8, ctr: 0.016, pos: 14.9 },
            { q: 'building permit process', imp: 6, ctr: 0.022, pos: 16.3 },
        ],
        pages: [
            { path: '/', share: 0.27, conv: 0.016, bounce: 0.47 },
            { path: '/services/custom-homes', share: 0.18, conv: 0.024, bounce: 0.43 },
            { path: '/services/construction-management', share: 0.14, conv: 0.019, bounce: 0.46 },
            { path: '/projects', share: 0.12, conv: 0.012, bounce: 0.41 },
            { path: '/process', share: 0.09, conv: 0.009, bounce: 0.55 },
            { path: '/contact', share: 0.06, conv: 0.1, bounce: 0.25 },
        ],
        issues: COMMON_ISSUES({ slow_mobile_lcp: [24, 23], large_images: [21, 19], missing_schema: [30, 30], orphan_pages: [6, 6] }),
    },
    {
        key: 'loop19', slug: 'loop19', name: 'LOOP19',
        monthly: { sessions: 6_900, clicks: 2_100, impressions: 74_000 },
        story: 'recovery',
        storyText: 'A simulated mid-period dip (weeks 4–7) after a staging robots rule leaked to production; traffic has since recovered past the earlier level.',
        themes: 'Neutral demo marketing and web-performance keywords (no LOOP19 description is available locally).',
        engagement: 0.58, keyEventRate: 0.019, basePosition: 16.5,
        devices: { desktop: 0.52, mobile: 0.43, tablet: 0.05 },
        pagesCrawled: 52,
        lab: { mobileLcpMs: 2900, desktopLcpMs: 1600, cls: 0.09, inpMs: 210 },
        visibility: 18,
        queries: [
            { q: 'website speed optimization', imp: 14, ctr: 0.034, pos: 9.4 },
            { q: 'core web vitals checklist', imp: 12, ctr: 0.041, pos: 7.1 },
            { q: 'small business seo', imp: 12, ctr: 0.013, pos: 11.8 },
            { q: 'landing page conversion tips', imp: 10, ctr: 0.029, pos: 10.2 },
            { q: 'web performance audit', imp: 9, ctr: 0.036, pos: 8.3 },
            { q: 'local seo services', imp: 9, ctr: 0.019, pos: 14.7 },
            { q: 'website redesign checklist', imp: 7, ctr: 0.032, pos: 12.1 },
            { q: 'content marketing strategy', imp: 6, ctr: 0.022, pos: 17.9 },
        ],
        pages: [
            { path: '/', share: 0.25, conv: 0.017, bounce: 0.45 },
            { path: '/services/web-performance', share: 0.17, conv: 0.026, bounce: 0.4 },
            { path: '/blog/core-web-vitals-checklist', share: 0.15, conv: 0.005, bounce: 0.61 },
            { path: '/services/seo', share: 0.12, conv: 0.021, bounce: 0.43 },
            { path: '/blog/landing-page-tips', share: 0.1, conv: 0.008, bounce: 0.58 },
            { path: '/contact', share: 0.05, conv: 0.11, bounce: 0.24 },
        ],
        issues: COMMON_ISSUES({ canonical_mismatch: [9, 1], redirect_chains: [7, 2], broken_internal_links: [8, 3] }),
    },
];

// ── helpers ───────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

/** Integer split of `total` by weights that sums exactly to `total` (largest remainder). */
export function allocate<K extends string>(total: number, weights: Record<K, number>, rand: () => number): Record<K, number> {
    const keys = Object.keys(weights) as K[];
    const w = keys.map((k) => weights[k] * (0.93 + rand() * 0.14));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const raw = w.map((x) => (x / sum) * total);
    const out = raw.map(Math.floor);
    let rest = total - out.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
    for (let j = 0; rest > 0; j = (j + 1) % order.length, rest--) out[order[j]!.i]!++;
    return Object.fromEntries(keys.map((k, i) => [k, out[i]!])) as Record<K, number>;
}

function storyFactor(story: ClientSpec['story'], d: number, metric: 'sessions' | 'search'): number {
    switch (story) {
        case 'decline':
            return d < 62 ? 1 + 0.03 * (d / 62) : lerp(1.03, metric === 'search' ? 0.78 : 0.9, (d - 62) / 27);
        case 'growth':
            return 0.87 + 0.26 * (d / 89);
        case 'flat':
            return 1 + 0.035 * Math.sin(d / 9);
        case 'recovery':
            if (d < 25) return 1;
            if (d < 35) return lerp(1, metric === 'search' ? 0.72 : 0.82, (d - 25) / 10);
            if (d < 50) return metric === 'search' ? 0.72 : 0.82;
            return lerp(metric === 'search' ? 0.72 : 0.82, 1.08, (d - 50) / 39);
    }
}

function positionShift(story: ClientSpec['story'], d: number): number {
    switch (story) {
        case 'decline': return d < 62 ? 0 : lerp(0, 1.9, (d - 62) / 20);
        case 'growth': return -1.6 * (d / 89);
        case 'flat': return 0.2 * Math.sin(d / 11);
        case 'recovery': return d < 25 ? 0 : d < 50 ? lerp(0, 2.4, (d - 25) / 10) : lerp(2.4, -0.6, (d - 50) / 39);
    }
}

const at = (day: string, hh: number, mm = 0) => `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
const ago = (days: number, hh = 9, mm = 0) => at(addDays(VCA_DEMO_END, -days), hh, mm);

export interface DemoContext {
    spec: ClientSpec;
    brandId: T.ID;
    website: T.Website;
    staging: T.Website | null;
    agents: Record<T.AgentTemplateKey, T.AgentInstance>;
}

type Rows = { [K in TableName]?: DbSnapshot[K] };

// ── generation ────────────────────────────────────────────────────────────

/** Builds every demo row for one client. Pure: same context, same rows. */
export function buildVcaDemoRows(ctx: DemoContext): Rows {
    const { spec, brandId, website } = ctx;
    const rand = mulberry32(hashString(`${VCA_DEMO_SET}:${spec.key}`));
    const P = `vd_${spec.key}_`;
    const websiteId = website.id;
    const base = { brandId, clientId: website.clientId };

    // Daily metrics: weekly seasonality × story × noise, scaled so the 90-day average equals the baseline.
    const daily = { sessions: spec.monthly.sessions / 30.4375, clicks: spec.monthly.clicks / 30.4375, impressions: spec.monthly.impressions / 30.4375 };
    const shape = Array.from({ length: VCA_DEMO_DAYS }, (_, d) => {
        const wd = new Date(addDays(START, d) + 'T00:00:00Z').getUTCDay();
        const week = wd === 0 || wd === 6 ? 0.72 : 1.11;
        return {
            s: week * storyFactor(spec.story, d, 'sessions') * (0.92 + rand() * 0.16),
            c: week * storyFactor(spec.story, d, 'search') * (0.9 + rand() * 0.2),
            i: week * storyFactor(spec.story, d, 'search') * (0.93 + rand() * 0.14),
        };
    });
    const mean = (k: 's' | 'c' | 'i') => shape.reduce((a, x) => a + x[k], 0) / shape.length;
    const ms = mean('s'), mc = mean('c'), mi = mean('i');

    const dailyMetrics: T.DailyMetric[] = shape.map((x, d) => {
        const sessions = Math.round((x.s / ms) * daily.sessions);
        const clicks = Math.min(Math.round((x.c / mc) * daily.clicks), Math.round(sessions * 0.8));
        const impressions = Math.round((x.i / mi) * daily.impressions);
        const organic = Math.min(sessions, Math.round(clicks * (0.9 + rand() * 0.06)));
        const rest = allocate(sessions - organic, SOURCES, rand);
        return {
            id: `${P}dm_${d}`, ...base, websiteId, date: addDays(START, d),
            sessions,
            users: Math.round(sessions * (0.76 + rand() * 0.05)),
            conversions: Math.round(sessions * spec.keyEventRate * (0.85 + rand() * 0.3)),
            clicks, impressions,
            position: round1(spec.basePosition + positionShift(spec.story, d) + (rand() - 0.5) * 0.8),
            engagedSessions: Math.round(sessions * (spec.engagement + (rand() - 0.5) * 0.04)),
            breakdown: {
                device: allocate(sessions, spec.devices, rand),
                source: { 'Organic Search': organic, ...rest },
                country: allocate(sessions, COUNTRIES, rand),
                searchDevice: allocate(clicks, { desktop: spec.devices.desktop * 0.95, mobile: spec.devices.mobile * 1.08, tablet: spec.devices.tablet }, rand),
                searchCountry: allocate(clicks, COUNTRIES, rand),
            },
        };
    });

    // Weekly queries and landing pages, derived from (and never exceeding) the daily totals of that week.
    const searchQueries: T.SearchQuery[] = [];
    const landingPages: T.LandingPage[] = [];
    for (let w = 0; w < WEEKS; w++) {
        const days = dailyMetrics.slice(w * 7, w * 7 + 7);
        const W = days.reduce((a, m) => ({ s: a.s + m.sessions, c: a.c + m.clicks, i: a.i + m.impressions }), { s: 0, c: 0, i: 0 });
        const mid = w * 7 + 3;
        const shift = positionShift(spec.story, mid);
        const qs = spec.queries.map((q) => {
            const t = q.change ? (mid - q.change.day) / 14 : 0;
            const ctr = q.change ? lerp(q.ctr, q.change.ctr, t) : q.ctr;
            const pos = q.change ? lerp(q.pos, q.change.pos, t) : q.pos + shift * 0.6;
            return { q: q.q, weight: q.imp * (0.92 + rand() * 0.16) * (q.change && t > 0 ? lerp(1, 0.85, t) : 1), ctr: ctr * (0.92 + rand() * 0.16), pos: pos + (rand() - 0.5) * 0.6 };
        });
        const wsum = qs.reduce((a, q) => a + q.weight, 0);
        const imps = qs.map((q) => Math.round(W.i * 0.46 * (q.weight / wsum)));
        let clicks = qs.map((q, i) => imps[i]! * q.ctr);
        const cap = W.c * 0.72;
        const csum = clicks.reduce((a, b) => a + b, 0);
        if (csum > cap) clicks = clicks.map((c) => (c * cap) / csum);
        qs.forEach((q, i) =>
            searchQueries.push({ id: `${P}sq_${w}_${i}`, ...base, websiteId, date: addDays(START, w * 7), query: q.q, impressions: imps[i]!, clicks: Math.round(clicks[i]!), position: round1(Math.max(1, q.pos)) }),
        );
        spec.pages.forEach((p, i) => {
            const fade = p.fade && spec.story === 'decline' ? lerp(1, p.fade, (mid - 62) / 21) : 1;
            const sessions = Math.round(W.s * 0.9 * p.share * fade * (0.95 + rand() * 0.1));
            landingPages.push({ id: `${P}lp_${w}_${i}`, ...base, websiteId, date: addDays(START, w * 7), path: p.path, sessions, conversions: Math.round(sessions * p.conv), bounceRate: Math.round((p.bounce + (rand() - 0.5) * 0.03) * 1000) / 1000 });
        });
    }

    // Weekly simulated audits (issue counts drift from `start` to `end`; optional jump = template regression).
    const siteAudits: T.SiteAudit[] = [];
    for (let w = 0; w < WEEKS; w++) {
        const t = w / (WEEKS - 1);
        const issues: T.AuditIssue[] = spec.issues.map((i) => {
            const count = i.jumpWeek !== undefined ? (w < i.jumpWeek ? i.start : i.end) : Math.round(lerp(i.start, i.end, t) + (rand() - 0.5));
            const paths = spec.pages.map((p) => p.path).filter((p) => p !== '/contact');
            return { code: i.code, label: i.label, category: i.category, severity: i.severity, count: Math.max(0, count), examples: count > 0 ? paths.slice(0, Math.min(3, count)) : [] };
        });
        const comp = (n: string, d: string, v: number, k: number, self = false) => ({ name: n, domain: d, visibility: Math.round(v + (rand() - 0.5) * 2), sharedKeywords: k, isSelf: self });
        siteAudits.push({
            id: `${P}aud_${w}`, ...base, websiteId, date: addDays(START, w * 7), simulated: true, pagesCrawled: spec.pagesCrawled + Math.round(t * 3),
            issues,
            lab: { mobileLcpMs: Math.round(spec.lab.mobileLcpMs * lerp(1.06, 1, t)), desktopLcpMs: spec.lab.desktopLcpMs, cls: spec.lab.cls, inpMs: spec.lab.inpMs },
            competitors: [
                comp(`${spec.name} (this website)`, website.domain ?? '', spec.visibility * storyFactor(spec.story, w * 7, 'search'), spec.queries.length, true),
                comp('Competitor A (simulated)', `competitor-a-${spec.key}.example`, spec.visibility * 1.35, Math.round(spec.queries.length * 0.8)),
                comp('Competitor B (simulated)', `competitor-b-${spec.key}.example`, spec.visibility * 0.9, Math.round(spec.queries.length * 0.6)),
                comp('Competitor C (simulated)', `competitor-c-${spec.key}.example`, spec.visibility * 0.55, Math.round(spec.queries.length * 0.4)),
            ],
        });
    }

    const integrations = buildIntegrations(ctx, P);
    const analysis = analyse(spec, dailyMetrics, searchQueries, landingPages, siteAudits);
    const { seoInsights, projects, tasks, approvals, taskComments } = buildWork(ctx, P, analysis);
    const { conversations, messages, executions } = buildConversations(ctx, P, analysis, tasks, approvals);
    const { knowledgeDocuments, knowledgeChunks } = buildKnowledge(ctx, P);

    return { dailyMetrics, searchQueries, landingPages, siteAudits, integrations, seoInsights, projects, tasks, approvals, taskComments, conversations, messages, executions, knowledgeDocuments, knowledgeChunks };
}

function buildIntegrations(ctx: DemoContext, P: string): T.Integration[] {
    const { spec, brandId, website, staging } = ctx;
    const history = (provider: string, failDay: number | null): T.IntegrationSyncEvent[] =>
        [0, 1, 2, 3, 4, 5].map((d) => ({
            at: ago(d, 6, provider === 'ga4' ? 0 : 5),
            ok: d !== failDay,
            message: d === failDay
                ? 'Simulated failure: provider rate limit reached; the next scheduled run succeeded. No request was sent.'
                : `Simulated sync: synthetic ${provider === 'ga4' ? 'GA4' : 'Search Console'} rows refreshed locally. No provider request was sent.`,
        }));
    const row = (id: string, site: T.Website, provider: T.IntegrationProvider, status: T.IntegrationStatus, failDay: number | null, error: string | null): T.Integration => ({
        id, brandId, clientId: site.clientId, websiteId: site.id, provider, status,
        externalAccountName: 'VCA demo account (simulated)',
        externalPropertyName: provider === 'google_analytics' ? 'Simulated GA4 property (demo, no real id)' : `Simulated Search Console property for ${site.domain} (demo)`,
        lastSyncedAt: status === 'error' ? ago(3, 6) : ago(0, 6, provider === 'google_analytics' ? 0 : 5),
        lastErrorMessage: error, createdAt: ago(120), simulated: true,
        syncHistory: status === 'error' ? history(provider === 'google_analytics' ? 'ga4' : 'gsc', 0).map((h, i) => (i < 3 ? { ...h, ok: false, message: error! } : h)) : history(provider === 'google_analytics' ? 'ga4' : 'gsc', failDay),
    });
    const out = [
        row(`${P}int_ga4`, website, 'google_analytics', 'connected', spec.key === 'lipsky' ? 4 : null, null),
        row(`${P}int_gsc`, website, 'google_search_console', 'connected', spec.key === 'hldc' ? 2 : null, null),
    ];
    if (staging && spec.key === 'loop19') {
        out.push(row(`${P}int_ga4_stg`, staging, 'google_analytics', 'error', null, 'Simulated failure: the staging property has no data stream yet (demo). Nothing was contacted.'));
    }
    return out;
}

// ── analysis shared by insights, tasks and conversations ───────────────────

interface QueryAgg { query: string; clicks: number; impressions: number; ctr: number; position: number; prevClicks: number; prevPosition: number }
interface PageAgg { path: string; sessions: number; conversions: number; bounce: number; prevSessions: number }

export interface DemoAnalysis {
    cur: { from: string; to: string; sessions: number; clicks: number; impressions: number; keyEvents: number; engaged: number; position: number };
    prev: { from: string; to: string; sessions: number; clicks: number; impressions: number; keyEvents: number; engaged: number; position: number };
    queries: QueryAgg[];
    pages: PageAgg[];
    audit: T.SiteAudit;
    score: number;
    mobileEngagement: number;
    desktopEngagementHint: number;
    mobileShare: number;
}

function analyse(spec: ClientSpec, m: T.DailyMetric[], q: T.SearchQuery[], p: T.LandingPage[], audits: T.SiteAudit[]): DemoAnalysis {
    const win = (from: number, to: number) => {
        const rows = m.slice(from, to + 1);
        const sum = (k: 'sessions' | 'clicks' | 'impressions' | 'conversions') => rows.reduce((a, r) => a + r[k], 0);
        return {
            from: rows[0]!.date, to: rows[rows.length - 1]!.date, sessions: sum('sessions'), clicks: sum('clicks'), impressions: sum('impressions'), keyEvents: sum('conversions'),
            engaged: rows.reduce((a, r) => a + (r.engagedSessions ?? 0), 0), position: round1(rows.reduce((a, r) => a + r.position, 0) / rows.length),
        };
    };
    const n = m.length;
    const cur = win(n - 28, n - 1);
    const prev = win(n - 56, n - 29);
    // Weekly buckets: last four weeks vs the four before (weeks 9-12 vs 5-8).
    const inWeeks = <R extends { date: string }>(rows: R[], from: number, to: number) => rows.filter((r) => r.date >= addDays(START, from * 7) && r.date < addDays(START, (to + 1) * 7));
    const queries = spec.queries.map((s) => {
        const c = inWeeks(q, WEEKS - 4, WEEKS - 1).filter((r) => r.query === s.q);
        const pr = inWeeks(q, WEEKS - 8, WEEKS - 5).filter((r) => r.query === s.q);
        const clicks = c.reduce((a, r) => a + r.clicks, 0);
        const impressions = c.reduce((a, r) => a + r.impressions, 0);
        return {
            query: s.q, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: round1(c.reduce((a, r) => a + r.position, 0) / (c.length || 1)),
            prevClicks: pr.reduce((a, r) => a + r.clicks, 0), prevPosition: round1(pr.reduce((a, r) => a + r.position, 0) / (pr.length || 1)),
        };
    });
    const pages = spec.pages.map((s) => {
        const c = inWeeks(p, WEEKS - 4, WEEKS - 1).filter((r) => r.path === s.path);
        const pr = inWeeks(p, WEEKS - 8, WEEKS - 5).filter((r) => r.path === s.path);
        return { path: s.path, sessions: c.reduce((a, r) => a + r.sessions, 0), conversions: c.reduce((a, r) => a + r.conversions, 0), bounce: c.length ? c.reduce((a, r) => a + r.bounceRate, 0) / c.length : 0, prevSessions: pr.reduce((a, r) => a + r.sessions, 0) };
    });
    const audit = audits[audits.length - 1]!;
    const last = m.slice(n - 28);
    const mobile = last.reduce((a, r) => a + (r.breakdown?.device.mobile ?? 0), 0);
    const total = last.reduce((a, r) => a + r.sessions, 0);
    // Engagement by device is not stored per day; the demo models mobile as weaker where lab LCP is slow.
    const penalty = spec.lab.mobileLcpMs > 4000 ? 0.16 : spec.lab.mobileLcpMs > 2900 ? 0.07 : 0.03;
    return {
        cur, prev, queries, pages, audit, score: healthScore(audit.issues, audit.pagesCrawled).score,
        mobileEngagement: spec.engagement - penalty * (1 - spec.devices.mobile), desktopEngagementHint: spec.engagement + penalty * spec.devices.mobile, mobileShare: total ? mobile / total : 0,
    };
}

const change = (c: number, p: number) => (p ? (c - p) / p : 0);
const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

// ── insights, project, tasks, approvals ───────────────────────────────────

function buildWork(ctx: DemoContext, P: string, a: DemoAnalysis) {
    const { spec, brandId, website, agents } = ctx;
    const base = { brandId, clientId: website.clientId, websiteId: website.id };
    const issue = (code: string) => a.audit.issues.find((i) => i.code === code)!;
    const byImp = [...a.queries].sort((x, y) => y.impressions - x.impressions);
    const lowCtr = byImp.find((q) => q.ctr < 0.02) ?? byImp[0]!;
    const nearPageOne = byImp.find((q) => q.position >= 7 && q.position <= 15 && q.query !== lowCtr.query) ?? byImp[1]!;
    const secondRank = byImp.find((q) => q.position >= 8 && q.query !== lowCtr.query && q.query !== nearPageOne.query) ?? byImp[2]!;
    const declining = [...a.pages].sort((x, y) => change(x.sessions, x.prevSessions) - change(y.sessions, y.prevSessions))[0]!;
    const weakConv = [...a.pages].filter((p) => p.path !== '/contact').sort((x, y) => x.conversions / (x.sessions || 1) - y.conversions / (y.sessions || 1))[0]!;
    const bouncy = [...a.pages].sort((x, y) => y.bounce - x.bounce)[0]!;
    const biggestQueryDrop = [...a.queries].sort((x, y) => (x.clicks - x.prevClicks) - (y.clicks - y.prevClicks))[0]!;
    const period = `${a.cur.from} to ${a.cur.to} (simulated)`;
    const mobileLcp = (a.audit.lab.mobileLcpMs / 1000).toFixed(1);

    type Def = Omit<T.SeoInsight, 'id' | 'brandId' | 'clientId' | 'websiteId' | 'source' | 'reviewedBy' | 'reviewedAt' | 'reviewNotes' | 'createdAt' | 'simulated'> & { agent: T.AgentTemplateKey; days: number };
    const defs: Def[] = [
        {
            type: 'ctr_opportunity', category: 'High impressions, low CTR', severity: 'high', priority: 'high', status: 'pending', agent: 'content_seo', days: 2,
            subject: `demo:ctr:${lowCtr.query}`, title: `High impressions, low CTR: “${lowCtr.query}”`,
            summary: `“${lowCtr.query}” earned ${fmt(lowCtr.impressions)} impressions but only ${fmt(lowCtr.clicks)} clicks in the last four weeks (CTR ${pct(lowCtr.ctr, 2)}) at an average position of ${lowCtr.position}.`,
            recommendation: 'Rewrite the title tag and meta description of the ranking page to match the search intent, and add a clear call to action in the snippet.',
            evidence: { query: lowCtr.query, impressions: lowCtr.impressions, clicks: lowCtr.clicks, ctr: pct(lowCtr.ctr, 2), avgPosition: lowCtr.position, period },
        },
        {
            type: 'traffic_drop', category: 'Declining clicks', severity: spec.story === 'decline' ? 'high' : 'medium', priority: spec.story === 'decline' ? 'urgent' : 'medium', status: spec.story === 'decline' ? 'reviewed' : 'pending', agent: 'statistics_seo', days: 1,
            subject: `demo:drop:${biggestQueryDrop.query}`, title: `Clicks declining for “${biggestQueryDrop.query}”`,
            summary: `Clicks moved from ${fmt(biggestQueryDrop.prevClicks)} to ${fmt(biggestQueryDrop.clicks)} (${signed(change(biggestQueryDrop.clicks, biggestQueryDrop.prevClicks))}) while the average position went from ${biggestQueryDrop.prevPosition} to ${biggestQueryDrop.position}.`,
            recommendation: 'Compare the ranking page against the current top results, refresh its content and check for recent template or internal-link changes.',
            evidence: { query: biggestQueryDrop.query, clicksPrevious: biggestQueryDrop.prevClicks, clicksCurrent: biggestQueryDrop.clicks, positionPrevious: biggestQueryDrop.prevPosition, positionCurrent: biggestQueryDrop.position, period },
        },
        {
            type: 'traffic_drop', category: 'Declining page', severity: change(declining.sessions, declining.prevSessions) < -0.1 ? 'high' : 'low', priority: 'medium', status: 'pending', agent: 'statistics_seo', days: 3,
            subject: `demo:page:${declining.path}`, title: `Weakest page trend: ${declining.path}`,
            summary: `${declining.path} had ${fmt(declining.sessions)} sessions in the last four weeks versus ${fmt(declining.prevSessions)} before (${signed(change(declining.sessions, declining.prevSessions))}).`,
            recommendation: 'Check which queries lost clicks for this page and whether its internal links or content changed recently.',
            evidence: { page: declining.path, sessionsCurrent: declining.sessions, sessionsPrevious: declining.prevSessions, change: signed(change(declining.sessions, declining.prevSessions)), period },
        },
        {
            type: 'ranking_opportunity', category: 'Ranking opportunity', severity: 'medium', priority: 'high', status: 'approved', agent: 'seo_manager', days: 6,
            subject: `demo:rank:${nearPageOne.query}`, title: `Near the top: “${nearPageOne.query}” averages position ${nearPageOne.position}`,
            summary: `${fmt(nearPageOne.impressions)} impressions at an average position of ${nearPageOne.position}. Moving into the top five usually multiplies clicks (estimate, not a forecast).`,
            recommendation: 'Strengthen the target page with a fuller answer, FAQ section and internal links from related service pages.',
            evidence: { query: nearPageOne.query, impressions: nearPageOne.impressions, clicks: nearPageOne.clicks, avgPosition: nearPageOne.position, period },
        },
        {
            type: 'technical_issue', category: 'Title & meta', severity: 'medium', priority: 'medium', status: 'pending', agent: 'technical_seo', days: 4,
            subject: 'demo:meta', title: `Missing meta descriptions on ${issue('missing_meta_description').count} pages`,
            summary: `The latest simulated audit (${a.audit.date}) found ${issue('missing_meta_description').count} of ${a.audit.pagesCrawled} pages without a meta description.`,
            recommendation: 'Write unique 140–155 character descriptions, starting with the highest-impression pages.',
            evidence: { pagesAffected: issue('missing_meta_description').count, pagesCrawled: a.audit.pagesCrawled, examples: issue('missing_meta_description').examples.join(', '), audit: `${a.audit.date} (simulated, no crawl ran)` },
        },
        {
            type: 'technical_issue', category: 'Title & meta', severity: issue('duplicate_title').count > 8 ? 'high' : 'medium', priority: issue('duplicate_title').count > 8 ? 'urgent' : 'medium', status: 'reviewed', agent: 'technical_seo', days: 5,
            subject: 'demo:titles', title: `Duplicate or missing title tags on ${issue('duplicate_title').count + issue('missing_title').count} pages`,
            summary: `${issue('duplicate_title').count} duplicate and ${issue('missing_title').count} missing title tags in the latest simulated audit.${spec.key === 'cms' ? ' The duplicates appeared after a simulated template update in week 10.' : ''}`,
            recommendation: 'Give every indexable page a unique, descriptive title under 60 characters.',
            evidence: { duplicateTitles: issue('duplicate_title').count, missingTitles: issue('missing_title').count, examples: issue('duplicate_title').examples.join(', '), audit: `${a.audit.date} (simulated)` },
        },
        {
            type: 'content_gap', category: 'Content improvement', severity: 'medium', priority: 'medium', status: 'pending', agent: 'content_seo', days: 7,
            subject: `demo:content:${bouncy.path}`, title: `Refresh content on ${bouncy.path}`,
            summary: `${bouncy.path} has the highest bounce rate on the site (${pct(bouncy.bounce)}) with ${fmt(bouncy.sessions)} sessions in the last four weeks.`,
            recommendation: 'Update the page with current examples, a clearer structure and a relevant next step for readers.',
            evidence: { page: bouncy.path, bounceRate: pct(bouncy.bounce), sessions: bouncy.sessions, period },
        },
        {
            type: 'content_gap', category: 'Internal linking', severity: 'medium', priority: 'low', status: 'dismissed', agent: 'technical_seo', days: 9,
            subject: 'demo:links', title: `${issue('orphan_pages').count} orphan pages and ${issue('low_internal_links').count} weakly linked pages`,
            summary: `The simulated audit found pages with no internal links pointing to them, and pages with fewer than three.`,
            recommendation: `Link to ${secondRank.query ? `the page targeting “${secondRank.query}”` : 'priority pages'} from related service pages and blog posts.`,
            evidence: { orphanPages: issue('orphan_pages').count, weaklyLinked: issue('low_internal_links').count, examples: issue('orphan_pages').examples.join(', '), audit: `${a.audit.date} (simulated)` },
        },
        {
            type: 'technical_issue', category: 'Technical warning', severity: issue('broken_internal_links').count > 2 ? 'high' : 'medium', priority: 'high', status: 'pending', agent: 'technical_seo', days: 2,
            subject: 'demo:broken', title: `${issue('broken_internal_links').count} pages with broken internal links`,
            summary: `Internal links returning 404 were found on ${issue('broken_internal_links').count} pages in the simulated audit.`,
            recommendation: 'Update or remove the broken links and add redirects where a page moved.',
            evidence: { pagesAffected: issue('broken_internal_links').count, examples: issue('broken_internal_links').examples.join(', '), audit: `${a.audit.date} (simulated)` },
        },
        {
            type: 'technical_issue', category: 'Mobile performance', severity: a.audit.lab.mobileLcpMs > 4000 ? 'high' : 'medium', priority: a.audit.lab.mobileLcpMs > 4000 ? 'urgent' : 'medium', status: 'approved', agent: 'web_development', days: 8,
            subject: 'demo:mobile', title: `Mobile LCP ${mobileLcp} s (simulated lab measurement)`,
            summary: `Mobile devices bring ${pct(a.mobileShare)} of sessions. Simulated lab LCP is ${mobileLcp} s on mobile vs ${(a.audit.lab.desktopLcpMs / 1000).toFixed(1)} s on desktop; ${issue('slow_mobile_lcp').count} pages exceed 2.5 s.`,
            recommendation: 'Compress and lazy-load hero images, preload the main font and defer non-critical scripts.',
            evidence: { mobileShare: pct(a.mobileShare), mobileLcp: `${mobileLcp} s (simulated lab)`, desktopLcp: `${(a.audit.lab.desktopLcpMs / 1000).toFixed(1)} s (simulated lab)`, slowPages: issue('slow_mobile_lcp').count, cls: a.audit.lab.cls },
        },
        {
            type: 'conversion_gap', category: 'Conversion', severity: 'low', priority: 'low', status: 'pending', agent: 'web_design', days: 10,
            subject: `demo:conv:${weakConv.path}`, title: `${weakConv.path} gets traffic but few key events`,
            summary: `${fmt(weakConv.sessions)} sessions and ${fmt(weakConv.conversions)} key events in the last four weeks (${pct(weakConv.conversions / (weakConv.sessions || 1), 2)}).`,
            recommendation: 'Add a relevant call to action and a short enquiry form near the end of the page.',
            evidence: { page: weakConv.path, sessions: weakConv.sessions, keyEvents: weakConv.conversions, rate: pct(weakConv.conversions / (weakConv.sessions || 1), 2), period },
        },
        {
            type: 'ranking_opportunity', category: 'Ranking opportunity', severity: 'low', priority: 'medium', status: 'pending', agent: 'content_seo', days: 11,
            subject: `demo:rank2:${secondRank.query}`, title: `Content brief needed for “${secondRank.query}”`,
            summary: `Average position ${secondRank.position} with ${fmt(secondRank.impressions)} impressions; the ranking page does not target the query directly.`,
            recommendation: 'Draft a content brief covering the main questions searchers ask, then link it from the closest service page.',
            evidence: { query: secondRank.query, impressions: secondRank.impressions, avgPosition: secondRank.position, period },
        },
    ];

    const seoInsights: T.SeoInsight[] = defs.map((d, i) => {
        const { agent, days, ...rest } = d;
        const decided = rest.status !== 'pending';
        return {
            id: `${P}ins_${i + 1}`, ...base, ...rest, source: 'rules', assignedAgentId: agents[agent].id, taskId: null, simulated: true,
            reviewedBy: decided ? ADMIN : null, reviewedAt: decided ? ago(Math.max(0, days - 1), 15) : null,
            reviewNotes: rest.status === 'dismissed' ? 'Demo: parked until the title fixes ship.' : rest.status === 'approved' ? 'Demo: approved for this sprint.' : null,
            createdAt: ago(days, 8),
        };
    });

    const project: T.Project = {
        id: `${P}prj`, brandId, name: `${spec.name} SEO improvement sprint (demo)`,
        description: `Simulated VCA sprint for ${spec.name}. ${spec.storyText} All tasks, owners and approvals are demonstration records; nothing runs against a live website.`,
        status: 'active', websiteId: website.id, clientVisible: true, createdAt: ago(14),
    };
    const T6 = (k: T.AgentTemplateKey): T.Assignee => ({ type: 'agent', agentInstanceId: agents[k].id });
    const taskDefs: Array<{ title: string; description: string; status: T.TaskStatus; priority: T.TaskPriority; assignee: T.Assignee; due: number; insight?: number }> = [
        { title: 'Audit title tags', description: `Fix the duplicate and missing titles listed in the simulated audit (${issue('duplicate_title').count + issue('missing_title').count} pages).`, status: 'in_progress', priority: 'high', assignee: T6('technical_seo'), due: 4, insight: 6 },
        { title: 'Improve low-CTR landing pages', description: `Rewrite snippets for “${lowCtr.query}” and similar queries (CTR ${pct(lowCtr.ctr, 2)}).`, status: 'todo', priority: 'high', assignee: T6('content_seo'), due: 6, insight: 1 },
        { title: 'Review internal links', description: 'Link orphan and weakly linked pages from related service pages; fix broken links.', status: 'review', priority: 'medium', assignee: T6('technical_seo'), due: 3, insight: 9 },
        { title: 'Inspect mobile performance', description: `Investigate the ${mobileLcp} s simulated mobile LCP and propose fixes.`, status: spec.key === 'hldc' ? 'blocked' : 'todo', priority: spec.key === 'hldc' ? 'urgent' : 'medium', assignee: T6('web_development'), due: 7, insight: 10 },
        { title: 'Update content briefs', description: `Briefs for “${secondRank.query}” and ${bouncy.path}.`, status: 'done', priority: 'medium', assignee: T6('content_seo'), due: -2, insight: 12 },
        { title: 'Verify GSC indexing', description: 'Check that key service pages are indexed (simulated: no Search Console request is made in the demo).', status: 'done', priority: 'medium', assignee: T6('technical_seo'), due: -4 },
        { title: 'Prepare monthly SEO report', description: `Monthly report for ${spec.name}, ${a.cur.from} to ${a.cur.to}, from the Reports page (marked as demo data).`, status: 'in_progress', priority: 'medium', assignee: { type: 'user', userId: ADMIN }, due: 8 },
        { title: 'Review conversion performance', description: `Key events fell or rose ${signed(change(a.cur.keyEvents, a.prev.keyEvents))} vs the previous 28 days; review ${weakConv.path}.`, status: 'todo', priority: 'low', assignee: T6('statistics_seo'), due: 10, insight: 11 },
    ];
    const tasks: T.Task[] = taskDefs.map((t, i) => ({
        id: `${P}tsk_${i + 1}`, brandId, projectId: project.id, title: t.title, description: t.description, status: t.status, priority: t.priority, assignee: t.assignee,
        createdBy: i % 2 ? { type: 'agent', agentInstanceId: agents.seo_manager.id } : { type: 'user', userId: ADMIN }, sourceMessageId: null,
        dueDate: addDays(VCA_DEMO_END, t.due), insightId: t.insight ? `${P}ins_${t.insight}` : null, createdAt: ago(13 - i, 10), updatedAt: ago(Math.max(0, 6 - i), 16),
    }));
    for (const t of tasks) if (t.insightId) seoInsights.find((s) => s.id === t.insightId)!.taskId = t.id;

    const taskComments: T.TaskComment[] = [
        { id: `${P}tcm_1`, brandId, taskId: tasks[4]!.id, authorId: ADMIN, body: 'Briefs reviewed and approved (demo record).', createdAt: ago(2, 14) },
        { id: `${P}tcm_2`, brandId, taskId: tasks[5]!.id, authorId: ADMIN, body: 'Marked done. In the demo no Search Console request was made; with a live connection this check uses the URL Inspection data.', createdAt: ago(4, 11) },
        { id: `${P}tcm_3`, brandId, taskId: tasks[0]!.id, authorId: ADMIN, body: 'Started with the service pages. Remaining pages next week.', createdAt: ago(1, 10) },
    ];
    if (spec.key === 'hldc') taskComments.push({ id: `${P}tcm_4`, brandId, taskId: tasks[3]!.id, authorId: ADMIN, body: 'Blocked: waiting for hosting access to enable image compression (simulated).', createdAt: ago(1, 15) });

    const payload = (effect: string) => ({ simulated: 'true', website: website.domain ?? '', effect: `${effect} Demo approval: deciding it records a decision only; no external operation runs.` });
    const approvals: T.ApprovalRequest[] = [
        {
            id: `${P}apr_1`, brandId, kind: 'publish_content', title: 'Publish rewritten title tags and meta descriptions (simulated)',
            summary: `New titles and descriptions for ${issue('duplicate_title').count + issue('missing_meta_description').count} pages are ready for review.`,
            payload: payload('Would publish SEO title/meta updates.'), requestedBy: { type: 'agent', agentInstanceId: agents.technical_seo.id }, status: 'pending',
            decidedBy: null, decidedAt: null, decisionNote: null, taskId: tasks[0]!.id, executionId: `${P}exe_std_2`, createdAt: ago(1, 12), simulated: true,
        },
        {
            id: `${P}apr_2`, brandId, kind: 'deploy_change', title: 'Deploy internal-link updates to staging (simulated)',
            summary: 'Add links from service pages to orphan pages on the staging site first.',
            payload: payload('Would deploy to staging only.'), requestedBy: { type: 'agent', agentInstanceId: agents.web_development.id }, status: 'approved',
            decidedBy: ADMIN, decidedAt: ago(3, 16), decisionNote: 'Approved for staging (demo).', taskId: tasks[2]!.id, executionId: null, createdAt: ago(4, 9), simulated: true,
        },
        {
            id: `${P}apr_3`, brandId, kind: 'external_action', title: 'Request re-indexing in Search Console (simulated)',
            summary: 'Ask Search Console to recrawl the updated service pages.',
            payload: payload('Would submit URLs for indexing.'), requestedBy: { type: 'agent', agentInstanceId: agents.seo_manager.id }, status: 'rejected',
            decidedBy: ADMIN, decidedAt: ago(2, 11), decisionNote: 'Wait until the title fixes ship (demo).', taskId: null, executionId: null, createdAt: ago(3, 10), simulated: true,
        },
    ];
    return { seoInsights, projects: [project], tasks, approvals, taskComments };
}

// ── conversations and execution history ───────────────────────────────────

function buildConversations(ctx: DemoContext, P: string, a: DemoAnalysis, tasks: T.Task[], approvals: T.ApprovalRequest[]) {
    const { spec, brandId, website, agents } = ctx;
    const rand = mulberry32(hashString(`${VCA_DEMO_SET}:${spec.key}:chat`));
    const conversations: T.Conversation[] = [];
    const messages: T.Message[] = [];
    const executions: T.AgentExecution[] = [];
    const ag = (k: T.AgentTemplateKey) => agents[k];
    const label = `Simulated demo response for ${spec.name} (${website.domain}); computed from the synthetic dataset, not a live AI model.`;
    let seq = 0;

    const exec = (agent: T.AgentInstance, convId: string | null, trigger: string | null, startedAt: string, parent: string | null = null, depth = 0): T.AgentExecution => {
        const id = `${P}exe_${++seq}`;
        const ms = 1200 + Math.round(rand() * 4800);
        const e: T.AgentExecution = {
            id, brandId, agentInstanceId: agent.id, conversationId: convId, triggerMessageId: trigger, parentExecutionId: parent, handoffDepth: depth, status: 'succeeded', mode: 'simulated',
            provider: 'simulated', model: SIM_MODEL, instructionVersion: 1, inputTokens: 1400 + Math.round(rand() * 2800), outputTokens: 280 + Math.round(rand() * 640), costUsd: 0, error: null,
            connectionId: SIM_CONNECTION, startedAt, finishedAt: new Date(Date.parse(startedAt) + ms).toISOString(),
        };
        executions.push(e);
        return e;
    };

    const conv = (i: number, kind: T.ConversationKind, title: string, members: T.AgentTemplateKey[], team: T.TeamKey | null, days: number, visibility: T.ConversationVisibility, turns: Array<{ who: 'user' | T.AgentTemplateKey; body: string; proposals?: T.Proposal[]; parent?: number }>) => {
        const id = `${P}cnv_${i}`;
        const start = ago(days, 9, 5);
        let t = Date.parse(start);
        let lastUser: string | null = null;
        const execByTurn: string[] = [];
        turns.forEach((turn, j) => {
            t += (turn.who === 'user' ? 4 : 1) * 60_000 + Math.round(rand() * 50_000);
            const mid = `${id}_m${j}`;
            const createdAt = new Date(t).toISOString();
            if (turn.who === 'user') {
                const mentions = [...turn.body.matchAll(/@([a-z-]+)/g)].map((x) => Object.values(agents).find((g) => g.handle === x[1])?.id).filter((x): x is string => !!x);
                messages.push({ id: mid, brandId, conversationId: id, author: { type: 'user', userId: ADMIN }, body: turn.body, mentions, attachments: [], status: 'sent', executionId: null, mode: null, proposals: [], replyToId: null, createdAt });
                lastUser = mid;
                execByTurn.push('');
            } else {
                const parent = turn.parent !== undefined ? execByTurn[turn.parent] || null : null;
                const e = exec(ag(turn.who), id, lastUser, new Date(t - 3000).toISOString(), parent, parent ? 1 : 0);
                execByTurn.push(e.id);
                messages.push({ id: mid, brandId, conversationId: id, author: { type: 'agent', agentInstanceId: ag(turn.who).id }, body: `${turn.body}\n\n_${label}_`, mentions: [], attachments: [], status: 'sent', executionId: e.id, mode: 'simulated', proposals: turn.proposals ?? [], replyToId: lastUser, createdAt });
            }
        });
        conversations.push({ id, brandId, kind, title, agentInstanceIds: members.map((k) => ag(k).id), teamKey: team, websiteId: website.id, visibility, createdBy: ADMIN, archived: false, summary: `Simulated demo conversation (${spec.name}).`, createdAt: start, updatedAt: new Date(t).toISOString() });
    };

    const d = { s: change(a.cur.sessions, a.prev.sessions), c: change(a.cur.clicks, a.prev.clicks), i: change(a.cur.impressions, a.prev.impressions), k: change(a.cur.keyEvents, a.prev.keyEvents) };
    const ctrC = a.cur.clicks / a.cur.impressions, ctrP = a.prev.clicks / a.prev.impressions;
    const movers = [...a.queries].sort((x, y) => (x.clicks - x.prevClicks) - (y.clicks - y.prevClicks));
    const losers = movers.slice(0, 3).filter((q) => q.clicks < q.prevClicks);
    const gainers = movers.slice(-2).reverse().filter((q) => q.clicks > q.prevClicks);
    const lowCtr = [...a.queries].filter((q) => q.ctr < 0.025).sort((x, y) => y.impressions - x.impressions);
    const score = healthScore(a.audit.issues, a.audit.pagesCrawled);
    const direction = d.c < -0.03 ? 'declined' : d.c > 0.03 ? 'grew' : 'held roughly steady';
    const list = (qs: QueryAgg[]) => qs.map((q) => `- “${q.query}”: ${fmt(q.prevClicks)} → ${fmt(q.clicks)} clicks, avg. position ${q.prevPosition} → ${q.position}`).join('\n');
    const visibility: T.ConversationVisibility = ag('seo_manager').clientFacing ? 'client_shared' : 'agency_internal';
    const proposal = (n: number, action: T.Proposal['action'], status: T.ProposalStatus, resultId: string | null = null): T.Proposal => ({ id: `${P}prp_${n}`, action, status, resultId });

    conv(1, 'direct', `Why did ${spec.name} organic clicks change this month? (demo)`, ['seo_manager'], null, 3, visibility, [
        { who: 'user', body: `Why did ${spec.name} organic clicks ${spec.story === 'decline' ? 'decline' : 'change'} this month?` },
        {
            who: 'seo_manager',
            body: [
                `Organic clicks ${direction}: ${fmt(a.cur.clicks)} in ${a.cur.from} to ${a.cur.to} versus ${fmt(a.prev.clicks)} in the previous 28 days (${signed(d.c)}). Impressions ${signed(d.i)}, CTR ${pct(ctrC, 2)} vs ${pct(ctrP, 2)}, average position ${a.prev.position} → ${a.cur.position} (an average across queries, not a live ranking).`,
                losers.length ? `Queries that lost the most clicks:\n${list(losers)}` : `No query lost clicks materially.${gainers.length ? `\nBiggest gains:\n${list(gainers)}` : ''}`,
                spec.storyText,
                'I propose two tasks: refresh the affected pages and fix the title tags flagged in the audit.',
            ].join('\n\n'),
            proposals: [
                proposal(1, { type: 'create_task', title: 'Audit title tags', description: 'Fix duplicate and missing titles from the simulated audit.', priority: 'high' }, 'applied', tasks[0]!.id),
                proposal(2, { type: 'create_task', title: 'Improve low-CTR landing pages', description: 'Rewrite snippets for high-impression, low-CTR queries.', priority: 'high' }, 'applied', tasks[1]!.id),
            ],
        },
        { who: 'user', body: 'Thanks. Which pages should we look at first?' },
        { who: 'seo_manager', body: `Start with ${a.pages.slice().sort((x, y) => change(x.sessions, x.prevSessions) - change(y.sessions, y.prevSessions))[0]!.path} (largest session change) and the page ranking for “${(losers[0] ?? lowCtr[0] ?? a.queries[0]!).query}”. @technical-seo can confirm whether the audit findings touch those pages.` },
    ]);

    conv(2, 'direct', `Simulated crawl review: ${spec.name} (demo)`, ['technical_seo'], null, 4, 'agency_internal', [
        { who: 'user', body: 'Summarise the latest crawl findings and what is driving the health score.' },
        {
            who: 'technical_seo',
            body: [
                `Simulated audit of ${a.audit.pagesCrawled} pages on ${a.audit.date}: health score ${score.score}/100. No real crawl ran; these are demo findings.`,
                `Largest deductions:\n${score.lines.slice(0, 4).map((l) => `- ${l.label}: ${l.count} pages (−${l.deduction} pts)`).join('\n')}`,
                `How the score works: ${score.formula}`,
            ].join('\n\n'),
            proposals: [proposal(3, { type: 'create_task', title: 'Review internal links', description: 'Fix broken links and link orphan pages.', priority: 'medium' }, 'applied', tasks[2]!.id)],
        },
    ]);

    conv(3, 'direct', `Content priorities from search queries: ${spec.name} (demo)`, ['content_seo'], null, 5, 'agency_internal', [
        { who: 'user', body: `Which content should we improve first based on the ${spec.name} queries?` },
        {
            who: 'content_seo',
            body: [
                `Themes for this demo client: ${spec.themes}`,
                lowCtr.length ? `High impressions but low CTR (last four weeks):\n${lowCtr.slice(0, 3).map((q) => `- “${q.query}”: ${fmt(q.impressions)} impressions, CTR ${pct(q.ctr, 2)}, avg. position ${q.position}`).join('\n')}` : 'No query is below a 2.5% CTR.',
                'Suggested order: rewrite the snippet of the top low-CTR page, then expand the guide content that ranks between positions 8 and 15. Search volumes and keyword difficulty are not available in the demo and are not estimated.',
            ].join('\n\n'),
            proposals: [proposal(4, { type: 'create_task', title: 'Update content briefs', description: 'Briefs for the queries above.', priority: 'medium' }, 'applied', tasks[4]!.id)],
        },
    ]);

    const win = (n: number) => `last ${n} days`;
    conv(4, 'direct', `Period comparison: ${spec.name} (demo)`, ['statistics_seo'], null, 2, 'agency_internal', [
        { who: 'user', body: 'Compare the last 28 days with the previous period and tell me what is significant.' },
        {
            who: 'statistics_seo',
            body: [
                `Comparison of the ${win(28)} (${a.cur.from} to ${a.cur.to}) with the 28 days before:`,
                `- GA4 sessions: ${fmt(a.cur.sessions)} vs ${fmt(a.prev.sessions)} (${signed(d.s)})`,
                `- GA4 key events: ${fmt(a.cur.keyEvents)} vs ${fmt(a.prev.keyEvents)} (${signed(d.k)})`,
                `- GA4 engagement rate: ${pct(a.cur.engaged / a.cur.sessions)} vs ${pct(a.prev.engaged / a.prev.sessions)}`,
                `- GSC clicks: ${fmt(a.cur.clicks)} vs ${fmt(a.prev.clicks)} (${signed(d.c)})`,
                `- GSC impressions: ${fmt(a.cur.impressions)} vs ${fmt(a.prev.impressions)} (${signed(d.i)})`,
                'GA4 sessions and GSC clicks are different measurements and are not added together. Changes under about 5% are within normal weekly variation for this dataset.',
            ].join('\n'),
        },
    ]);

    conv(5, 'direct', `Mobile layout review: ${spec.name} (demo)`, ['web_design'], null, 6, 'agency_internal', [
        { who: 'user', body: 'Are there design changes that would help mobile visitors?' },
        { who: 'web_design', body: `Mobile brings ${pct(a.mobileShare)} of sessions. In the simulated audit, mobile LCP is ${(a.audit.lab.mobileLcpMs / 1000).toFixed(1)} s and CLS ${a.audit.lab.cls}. I would simplify the hero (one image, sized for mobile), keep the primary call to action above the fold and reserve space for images to avoid layout shifts. Mock-ups would go through the Web Studio review flow before any change.` },
    ]);

    conv(6, 'direct', `Performance plan: ${spec.name} (demo)`, ['web_development'], null, 6, 'agency_internal', [
        { who: 'user', body: 'What would you change technically to improve page speed?' },
        { who: 'web_development', body: `Plan (no change has been made to any website): 1) serve responsive WebP images and lazy-load below-the-fold media (${a.audit.issues.find((i) => i.code === 'large_images')!.count} oversized images in the simulated audit); 2) preload the main font; 3) defer non-critical scripts; 4) re-measure in the next audit. Deployment would need an approved request.` },
    ]);

    conv(7, 'group', `SEO team: weekly sprint plan for ${spec.name} (demo)`, ['seo_manager', 'technical_seo', 'content_seo', 'statistics_seo'], 'seo', 2, 'agency_internal', [
        { who: 'user', body: `@seo-manager please plan this week's SEO sprint for ${spec.name}.` },
        {
            who: 'seo_manager',
            body: `Plan: I am delegating the analysis. @technical-seo: confirm the title and link issues. @content-seo: pick the snippets to rewrite. @statistics-seo: check whether the ${signed(d.c)} click change is beyond normal variation.`,
            proposals: [
                proposal(5, { type: 'delegate', handle: 'technical-seo', brief: 'Confirm title and link issues from the simulated audit.' }, 'applied', `${P}cnv_7_m2`),
                proposal(6, { type: 'delegate', handle: 'content-seo', brief: 'Choose snippets to rewrite.' }, 'applied', `${P}cnv_7_m3`),
                proposal(7, { type: 'delegate', handle: 'statistics-seo', brief: 'Test the click change against weekly variation.' }, 'applied', `${P}cnv_7_m4`),
            ],
        },
        { who: 'technical_seo', parent: 1, body: `Confirmed from the simulated audit: ${a.audit.issues.find((i) => i.code === 'duplicate_title')!.count} duplicate titles, ${a.audit.issues.find((i) => i.code === 'broken_internal_links')!.count} pages with broken links. Health score ${score.score}/100.` },
        { who: 'content_seo', parent: 1, body: `Rewrite first: ${(lowCtr[0] ?? a.queries[0]!).query}${lowCtr[1] ? ` and ${lowCtr[1].query}` : ''}. Drafts will be attached to the task for human review.` },
        { who: 'statistics_seo', parent: 1, body: `The click change of ${signed(d.c)} ${Math.abs(d.c) > 0.08 ? 'is larger than the usual week-to-week range and is worth acting on' : 'is within normal variation; keep monitoring'}.` },
        {
            who: 'seo_manager',
            body: 'Summary: fix titles and links first, then the snippets. I have requested approval to publish the title and meta updates once drafted; nothing is published without a human decision.',
            proposals: [proposal(8, { type: 'request_approval', kind: 'publish_content', title: approvals[0]!.title, summary: approvals[0]!.summary }, 'applied', approvals[0]!.id)],
        },
        { who: 'user', body: 'Approved the plan. Hold any re-indexing request until the fixes ship.' },
    ]);

    conv(8, 'group', `Web team: mobile hero and image weight for ${spec.name} (demo)`, ['web_design', 'web_development'], 'web', 5, 'agency_internal', [
        { who: 'user', body: 'Web team, agree on a fix for the slow mobile hero section.' },
        { who: 'web_design', body: 'Design proposal: replace the hero slider with a single static image and a shorter headline; keep the call to action visible without scrolling. Handing over to @web-development for feasibility.' },
        { who: 'web_development', parent: 1, body: `Feasible. A single 1200 px WebP hero (~120 KB) should bring the simulated mobile LCP from ${(a.audit.lab.mobileLcpMs / 1000).toFixed(1)} s towards 2.5 s. I will prepare it on staging only, behind an approval.`, proposals: [proposal(9, { type: 'request_approval', kind: 'deploy_change', title: approvals[1]!.title, summary: approvals[1]!.summary }, 'applied', approvals[1]!.id)] },
        { who: 'user', body: 'Good. Staging only for now.' },
    ]);

    conv(9, 'group', `Cross-team: improving ${a.pages[1]!.path} (demo)`, ['seo_manager', 'content_seo', 'web_design', 'web_development'], 'all', 1, 'agency_internal', [
        { who: 'user', body: `SEO and Web teams: how do we improve ${a.pages[1]!.path} together?` },
        { who: 'seo_manager', body: `SEO view: the page earns ${fmt(a.pages[1]!.sessions)} sessions in four weeks with ${fmt(a.pages[1]!.conversions)} key events. @content-seo will tighten the copy for its main query; @web-design will review the layout.` },
        { who: 'content_seo', parent: 1, body: 'Content: a clearer H1, an FAQ block with three common questions and a stronger meta description.' },
        { who: 'web_design', parent: 1, body: 'Design: move the enquiry form higher and add trust signals near it. Mock-up ready for review.' },
        { who: 'web_development', parent: 1, body: 'Development: the FAQ block can use FAQ structured data. Changes go to staging first and need approval for production.', proposals: [proposal(10, { type: 'create_task', title: `Implement FAQ block on ${a.pages[1]!.path}`, description: 'Staging only; production after approval.', priority: 'medium' }, 'proposed')] },
        { who: 'user', body: 'Please hold the production change for human review next week.' },
    ]);

    // Standalone execution history (no conversation).
    const kinds: Array<[T.AgentTemplateKey, number]> = [['seo_manager', 12], ['technical_seo', 1], ['content_seo', 9], ['statistics_seo', 3], ['seo_manager', 0]];
    kinds.forEach(([k, days], i) => {
        const e = exec(ag(k), null, null, ago(days, 7, 30 + i));
        e.id = `${P}exe_std_${i + 1}`;
    });
    // One limited run to show how budget limits look (simulated).
    Object.assign(exec(ag('content_seo'), null, null, ago(8, 13)), { id: `${P}exe_std_6`, status: 'limited', outputTokens: 0, error: 'Simulated: daily token limit for this agent reached; run skipped.' });
    return { conversations, messages, executions };
}

// ── knowledge ─────────────────────────────────────────────────────────────

function buildKnowledge(ctx: DemoContext, P: string) {
    const { spec, brandId, website } = ctx;
    const docs: Array<{ title: string; kind: T.KnowledgeKind; tags: string[]; content: string }> = [
        {
            title: 'VCA agency SEO guidelines (demo)', kind: 'seo_policy', tags: ['demo', 'guidelines', 'vca'],
            content: `Demo knowledge document. VCA SEO guidelines used by the demo agents.\n\nEvery recommendation must cite the data it comes from: GA4 for on-site behaviour, Search Console for search performance, and the site audit for technical findings. GA4 sessions and Search Console clicks are reported separately and never added together.\n\nAverage position is an average across queries and days. Do not present it as a live ranking.\n\nNo change is published to a client website without an approved request. Agents propose; people decide.`,
        },
        {
            title: 'Construction marketing content brief template (demo)', kind: 'note', tags: ['demo', 'content', 'construction'],
            content: `Demo knowledge document. Content brief template for construction and home-improvement clients.\n\n1. Search intent: what the searcher is trying to do (hire, compare, estimate cost, learn).\n2. Target query and related questions, taken from Search Console data only; no invented search volumes.\n3. Proof: project photos, licences, warranties and reviews the client has supplied.\n4. Structure: H1, short answer, detail sections, FAQ, call to action.\n5. Internal links: from and to the closest service pages.`,
        },
        {
            title: 'Technical SEO checklist (demo)', kind: 'seo_policy', tags: ['demo', 'technical', 'checklist'],
            content: `Demo knowledge document. Monthly technical checklist.\n\n- Unique title (under 60 characters) and meta description on every indexable page.\n- One H1 per page.\n- No broken internal links; redirect chains collapsed to one hop.\n- Canonicals point to the page itself unless intentionally consolidated.\n- Mobile LCP under 2.5 s, CLS under 0.1, INP under 200 ms (lab values in the demo are simulated).\n- Structured data where it matches visible content.`,
        },
        {
            title: 'Monthly reporting standards (demo)', kind: 'note', tags: ['demo', 'reporting'],
            content: `Demo knowledge document. Monthly client reports compare the last 28 days with the previous 28 days and state the exact date range and data sources.\n\nEvery demo export carries a SIMULATED DEMO DATA notice. Executive summaries describe changes in plain language and link each recommendation to a task.`,
        },
        {
            title: `${spec.name} brand notes for the demo`, kind: 'brand_guide', tags: ['demo', spec.key],
            content: `Demo knowledge document for ${spec.name} (${website.domain}, a reserved demonstration domain).\n\nKeyword themes in the demo: ${spec.themes}\n\nDemo storyline: ${spec.storyText}\n\nThis document contains no real facts about the company; it only describes the synthetic demo dataset.`,
        },
    ];
    const knowledgeDocuments: T.KnowledgeDocument[] = docs.map((d, i) => ({
        id: `${P}kdoc_${i + 1}`, brandId, title: d.title, kind: d.kind, content: d.content, tags: d.tags, sizeBytes: new TextEncoder().encode(d.content).length, createdBy: ADMIN, createdAt: ago(20 - i), updatedAt: ago(20 - i),
    }));
    const knowledgeChunks: T.KnowledgeChunk[] = knowledgeDocuments.flatMap((doc) => chunkText(doc.content).map((text, index) => ({ id: `${doc.id}_c${index}`, brandId, documentId: doc.id, index, text })));
    return { knowledgeDocuments, knowledgeChunks };
}

// ── apply / reset ─────────────────────────────────────────────────────────

const stepId = (key: VcaDemoKey) => `${VCA_DEMO_SET}:${key}`;

/** Resolve a client's demo context from current data, or null when its records are missing (never created here). */
export function demoContext(s: Pick<DbSnapshot, 'agencies' | 'brands' | 'websites' | 'agentInstances'>, spec: ClientSpec): DemoContext | null {
    const agency = s.agencies.find((x) => x.slug === 'vca');
    if (!agency) return null;
    const brand = s.brands.find((b) => b.agencyId === agency.id && b.slug === spec.slug && b.status !== 'archived');
    if (!brand) return null;
    const sites = s.websites.filter((w) => w.brandId === brand.id && w.isDemo && w.status !== 'archived');
    const website = sites.find((w) => w.environment === 'production');
    if (!website || !website.domain?.endsWith('.example')) return null;
    const agents = {} as Record<T.AgentTemplateKey, T.AgentInstance>;
    for (const a of s.agentInstances) if (a.brandId === brand.id) agents[a.templateKey] = a;
    const needed: T.AgentTemplateKey[] = ['seo_manager', 'technical_seo', 'content_seo', 'statistics_seo', 'web_design', 'web_development'];
    if (needed.some((k) => !agents[k])) return null;
    return { spec, brandId: brand.id, website, staging: sites.find((w) => w.environment === 'staging') ?? null, agents };
}

/** Snapshot-level, idempotent: adds each client's demo rows once (sample seed / stored-data upgrade). */
export function applyVcaDemo(s: DbSnapshot): DbSnapshot {
    for (const spec of VCA_DEMO_CLIENTS) {
        if (s.seedSteps.some((x) => x.id === stepId(spec.key))) continue;
        const ctx = demoContext(s, spec);
        if (!ctx) continue;
        const rows = buildVcaDemoRows(ctx);
        for (const [table, list] of Object.entries(rows) as Array<[TableName, Array<{ id: string }>]>) {
            const existing = new Set((s[table] as Array<{ id: string }>).map((r) => r.id));
            (s[table] as Array<{ id: string }>).push(...list.filter((r) => !existing.has(r.id)));
        }
        s.seedSteps.push({ id: stepId(spec.key), appliedAt: `${VCA_DEMO_END}T00:00:00.000Z` });
    }
    return s;
}

export const isDemoRowId = (id: string, key?: VcaDemoKey) => (key ? id.startsWith(`vd_${key}_`) : /^vd_(cms|lipsky|hldc|loop19)_/.test(id));

export function demoSpecForBrand(s: Pick<DbSnapshot, 'agencies' | 'brands'>, brandId: string): ClientSpec | null {
    const brand = s.brands.find((b) => b.id === brandId);
    const agency = brand && s.agencies.find((a) => a.id === brand.agencyId);
    if (!brand || agency?.slug !== 'vca') return null;
    return VCA_DEMO_CLIENTS.find((c) => c.slug === brand.slug) ?? null;
}

/**
 * Restore one client's demo records: deletes only rows whose id is owned by the demo dataset
 * (`vd_<key>_…`) in that client, then re-creates them. User-created rows are untouched.
 */
export function resetVcaDemo(db: LocalDatabase, brandId: string): { removed: number; created: number } {
    const snap = { agencies: db.all('agencies') as T.Agency[], brands: db.all('brands') as T.Brand[], websites: db.all('websites') as T.Website[], agentInstances: db.all('agentInstances') as T.AgentInstance[] };
    const spec = demoSpecForBrand(snap, brandId);
    if (!spec) return { removed: 0, created: 0 };
    let removed = 0;
    for (const table of Object.keys(db.snapshot()) as TableName[]) {
        if (table === 'seedSteps') continue;
        removed += db.delete(table, (r) => (r as { id?: string; brandId?: string }).brandId === brandId && isDemoRowId((r as { id: string }).id, spec.key));
    }
    const ctx = demoContext(snap, spec);
    if (!ctx) return { removed, created: 0 };
    const rows = buildVcaDemoRows(ctx);
    let created = 0;
    for (const [table, list] of Object.entries(rows) as Array<[TableName, never[]]>) {
        if (!list.length) continue;
        db.insertMany(table, structuredClone(list));
        created += list.length;
    }
    if (!db.all('seedSteps').some((x) => x.id === stepId(spec.key))) db.insert('seedSteps', { id: stepId(spec.key), appliedAt: db.nowIso() });
    return { removed, created };
}

/** Summary of demo-owned rows for a client (used by the UI and tests). */
export function demoRowCounts(rows: Partial<Record<TableName, ReadonlyArray<{ id?: string; brandId?: string | null }>>>, brandId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [t, list] of Object.entries(rows)) {
        const n = (list ?? []).filter((r) => r.brandId === brandId && !!r.id && isDemoRowId(r.id)).length;
        if (n) out[t] = n;
    }
    return out;
}

export const VCA_DEMO_START = START;
