/**
 * Google Search Console connector (Search Analytics). Read-only.
 * Average position is an aggregate, not a live ranking. No search volumes or keyword difficulty
 * exist in this API and none are produced.
 */
import { googleApi, type DateRange } from './google.ts';
import { IntegrationError } from './types.ts';

export interface GscSite { siteUrl: string; permissionLevel: string; kind: 'domain' | 'url_prefix' }
export const GSC_DIMENSIONS = ['total', 'query', 'page', 'country', 'device', 'searchAppearance'] as const;
export type GscDimension = (typeof GSC_DIMENSIONS)[number];

export interface GscRow {
    date: string;
    dimension: GscDimension;
    dimensionValue: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    dataState: 'final' | 'fresh';
}

export async function listGscSites(fetchFn: typeof fetch, accessToken: string): Promise<GscSite[]> {
    const r = await googleApi<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>(fetchFn, accessToken, 'https://www.googleapis.com/webmasters/v3/sites');
    return (r.siteEntry ?? [])
        .filter((s): s is { siteUrl: string; permissionLevel: string } => typeof s.siteUrl === 'string' && typeof s.permissionLevel === 'string' && s.permissionLevel !== 'siteUnverifiedUser')
        .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel, kind: s.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix' }));
}

/**
 * Does a Search Console property cover this website? Never by display name:
 *  - domain property sc-domain:example.com covers example.com and every subdomain, any scheme;
 *  - URL-prefix property must match scheme + exact host and be a path prefix of the website URL.
 */
export function propertyCoversWebsite(siteUrl: string, websiteUrl: string): boolean {
    let w: URL;
    try { w = new URL(websiteUrl); } catch { return false; }
    const host = w.hostname.toLowerCase();
    if (siteUrl.startsWith('sc-domain:')) {
        const d = siteUrl.slice('sc-domain:'.length).toLowerCase().replace(/\.$/, '');
        return !!d && (host === d || host.endsWith(`.${d}`));
    }
    let p: URL;
    try { p = new URL(siteUrl); } catch { return false; }
    if (p.protocol !== w.protocol || p.hostname.toLowerCase() !== host || p.port !== w.port) return false;
    const prefix = p.pathname.endsWith('/') ? p.pathname : `${p.pathname}/`;
    const path = w.pathname.endsWith('/') ? w.pathname : `${w.pathname}/`;
    return path.startsWith(prefix);
}

export async function verifyGscProperty(fetchFn: typeof fetch, accessToken: string, siteUrl: string, websiteUrl: string): Promise<GscSite> {
    const site = (await listGscSites(fetchFn, accessToken)).find((s) => s.siteUrl === siteUrl);
    if (!site) throw new IntegrationError('permission_denied', 'The connected Google account has no verified access to this Search Console property.');
    if (!propertyCoversWebsite(siteUrl, websiteUrl)) throw new IntegrationError('site_mismatch', 'This Search Console property does not cover the website URL.');
    return site;
}

export async function querySearchAnalytics(fetchFn: typeof fetch, accessToken: string, siteUrl: string, range: DateRange, dimension: GscDimension, o: { maxRows?: number } = {}): Promise<{ rows: GscRow[]; truncated: boolean; firstIncompleteDate: string | null }> {
    const rowLimit = 25_000;
    const maxRows = Math.min(o.maxRows ?? 100_000, 500_000);
    const out = new Map<string, GscRow>();
    let firstIncomplete: string | null = null;
    for (let startRow = 0; ; startRow += rowLimit) {
        const r = await googleApi<{ rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>; metadata?: { first_incomplete_date?: string } }>(
            fetchFn, accessToken, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
            { method: 'POST', body: { startDate: range.from, endDate: range.to, dimensions: ['date', ...(dimension === 'total' ? [] : [dimension])], type: 'web', dataState: 'all', rowLimit, startRow } },
        );
        firstIncomplete ??= r.metadata?.first_incomplete_date ?? null;
        for (const row of r.rows ?? []) {
            const [date, value = ''] = row.keys ?? [];
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            if (![row.clicks, row.impressions, row.ctr, row.position].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
            out.set(`${date}|${value}`, {
                date, dimension, dimensionValue: value.slice(0, 2048),
                clicks: row.clicks!, impressions: row.impressions!, ctr: row.ctr!, position: row.position!,
                dataState: firstIncomplete && date >= firstIncomplete ? 'fresh' : 'final',
            });
            if (out.size >= maxRows) return { rows: [...out.values()], truncated: true, firstIncompleteDate: firstIncomplete };
        }
        if ((r.rows?.length ?? 0) < rowLimit) break;
    }
    return { rows: [...out.values()], truncated: false, firstIncompleteDate: firstIncomplete };
}

// ── Opportunities (evidence-backed candidates; heuristics, not guarantees) ─────────────────────
export interface Aggregate { key: string; clicks: number; impressions: number; ctr: number; position: number }

/** Aggregates daily rows per dimension value. Position is impression-weighted (as Search Console does). */
export function aggregate(rows: GscRow[]): Map<string, Aggregate> {
    const m = new Map<string, { clicks: number; impressions: number; posW: number }>();
    for (const r of rows) {
        const a = m.get(r.dimensionValue) ?? { clicks: 0, impressions: 0, posW: 0 };
        a.clicks += r.clicks;
        a.impressions += r.impressions;
        a.posW += r.position * r.impressions;
        m.set(r.dimensionValue, a);
    }
    return new Map([...m].map(([k, a]) => [k, { key: k, clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? a.clicks / a.impressions : 0, position: a.impressions ? a.posW / a.impressions : 0 }]));
}

export interface GscOpportunity {
    checkId: string;
    dimension: 'query' | 'page' | 'device';
    subject: string;
    severity: 'high' | 'medium' | 'low' | 'info';
    confidence: number;
    title: string;
    evidence: { current: Aggregate; previous: Aggregate | null; currentRange: DateRange; previousRange: DateRange | null; note: string };
    recommendation: string;
}

const NOTE = 'Search Console average position is an impression-weighted average, not a live ranking. Recent days may still change.';

export function findOpportunities(
    dimension: 'query' | 'page' | 'device',
    current: GscRow[],
    previous: GscRow[],
    ranges: { current: DateRange; previous: DateRange },
    t = { minImpressions: 100, lowCtr: 0.01, minClicksDrop: 10, dropRatio: 0.3 },
): GscOpportunity[] {
    const cur = aggregate(current.filter((r) => r.dimension === dimension));
    const prev = aggregate(previous.filter((r) => r.dimension === dimension));
    const out: GscOpportunity[] = [];
    const ev = (c: Aggregate, p: Aggregate | null) => ({ current: c, previous: p, currentRange: ranges.current, previousRange: p ? ranges.previous : null, note: NOTE });
    for (const c of cur.values()) {
        const p = prev.get(c.key) ?? null;
        if (dimension !== 'device' && c.impressions >= t.minImpressions && c.ctr < t.lowCtr && c.position <= 10) {
            out.push({ checkId: 'gsc_low_ctr', dimension, subject: c.key, severity: 'medium', confidence: 0.6, title: `High impressions, low CTR (${(c.ctr * 100).toFixed(1)}%)`, evidence: ev(c, p), recommendation: 'Review the title and meta description for this result so they match the search intent.' });
        }
        if (dimension === 'query' && c.position > 8 && c.position <= 20 && c.impressions >= t.minImpressions / 2) {
            out.push({ checkId: 'gsc_near_page_one', dimension, subject: c.key, severity: 'low', confidence: 0.5, title: `Average position ${c.position.toFixed(1)} (near page one)`, evidence: ev(c, p), recommendation: 'Strengthen the ranking page for this query (content depth, internal links).' });
        }
        if (p && p.clicks >= t.minClicksDrop && c.clicks <= p.clicks * (1 - t.dropRatio)) {
            out.push({ checkId: dimension === 'device' ? 'gsc_device_clicks_drop' : `gsc_${dimension}_clicks_drop`, dimension, subject: c.key, severity: 'high', confidence: 0.7, title: `Clicks fell from ${p.clicks} to ${c.clicks}`, evidence: ev(c, p), recommendation: 'Compare rankings, snippets and page changes between the two periods.' });
        }
        if (p && dimension === 'query' && p.position - c.position >= 3 && c.impressions >= t.minImpressions / 2) {
            out.push({ checkId: 'gsc_position_improved', dimension, subject: c.key, severity: 'info', confidence: 0.6, title: `Average position improved ${p.position.toFixed(1)} → ${c.position.toFixed(1)}`, evidence: ev(c, p), recommendation: 'Build on the improvement: refresh and interlink the ranking page.' });
        }
        if (p && dimension === 'page' && p.impressions >= t.minImpressions && c.impressions >= p.impressions * 1.5) {
            out.push({ checkId: 'gsc_page_visibility_up', dimension, subject: c.key, severity: 'info', confidence: 0.6, title: `Impressions up ${Math.round((c.impressions / p.impressions - 1) * 100)}%`, evidence: ev(c, p), recommendation: 'Check the page converts the new visibility (CTR, calls to action).' });
        }
    }
    // Pages/queries that had clicks before but none now.
    for (const p of prev.values()) {
        if (!cur.has(p.key) && p.clicks >= t.minClicksDrop) {
            const zero = { key: p.key, clicks: 0, impressions: 0, ctr: 0, position: 0 };
            out.push({ checkId: dimension === 'device' ? 'gsc_device_clicks_drop' : `gsc_${dimension}_clicks_drop`, dimension, subject: p.key, severity: 'high', confidence: 0.6, title: `No clicks this period (was ${p.clicks})`, evidence: ev(zero, p), recommendation: 'Check whether the page still exists, is indexable, and still ranks.' });
        }
    }
    return out.sort((a, b) => ({ high: 0, medium: 1, low: 2, info: 3 })[a.severity] - ({ high: 0, medium: 1, low: 2, info: 3 })[b.severity]);
}
