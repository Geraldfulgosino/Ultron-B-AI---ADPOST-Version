/**
 * SEO intelligence: pure functions over brand analytics rows.
 * Heuristics are labelled as estimates in the UI; nothing here calls a model.
 */
import type { DailyMetric, SearchQuery, Website } from './types';
import { addDays, dailySeries, delta, previousWindow, totals, type SeriesPoint } from './analytics';

/**
 * Approximate organic CTR by average position (blended public industry curves,
 * rounded). Used only to rank opportunities, never shown as fact.
 */
export const EXPECTED_CTR: ReadonlyArray<number> = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export const EXPECTED_CTR_BEYOND_10 = 0.01;

export function expectedCtr(position: number): number {
    if (position < 1) return EXPECTED_CTR[0]!;
    const i = Math.round(position) - 1;
    return i < EXPECTED_CTR.length ? EXPECTED_CTR[i]! : EXPECTED_CTR_BEYOND_10;
}

export interface Anomaly {
    websiteId: string;
    metric: 'sessions' | 'clicks';
    date: string;
    value: number;
    expected: number;
    z: number;
    direction: 'spike' | 'drop';
}

/**
 * Rolling z-score against the trailing `window` days (excluding the day itself).
 * Flags |z| >= threshold. Needs at least `window` prior points.
 */
export function detectAnomalies(series: SeriesPoint[], window = 14, threshold = 2.5): Array<{ date: string; value: number; expected: number; z: number }> {
    const out: Array<{ date: string; value: number; expected: number; z: number }> = [];
    for (let i = window; i < series.length; i++) {
        const prior = series.slice(i - window, i).map((p) => p.value);
        const mean = prior.reduce((a, b) => a + b, 0) / window;
        const sd = Math.sqrt(prior.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1));
        if (sd === 0) continue;
        const z = (series[i]!.value - mean) / sd;
        if (Math.abs(z) >= threshold) out.push({ date: series[i]!.date, value: series[i]!.value, expected: Math.round(mean), z: Math.round(z * 100) / 100 });
    }
    return out;
}

export interface Opportunity {
    websiteId: string;
    query: string;
    impressions: number;
    clicks: number;
    ctr: number;
    position: number;
    expectedCtr: number;
    /** Extra monthly clicks if CTR reached the curve for its current position. */
    ctrGap: number;
    /** Extra clicks if it moved to position 3 (only for positions 4–20). */
    rankGain: number;
    score: number;
}

export function scoreOpportunities(queries: readonly SearchQuery[], from: string, to: string, limit = 15): Opportunity[] {
    const agg = new Map<string, { websiteId: string; query: string; clicks: number; impressions: number; posSum: number; n: number }>();
    for (const q of queries) {
        if (q.date > to || addDays(q.date, 6) < from) continue;
        const key = `${q.websiteId}|${q.query}`;
        const a = agg.get(key) ?? { websiteId: q.websiteId, query: q.query, clicks: 0, impressions: 0, posSum: 0, n: 0 };
        a.clicks += q.clicks;
        a.impressions += q.impressions;
        a.posSum += q.position;
        a.n++;
        agg.set(key, a);
    }
    return [...agg.values()]
        .map((a) => {
            const position = a.posSum / a.n;
            const ctr = a.impressions ? a.clicks / a.impressions : 0;
            const exp = expectedCtr(position);
            const ctrGap = Math.max(0, Math.round(a.impressions * (exp - ctr)));
            const rankGain = position >= 4 && position <= 20 ? Math.max(0, Math.round(a.impressions * (EXPECTED_CTR[2]! - Math.max(ctr, exp)))) : 0;
            return { websiteId: a.websiteId, query: a.query, impressions: a.impressions, clicks: a.clicks, ctr, position: Math.round(position * 10) / 10, expectedCtr: exp, ctrGap, rankGain, score: ctrGap + rankGain * 0.5 };
        })
        .filter((o) => o.score > 0)
        .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query))
        .slice(0, limit);
}

export interface WebsiteComparisonRow {
    websiteId: string;
    name: string;
    domain: string;
    sessions: number;
    sessionsDelta: number | null;
    conversions: number;
    conversionRate: number;
    clicks: number;
    clicksDelta: number | null;
    ctr: number;
    avgPosition: number;
}

export function compareWebsites(websites: readonly Website[], metrics: readonly DailyMetric[], from: string, to: string): WebsiteComparisonRow[] {
    const prev = previousWindow(from, to);
    return websites
        .map((w) => {
            const own = metrics.filter((m) => m.websiteId === w.id);
            const cur = totals(own.filter((m) => m.date >= from && m.date <= to));
            const before = totals(own.filter((m) => m.date >= prev.from && m.date <= prev.to));
            return {
                websiteId: w.id, name: w.name, domain: w.domain,
                sessions: cur.sessions, sessionsDelta: delta(cur.sessions, before.sessions),
                conversions: cur.conversions, conversionRate: cur.conversionRate,
                clicks: cur.clicks, clicksDelta: delta(cur.clicks, before.clicks),
                ctr: cur.ctr, avgPosition: Math.round(cur.avgPosition * 10) / 10,
            };
        })
        .sort((a, b) => b.sessions - a.sessions);
}

export function websiteAnomalies(websites: readonly Website[], metrics: readonly DailyMetric[], from: string, to: string): Anomaly[] {
    const out: Anomaly[] = [];
    // Include 14 days before the range as the baseline for the first days in range.
    const baseFrom = addDays(from, -14);
    for (const w of websites) {
        const own = metrics.filter((m) => m.websiteId === w.id && m.date >= baseFrom && m.date <= to);
        for (const metric of ['sessions', 'clicks'] as const) {
            for (const a of detectAnomalies(dailySeries(own, metric))) {
                if (a.date >= from) out.push({ websiteId: w.id, metric, ...a, direction: a.z > 0 ? 'spike' : 'drop' });
            }
        }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.z) - Math.abs(a.z));
}
