/**
 * Period comparisons for GA4 and Search Console (current vs previous range), computed from
 * stored daily rows of ONE website. Ratios are recomputed from totals, never averaged:
 *  - GA4 engagement rate = engaged sessions / sessions;
 *  - GSC CTR = clicks / impressions; average position is impression-weighted.
 * Missing data stays null (no zero-filling), so "no data" never looks like "no traffic".
 */
import type { DateRange } from './google.ts';
import { summarizeGa4, type Ga4Row } from './ga4.ts';
import type { GscRow } from './gsc.ts';

export interface PeriodDelta {
    current: number | null;
    previous: number | null;
    change: number | null;
    /** Relative change; null when the previous value is 0 or missing. */
    changePct: number | null;
}

export function delta(current: number | null, previous: number | null): PeriodDelta {
    const change = current !== null && previous !== null ? current - previous : null;
    return { current, previous, change, changePct: change !== null && previous ? change / previous : null };
}

const inRange = (date: string, r: DateRange) => date >= r.from && date <= r.to;

/** Rows from more than one website would mix clients (e.g. ADPOST and POD): refused. */
function assertOneWebsite(rows: Array<{ websiteId?: string }>) {
    const ids = new Set(rows.map((r) => r.websiteId).filter(Boolean));
    if (ids.size > 1) throw new Error('Comparisons are per website; rows from several websites were passed.');
}

export const GA4_COMPARED = ['sessions', 'engagedSessions', 'engagementRate', 'activeUsersDailySum', 'screenPageViews', 'eventCount', 'keyEvents'] as const;

export function compareGa4(rows: Array<Ga4Row & { websiteId?: string }>, current: DateRange, previous: DateRange) {
    assertOneWebsite(rows);
    const cur = summarizeGa4(rows.filter((r) => inRange(r.date, current)));
    const prev = summarizeGa4(rows.filter((r) => inRange(r.date, previous)));
    const deltas = Object.fromEntries(GA4_COMPARED.map((k) => [k, delta(cur?.[k] ?? null, prev?.[k] ?? null)])) as Record<(typeof GA4_COMPARED)[number], PeriodDelta>;
    return { current: cur, previous: prev, deltas };
}

export interface GscSummary {
    days: number;
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
    /** True when the range includes days Google still reports as incomplete ("fresh"). */
    includesFreshData: boolean;
}

/** Totals from daily 'total' rows. */
export function summarizeGsc(rows: GscRow[]): GscSummary | null {
    const totals = rows.filter((r) => r.dimension === 'total');
    if (!totals.length) return null;
    const clicks = totals.reduce((a, r) => a + r.clicks, 0);
    const impressions = totals.reduce((a, r) => a + r.impressions, 0);
    return {
        days: totals.length,
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : null,
        position: impressions ? totals.reduce((a, r) => a + r.position * r.impressions, 0) / impressions : null,
        includesFreshData: totals.some((r) => r.dataState === 'fresh'),
    };
}

export function compareGsc(rows: Array<GscRow & { websiteId?: string }>, current: DateRange, previous: DateRange) {
    assertOneWebsite(rows);
    const cur = summarizeGsc(rows.filter((r) => inRange(r.date, current)));
    const prev = summarizeGsc(rows.filter((r) => inRange(r.date, previous)));
    return {
        current: cur,
        previous: prev,
        deltas: {
            clicks: delta(cur?.clicks ?? null, prev?.clicks ?? null),
            impressions: delta(cur?.impressions ?? null, prev?.impressions ?? null),
            ctr: delta(cur?.ctr ?? null, prev?.ctr ?? null),
            // Lower is better for position: a negative change is an improvement.
            position: delta(cur?.position ?? null, prev?.position ?? null),
        },
    };
}
