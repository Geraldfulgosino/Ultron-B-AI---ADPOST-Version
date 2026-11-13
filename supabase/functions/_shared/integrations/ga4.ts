/**
 * Google Analytics 4 connector (Analytics Admin API for property discovery, Data API for reports).
 * Read-only. Metric names follow the current Data API schema (keyEvents replaced conversions).
 * No values are invented: missing metrics stay null and missing days have no row.
 */
import { googleApi, type DateRange } from './google.ts';
import { IntegrationError } from './types.ts';

export interface Ga4Property {
    propertyId: string;
    displayName: string;
    account: string;
    accountName: string;
}

export const GA4_METRICS = ['activeUsers', 'totalUsers', 'sessions', 'engagedSessions', 'engagementRate', 'screenPageViews', 'eventCount', 'keyEvents'] as const;
export const GA4_DIMENSIONS = ['total', 'sessionDefaultChannelGroup', 'sessionSourceMedium', 'deviceCategory', 'country', 'landingPage'] as const;
export type Ga4Dimension = (typeof GA4_DIMENSIONS)[number];

export interface Ga4Row {
    date: string;
    dimension: Ga4Dimension;
    dimensionValue: string;
    activeUsers: number | null;
    totalUsers: number | null;
    sessions: number | null;
    engagedSessions: number | null;
    engagementRate: number | null;
    screenPageViews: number | null;
    eventCount: number | null;
    keyEvents: number | null;
}

export async function listGa4Properties(fetchFn: typeof fetch, accessToken: string): Promise<Ga4Property[]> {
    const out: Ga4Property[] = [];
    let pageToken = '';
    for (let i = 0; i < 20; i++) {
        const url = `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const r = await googleApi<{ accountSummaries?: Array<{ account?: string; displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }>; nextPageToken?: string }>(fetchFn, accessToken, url);
        for (const a of r.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) {
            if (p.property && /^properties\/\d+$/.test(p.property)) out.push({ propertyId: p.property, displayName: p.displayName ?? p.property, account: a.account ?? '', accountName: a.displayName ?? '' });
        }
        if (!r.nextPageToken) break;
        pageToken = r.nextPageToken;
    }
    return out;
}

/** The chosen property must be one the connected Google account can access (never guessed). */
export async function verifyGa4Property(fetchFn: typeof fetch, accessToken: string, propertyId: string): Promise<Ga4Property> {
    if (!/^properties\/\d+$/.test(propertyId)) throw new IntegrationError('invalid_response', 'Choose a GA4 property (properties/123…).');
    const found = (await listGa4Properties(fetchFn, accessToken)).find((p) => p.propertyId === propertyId);
    if (!found) throw new IntegrationError('permission_denied', 'The connected Google account cannot access this GA4 property.');
    return found;
}

const toIsoDate = (yyyymmdd: string) => (/^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : null);

/** One runReport per dimension, paginated (limit/offset), normalized and de-duplicated. */
export async function runGa4Report(fetchFn: typeof fetch, accessToken: string, propertyId: string, range: DateRange, dimension: Ga4Dimension, o: { maxRows?: number } = {}): Promise<{ rows: Ga4Row[]; truncated: boolean; timeZone: string | null }> {
    const limit = 10_000;
    const maxRows = Math.min(o.maxRows ?? 50_000, 250_000);
    const rows = new Map<string, Ga4Row>();
    let timeZone: string | null = null;
    for (let offset = 0; ; offset += limit) {
        const body = {
            dateRanges: [{ startDate: range.from, endDate: range.to }],
            dimensions: [{ name: 'date' }, ...(dimension === 'total' ? [] : [{ name: dimension }])],
            metrics: GA4_METRICS.map((name) => ({ name })),
            limit, offset, keepEmptyRows: false, returnPropertyQuota: false,
            orderBys: [{ dimension: { dimensionName: 'date' } }],
        };
        const r = await googleApi<{ dimensionHeaders?: Array<{ name: string }>; metricHeaders?: Array<{ name: string }>; rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>; rowCount?: number; metadata?: { timeZone?: string } }>(
            fetchFn, accessToken, `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, { method: 'POST', body },
        );
        timeZone ??= r.metadata?.timeZone ?? null;
        const mIdx = Object.fromEntries((r.metricHeaders ?? []).map((h, i) => [h.name, i]));
        const metric = (row: { metricValues?: Array<{ value?: string }> }, name: string) => {
            const i = mIdx[name];
            const v = i === undefined ? undefined : row.metricValues?.[i]?.value;
            const n = v === undefined || v === '' ? NaN : Number(v);
            return Number.isFinite(n) ? n : null;
        };
        for (const row of r.rows ?? []) {
            const date = toIsoDate(row.dimensionValues?.[0]?.value ?? '');
            if (!date) continue;
            const value = dimension === 'total' ? '' : (row.dimensionValues?.[1]?.value ?? '').slice(0, 1000);
            rows.set(`${date}|${value}`, {
                date, dimension, dimensionValue: value,
                activeUsers: metric(row, 'activeUsers'), totalUsers: metric(row, 'totalUsers'), sessions: metric(row, 'sessions'),
                engagedSessions: metric(row, 'engagedSessions'), engagementRate: metric(row, 'engagementRate'),
                screenPageViews: metric(row, 'screenPageViews'), eventCount: metric(row, 'eventCount'), keyEvents: metric(row, 'keyEvents'),
            });
            if (rows.size >= maxRows) return { rows: [...rows.values()], truncated: true, timeZone };
        }
        const total = r.rowCount ?? 0;
        if (!r.rows?.length || offset + limit >= total) break;
    }
    return { rows: [...rows.values()], truncated: false, timeZone };
}

/** Period totals from daily 'total' rows. Ratios are recomputed, never summed. */
export function summarizeGa4(rows: Ga4Row[]) {
    const totals = rows.filter((r) => r.dimension === 'total');
    if (!totals.length) return null;
    const sum = (k: keyof Ga4Row) => (totals.every((r) => r[k] === null) ? null : totals.reduce((a, r) => a + ((r[k] as number | null) ?? 0), 0));
    const sessions = sum('sessions');
    const engaged = sum('engagedSessions');
    return {
        days: totals.length,
        // activeUsers/totalUsers are not additive across days; these are sums of daily values.
        activeUsersDailySum: sum('activeUsers'),
        sessions, engagedSessions: engaged,
        engagementRate: sessions && engaged !== null ? engaged / sessions : null,
        screenPageViews: sum('screenPageViews'), eventCount: sum('eventCount'), keyEvents: sum('keyEvents'),
    };
}
