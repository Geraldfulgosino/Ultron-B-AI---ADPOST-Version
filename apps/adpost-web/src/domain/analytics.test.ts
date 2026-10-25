import { addDays, buildReport, daysBetween, generateInsightCandidates, previousWindow, reportToCsv, type ReportInput } from './analytics';
import { buildPdf, executiveSummary, reportToPdf } from './pdf';
import type { DailyMetric, Integration, Website } from './types';

const site: Website = {
    id: 'w1', brandId: 'b', clientId: 'c1', name: 'Site', domain: 'site.test', platform: 'custom', status: 'active',
    primaryConversion: 'Purchase', ga4PropertyId: null, gscSiteUrl: null, createdAt: '',
};

function day(date: string, clicks: number, sessions = 100): DailyMetric {
    return { id: date, brandId: 'b', clientId: 'c1', websiteId: 'w1', date, sessions, users: 80, conversions: 2, clicks, impressions: clicks * 20, position: 8 };
}

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
    metrics: [day('2026-10-01', 10), day('2026-10-02', 20), day('2026-10-03', 0)],
    queries: [
        { id: 'q1', brandId: 'b', clientId: 'c1', websiteId: 'w1', date: '2026-09-28', query: 'alpha', clicks: 5, impressions: 100, position: 5 },
        { id: 'q2', brandId: 'b', clientId: 'c1', websiteId: 'w1', date: '2026-09-28', query: 'beta', clicks: 9, impressions: 90, position: 3 },
    ],
    pages: [{ id: 'p1', brandId: 'b', clientId: 'c1', websiteId: 'w1', date: '2026-09-28', path: '/', sessions: 300, conversions: 3, bounceRate: 0.4 }],
    websites: [site],
    clientNames: new Map([['c1', 'Client']]),
    insights: [],
    ...over,
});

describe('date helpers', () => {
    it('computes windows', () => {
        expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
        expect(daysBetween('2026-10-01', '2026-10-28')).toBe(28);
        expect(previousWindow('2026-10-08', '2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    });
});

describe('buildReport (parity with GetReportPreviewAction)', () => {
    const filters = { from: '2026-10-01', to: '2026-10-03', websiteId: null, source: 'all' as const };

    it('sums the range, drops zero trend points, ranks queries by clicks', () => {
        const r = buildReport(input(), filters);
        expect(r.summary).toEqual({ gscClicks: 30, gscImpressions: 600, ga4Sessions: 300, ga4Conversions: 6 });
        expect(r.trends.gscClicks.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02']);
        expect(r.topQueries.map((q) => q.query)).toEqual(['beta', 'alpha']); // weekly bucket overlaps range
        expect(r.hasData).toBe(true);
    });

    it('source filter hides the other provider', () => {
        const ga4 = buildReport(input(), { ...filters, source: 'ga4' });
        expect(ga4.summary.gscClicks).toBe(0);
        expect(ga4.topQueries).toEqual([]);
        const gsc = buildReport(input(), { ...filters, source: 'gsc' });
        expect(gsc.summary.ga4Sessions).toBe(0);
        expect(gsc.topPages).toEqual([]);
    });

    it('reports no data outside the range', () => {
        expect(buildReport(input(), { ...filters, from: '2025-01-01', to: '2025-01-31' }).hasData).toBe(false);
    });
});

describe('exports', () => {
    const report = buildReport(
        input({ queries: [{ id: 'q', brandId: 'b', clientId: 'c1', websiteId: 'w1', date: '2026-09-28', query: '=HYPERLINK("x")', clicks: 1, impressions: 10, position: 4 }] }),
        { from: '2026-10-01', to: '2026-10-03', websiteId: 'w1', source: 'all' },
    );

    it('CSV follows legacy layout and neutralises formula injection', () => {
        const csv = reportToCsv(report, 'POD, Inc', '2026-10-25 12:00');
        const lines = csv.split('\r\n');
        expect(lines[0]).toBe('ULTRON-B AI Report Export');
        expect(lines[1]).toBe('Brand,"POD, Inc"');
        expect(lines[4]).toBe('Website,Site');
        expect(csv).toContain('SUMMARY METRICS');
        expect(csv).toContain('"\'=HYPERLINK(""x"")",1');
    });

    it('PDF is a well-formed document with a valid xref', () => {
        const bytes = reportToPdf(report, 'POD', '2026-10-25 12:00');
        const text = new TextDecoder('latin1').decode(bytes);
        expect(text.startsWith('%PDF-1.4')).toBe(true);
        expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
        const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
        expect(text.slice(startxref, startxref + 4)).toBe('xref');
        expect(text).toContain('Executive summary');
    });

    it('PDF paginates long content and escapes parentheses', () => {
        const text = new TextDecoder('latin1').decode(buildPdf(Array.from({ length: 120 }, (_, i) => ({ text: `row (${i})`, size: 10 }))));
        expect(text).toContain('/Count 3');
        expect(text).toContain('row \\(5\\)');
    });

    it('executive summary is deterministic plain language', () => {
        expect(executiveSummary(report)).toMatch(/^Organic search delivered 30 clicks from 600 impressions \(5\.00% CTR\)\./);
    });
});

describe('insight rules (parity with AnalyticsSummaryAgent)', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const dates = Array.from({ length: 14 }, (_, i) => addDays('2026-10-01', i));

    it('flags a >=30% week-over-week click drop', () => {
        const metrics = dates.map((d, i) => day(d, i < 7 ? 20 : 5));
        const integrations: Integration[] = [];
        const c = generateInsightCandidates({ websites: [site], metrics, queries: [], pages: [], integrations, now });
        expect(c.find((x) => x.type === 'traffic_drop')).toMatchObject({ severity: 'high', evidence: { previous_clicks: 140, current_clicks: 35 } });
    });

    it('flags low-CTR queries, ranking opportunities, conversion gaps, and missing integrations', () => {
        const metrics = dates.map((d) => day(d, 10));
        const c = generateInsightCandidates({
            websites: [site], metrics, now,
            queries: [{ id: 'q', brandId: 'b', clientId: 'c1', websiteId: 'w1', date: '2026-10-05', query: 'cheap', clicks: 1, impressions: 500, position: 9 }],
            pages: [{ id: 'p', brandId: 'b', clientId: 'c1', websiteId: 'w1', date: '2026-10-05', path: '/pricing', sessions: 400, conversions: 0, bounceRate: 0.5 }],
            integrations: [],
        });
        expect(c.map((x) => x.type).sort()).toEqual(['conversion_gap', 'ctr_opportunity', 'ranking_opportunity', 'technical_issue']);
    });

    it('flags failing or stale syncs', () => {
        const base = { brandId: 'b', clientId: 'c1', websiteId: 'w1', externalAccountName: null, externalPropertyName: null, createdAt: '' };
        const c = generateInsightCandidates({
            websites: [site], metrics: [], queries: [], pages: [], now,
            integrations: [
                { ...base, id: 'i1', provider: 'google_analytics', status: 'connected', lastSyncedAt: '2026-10-01T00:00:00Z', lastErrorMessage: null },
                { ...base, id: 'i2', provider: 'google_search_console', status: 'error', lastSyncedAt: '2026-10-14T00:00:00Z', lastErrorMessage: 'boom' },
            ],
        });
        expect(c.map((x) => [x.subject, x.severity])).toEqual([['sync:i1', 'medium'], ['sync:i2', 'high']]);
    });
});
