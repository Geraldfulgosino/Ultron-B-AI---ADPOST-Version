/**
 * Pure analytics/report logic, ported from the Laravel actions:
 * GetReportPreviewAction, BuildReportCsvAction, AnalyticsSummaryAgent.
 * No I/O: adapters pass in rows that the user is already allowed to see.
 */
import type { DailyMetric, Integration, LandingPage, SearchQuery, SeoInsight, SeoInsightType, Severity, Website } from './types';

export type ReportSource = 'all' | 'ga4' | 'gsc';

export interface ReportFilters {
    from: string; // YYYY-MM-DD inclusive
    to: string;
    websiteId: string | null;
    source: ReportSource;
}

export interface SeriesPoint {
    date: string;
    value: number;
}

export interface ReportData {
    filters: ReportFilters;
    websites: Array<{ id: string; name: string; domain: string; clientName: string }>;
    hasData: boolean;
    summary: { gscClicks: number; gscImpressions: number; ga4Sessions: number; ga4Conversions: number };
    trends: { gscClicks: SeriesPoint[]; gscImpressions: SeriesPoint[]; ga4Sessions: SeriesPoint[] };
    topQueries: Array<{ query: string; clicks: number; impressions: number }>;
    topPages: Array<{ path: string; sessions: number; conversions: number }>;
    insights: Array<Pick<SeoInsight, 'id' | 'title' | 'severity' | 'status' | 'type'>>;
}

export function addDays(date: string, days: number): string {
    const d = new Date(date + 'T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1;
}

/** The equally long window immediately before [from, to]. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
    const len = daysBetween(from, to);
    return { from: addDays(from, -len), to: addDays(from, -1) };
}

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
/** Weekly buckets overlap the range if any day of the week falls in it. */
const weekInRange = (weekStart: string, from: string, to: string) => weekStart <= to && addDays(weekStart, 6) >= from;

export function latestDate(metrics: readonly DailyMetric[]): string | null {
    let max: string | null = null;
    for (const m of metrics) if (max === null || m.date > max) max = m.date;
    return max;
}

export function totals(metrics: readonly DailyMetric[]) {
    let sessions = 0, users = 0, conversions = 0, clicks = 0, impressions = 0, positionSum = 0;
    for (const m of metrics) {
        sessions += m.sessions;
        users += m.users;
        conversions += m.conversions;
        clicks += m.clicks;
        impressions += m.impressions;
        positionSum += m.position;
    }
    return {
        sessions, users, conversions, clicks, impressions,
        ctr: impressions ? clicks / impressions : 0,
        conversionRate: sessions ? conversions / sessions : 0,
        avgPosition: metrics.length ? positionSum / metrics.length : 0,
    };
}

export function dailySeries(metrics: readonly DailyMetric[], field: 'sessions' | 'clicks' | 'impressions' | 'conversions'): SeriesPoint[] {
    const byDate = new Map<string, number>();
    for (const m of metrics) byDate.set(m.date, (byDate.get(m.date) ?? 0) + m[field]);
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

/** Relative change; null when there is no baseline. */
export function delta(current: number, previous: number): number | null {
    return previous ? (current - previous) / previous : null;
}

export interface ReportInput {
    metrics: readonly DailyMetric[];
    queries: readonly SearchQuery[];
    pages: readonly LandingPage[];
    websites: readonly Website[];
    clientNames: ReadonlyMap<string, string>;
    insights: readonly SeoInsight[];
}

export function buildReport(input: ReportInput, filters: ReportFilters): ReportData {
    const site = (r: { websiteId: string }) => filters.websiteId === null || r.websiteId === filters.websiteId;
    const metrics = input.metrics.filter((m) => site(m) && inRange(m.date, filters.from, filters.to));
    const showGsc = filters.source !== 'ga4';
    const showGa4 = filters.source !== 'gsc';
    const t = totals(metrics);

    const queryAgg = new Map<string, { clicks: number; impressions: number }>();
    if (showGsc) {
        for (const q of input.queries) {
            if (!site(q) || !weekInRange(q.date, filters.from, filters.to)) continue;
            const a = queryAgg.get(q.query) ?? { clicks: 0, impressions: 0 };
            a.clicks += q.clicks;
            a.impressions += q.impressions;
            queryAgg.set(q.query, a);
        }
    }
    const pageAgg = new Map<string, { sessions: number; conversions: number }>();
    if (showGa4) {
        for (const p of input.pages) {
            if (!site(p) || !weekInRange(p.date, filters.from, filters.to)) continue;
            const a = pageAgg.get(p.path) ?? { sessions: 0, conversions: 0 };
            a.sessions += p.sessions;
            a.conversions += p.conversions;
            pageAgg.set(p.path, a);
        }
    }

    const nonZero = (s: SeriesPoint[]) => s.filter((p) => p.value > 0);

    return {
        filters,
        websites: [...input.websites]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((w) => ({ id: w.id, name: w.name, domain: w.domain, clientName: input.clientNames.get(w.clientId) ?? '' })),
        hasData: metrics.length > 0,
        summary: {
            gscClicks: showGsc ? t.clicks : 0,
            gscImpressions: showGsc ? t.impressions : 0,
            ga4Sessions: showGa4 ? t.sessions : 0,
            ga4Conversions: showGa4 ? t.conversions : 0,
        },
        trends: {
            gscClicks: showGsc ? nonZero(dailySeries(metrics, 'clicks')) : [],
            gscImpressions: showGsc ? nonZero(dailySeries(metrics, 'impressions')) : [],
            ga4Sessions: showGa4 ? nonZero(dailySeries(metrics, 'sessions')) : [],
        },
        topQueries: [...queryAgg.entries()]
            .map(([query, a]) => ({ query, ...a }))
            .sort((a, b) => b.clicks - a.clicks || a.query.localeCompare(b.query))
            .slice(0, 10),
        topPages: [...pageAgg.entries()]
            .map(([path, a]) => ({ path, ...a }))
            .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
            .slice(0, 10),
        insights: input.insights
            .filter((i) => site(i) && i.status !== 'dismissed')
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.createdAt.localeCompare(a.createdAt))
            .slice(0, 5)
            .map(({ id, title, severity, status, type }) => ({ id, title, severity, status, type })),
    };
}

const severityRank = (s: Severity) => ({ low: 0, medium: 1, high: 2 })[s];

// ── CSV (layout mirrors BuildReportCsvAction) ─────────────────────────────

function csvCell(value: string | number): string {
    let s = String(value);
    // Neutralise spreadsheet formula injection (=, +, -, @ at the start of text cells).
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sourceLabel(source: ReportSource): string {
    return source === 'ga4' ? 'GA4 only' : source === 'gsc' ? 'GSC only' : 'All';
}

export function websiteLabel(report: ReportData): string {
    return report.websites.find((w) => w.id === report.filters.websiteId)?.name ?? 'All websites';
}

export function reportToCsv(report: ReportData, brandName: string, generatedAt: string): string {
    const rows: Array<Array<string | number>> = [];
    const w = (...cells: Array<string | number>) => rows.push(cells);
    const { filters, summary, trends } = report;
    const showGsc = filters.source !== 'ga4';
    const showGa4 = filters.source !== 'gsc';

    w('ULTRON-B AI Report Export');
    w('Brand', brandName);
    w('Date Range', `${filters.from} to ${filters.to}`);
    w('Source', sourceLabel(filters.source));
    w('Website', websiteLabel(report));
    w('Generated', generatedAt);
    w();

    if (!report.hasData) {
        w('No report data for selected range.');
    } else {
        w('SUMMARY METRICS');
        if (showGsc) {
            w('GSC Clicks', summary.gscClicks);
            w('GSC Impressions', summary.gscImpressions);
        }
        if (showGa4) {
            w('GA4 Sessions', summary.ga4Sessions);
            w('GA4 Conversions', summary.ga4Conversions);
        }
        w();
        const trend = (title: string, col: string, series: SeriesPoint[]) => {
            if (!series.length) return;
            w(`DAILY TRENDS - ${title}`);
            w('Date', col);
            series.forEach((p) => w(p.date, p.value));
            w();
        };
        if (showGsc) trend('GSC Clicks', 'Clicks', trends.gscClicks);
        if (showGsc) trend('GSC Impressions', 'Impressions', trends.gscImpressions);
        if (showGa4) trend('GA4 Sessions', 'Sessions', trends.ga4Sessions);
        if (showGsc) {
            w('TOP QUERIES');
            w('Query', 'Clicks');
            if (!report.topQueries.length) w('No data');
            report.topQueries.forEach((q) => w(q.query, q.clicks));
            w();
        }
        if (showGa4) {
            w('TOP PAGES');
            w('Page Path', 'Sessions');
            if (!report.topPages.length) w('No data');
            report.topPages.forEach((p) => w(p.path, p.sessions));
            w();
        }
    }
    w('SEO INSIGHTS');
    w('Title', 'Severity', 'Status');
    if (!report.insights.length) w('No insights');
    report.insights.forEach((i) => w(i.title, i.severity, i.status));

    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ── Insight rules (ported from AnalyticsSummaryAgent) ─────────────────────

export interface InsightCandidate {
    websiteId: string;
    clientId: string;
    type: SeoInsightType;
    severity: Severity;
    /** Stable dedupe key: same subject is not re-raised while open. */
    subject: string;
    title: string;
    summary: string;
    recommendation: string;
    evidence: Record<string, string | number>;
}

export interface InsightInput {
    websites: readonly Website[];
    metrics: readonly DailyMetric[];
    queries: readonly SearchQuery[];
    pages: readonly LandingPage[];
    integrations: readonly Integration[];
    now: Date;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function generateInsightCandidates(input: InsightInput): InsightCandidate[] {
    const out: InsightCandidate[] = [];
    for (const w of input.websites) {
        const metrics = input.metrics.filter((m) => m.websiteId === w.id);
        const end = latestDate(metrics);
        const base = { websiteId: w.id, clientId: w.clientId };

        if (end) {
            // 1. Clicks declined: last 7 days vs previous 7, previous >= 10 and current <= 70%.
            const curFrom = addDays(end, -6);
            const prev = previousWindow(curFrom, end);
            const cur = totals(metrics.filter((m) => inRange(m.date, curFrom, end))).clicks;
            const before = totals(metrics.filter((m) => inRange(m.date, prev.from, prev.to))).clicks;
            if (before >= 10 && cur <= before * 0.7) {
                out.push({
                    ...base, type: 'traffic_drop', severity: cur <= before * 0.5 ? 'high' : 'medium', subject: `clicks:${w.id}`,
                    title: `${w.domain} lost ${before - cur} clicks week over week`,
                    summary: `Search clicks fell from ${before} to ${cur} in the 7 days ending ${end}.`,
                    recommendation: 'Check for ranking losses on top queries, recent site changes, and indexing errors in Search Console.',
                    evidence: { previous_clicks: before, current_clicks: cur, drop: before - cur, window_end: end },
                });
            }

            const lookFrom = addDays(end, -29);
            const qAgg = new Map<string, { clicks: number; impressions: number; posSum: number; n: number }>();
            for (const q of input.queries) {
                if (q.websiteId !== w.id || !weekInRange(q.date, lookFrom, end)) continue;
                const a = qAgg.get(q.query) ?? { clicks: 0, impressions: 0, posSum: 0, n: 0 };
                a.clicks += q.clicks;
                a.impressions += q.impressions;
                a.posSum += q.position;
                a.n++;
                qAgg.set(q.query, a);
            }
            // Ranking opportunities are capped to the 3 highest-impression queries per site
            // (deviation from legacy, which raised one per qualifying query and flooded the queue).
            const rankable = new Set(
                [...qAgg.entries()]
                    .filter(([, a]) => a.n && a.posSum / a.n >= 4 && a.posSum / a.n <= 20 && a.impressions >= 50)
                    .sort(([, x], [, y]) => y.impressions - x.impressions)
                    .slice(0, 3)
                    .map(([q]) => q),
            );
            for (const [query, a] of qAgg) {
                const ctr = a.impressions ? a.clicks / a.impressions : 0;
                const position = a.n ? a.posSum / a.n : 0;
                // 2. High impressions, CTR under 2%.
                if (a.impressions >= 100 && ctr < 0.02) {
                    out.push({
                        ...base, type: 'ctr_opportunity', severity: a.impressions >= 1000 ? 'high' : 'medium', subject: `ctr:${w.id}:${query}`,
                        title: `"${query}" has ${a.impressions} impressions but only ${pct(ctr)} CTR`,
                        summary: `Over the last 30 days this query earned ${a.clicks} clicks from ${a.impressions} impressions.`,
                        recommendation: 'Rewrite the title tag and meta description for the ranking page to better match search intent.',
                        evidence: { clicks: a.clicks, impressions: a.impressions, ctr: Math.round(ctr * 10000) / 100 },
                    });
                }
                // 3. Ranking opportunity: average position 4–20 with >= 50 impressions.
                if (rankable.has(query)) {
                    out.push({
                        ...base, type: 'ranking_opportunity', severity: position <= 10 ? 'medium' : 'low', subject: `rank:${w.id}:${query}`,
                        title: `"${query}" ranks at position ${position.toFixed(1)}`,
                        summary: `Moving this query onto page one (or into the top 3) would lift clicks from its ${a.impressions} monthly impressions.`,
                        recommendation: 'Strengthen the ranking page with deeper content, internal links, and supporting FAQ coverage.',
                        evidence: { impressions: a.impressions, average_position: Math.round(position * 10) / 10 },
                    });
                }
            }

            // 4. Conversion gap: page with traffic but conversion rate under 0.5%.
            const pAgg = new Map<string, { sessions: number; conversions: number }>();
            for (const p of input.pages) {
                if (p.websiteId !== w.id || !weekInRange(p.date, lookFrom, end)) continue;
                const a = pAgg.get(p.path) ?? { sessions: 0, conversions: 0 };
                a.sessions += p.sessions;
                a.conversions += p.conversions;
                pAgg.set(p.path, a);
            }
            for (const [path, a] of pAgg) {
                const rate = a.sessions ? a.conversions / a.sessions : 0;
                if (a.sessions >= 200 && rate < 0.005) {
                    out.push({
                        ...base, type: 'conversion_gap', severity: 'medium', subject: `conv:${w.id}:${path}`,
                        title: `${w.domain}${path} converts ${pct(rate)} of ${a.sessions} sessions`,
                        summary: `This landing page attracts traffic but rarely leads to "${w.primaryConversion ?? 'a conversion'}".`,
                        recommendation: 'Review the call to action, page speed, and offer clarity; consider an A/B test on the primary CTA.',
                        evidence: { sessions: a.sessions, conversions: a.conversions, conversion_rate: Math.round(rate * 10000) / 100 },
                    });
                }
            }
        }

        // 5. Missing or stale sync.
        const ints = input.integrations.filter((i) => i.websiteId === w.id);
        if (!ints.length) {
            out.push({
                ...base, type: 'technical_issue', severity: 'medium', subject: `sync-missing:${w.id}`,
                title: `${w.domain} has no analytics integration`,
                summary: 'No GA4 or Search Console data is being collected for this website.',
                recommendation: 'Connect GA4 and Search Console on the Integrations page.',
                evidence: { integrations: 0 },
            });
        }
        for (const i of ints) {
            const ageDays = i.lastSyncedAt ? (input.now.getTime() - Date.parse(i.lastSyncedAt)) / 86_400_000 : Infinity;
            if (i.status === 'error' || ageDays > 3) {
                const label = i.provider === 'google_analytics' ? 'GA4' : 'Search Console';
                out.push({
                    ...base, type: 'technical_issue', severity: i.status === 'error' ? 'high' : 'medium', subject: `sync:${i.id}`,
                    title: `${label} sync for ${w.domain} is ${i.status === 'error' ? 'failing' : 'stale'}`,
                    summary: i.lastErrorMessage ?? `Last successful sync: ${i.lastSyncedAt ?? 'never'}.`,
                    recommendation: 'Reconnect the integration and run a manual sync.',
                    evidence: { provider: i.provider, status: i.status, last_synced_at: i.lastSyncedAt ?? 'never' },
                });
            }
        }
    }
    return out;
}
