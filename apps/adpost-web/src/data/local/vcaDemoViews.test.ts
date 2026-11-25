import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSampleSeed, sampleClientId } from './sampleSeed';
import { LocalDatabase } from './db';
import { apiFor } from './backend';
import { VCA_DEMO_END } from './vcaDemo';
import { addDays, DEMO_DATA_NOTICE, reportToCsv } from '@/domain/analytics';
import { reportToPdf } from '@/domain/pdf';
import { healthScore } from '@/domain/audit';

const CMS = sampleClientId('vca', 'cms');
const LIPSKY = sampleClientId('vca', 'lipsky');
const LOOP19 = sampleClientId('vca', 'loop19');
const HLDC = sampleClientId('vca', 'hamptons');
const db = () => {
    const { snapshot, credentials } = buildSampleSeed();
    return new LocalDatabase(snapshot, credentials, { now: () => new Date('2026-11-25T12:00:00Z') });
};
const vca = (d = db()) => apiFor(d, 'usr_vca_admin');
const range = (days: number) => ({ from: addDays(VCA_DEMO_END, -(days - 1)), to: VCA_DEMO_END });

afterEach(() => vi.restoreAllMocks());

describe('VCA demo: calculations follow the underlying rows', () => {
    it('dashboard ranges (7/28/30/90) recalculate from daily rows and compare with the previous window', async () => {
        const d = db();
        const api = vca(d);
        for (const days of [7, 28, 30, 90]) {
            const dash = await api.analytics.dashboard(CMS, { days });
            const rows = d.all('dailyMetrics').filter((m) => m.brandId === CMS && m.date >= dash.window!.from && m.date <= dash.window!.to);
            expect(rows).toHaveLength(days);
            expect(dash.kpis.sessions.current).toBe(rows.reduce((a, m) => a + m.sessions, 0));
            expect(dash.kpis.clicks.current).toBe(rows.reduce((a, m) => a + m.clicks, 0));
            const impressions = rows.reduce((a, m) => a + m.impressions, 0);
            expect(dash.kpis.ctr.current).toBeCloseTo(dash.kpis.clicks.current / impressions, 10);
            expect(dash.kpis.engagementRate!.current).toBeCloseTo(rows.reduce((a, m) => a + m.engagedSessions!, 0) / dash.kpis.sessions.current, 10);
            expect(dash.channels.reduce((a, c) => a + c.value, 0)).toBe(dash.kpis.sessions.current);
            expect(dash.devices.reduce((a, c) => a + c.value, 0)).toBe(dash.kpis.sessions.current);
            expect(dash.sessionsTrend).toHaveLength(days);
            expect(dash.simulated).toBe(true);
        }
        // 90 days covers all data: no previous window exists, so there is no baseline.
        expect((await api.analytics.dashboard(CMS, { days: 90 })).kpis.sessions.delta).toBeNull();
        expect((await api.analytics.dashboard(CMS, { days: 28 })).kpis.clicks.delta!).toBeLessThan(-0.08);
    });

    it('a website filter from another client is refused', async () => {
        await expect(vca().analytics.dashboard(LIPSKY, { websiteId: 'web_demo_vca_cms_prod' })).rejects.toThrow();
    });

    it('report metrics match the dashboard for the same window, and exports carry the demo notice', async () => {
        const api = vca();
        const dash = await api.analytics.dashboard(LIPSKY, { days: 28 });
        const report = await api.reports.preview(LIPSKY, { ...dash.window!, websiteId: null, source: 'all' });
        expect(report.simulated).toBe(true);
        expect(report.summary.ga4Sessions).toBe(dash.kpis.sessions.current);
        expect(report.summary.gscClicks).toBe(dash.kpis.clicks.current);
        expect(report.summary.gscImpressions).toBe(dash.kpis.impressions.current);
        expect(report.summary.ga4Conversions).toBe(dash.kpis.conversions.current);
        expect(report.previous.gscClicks).toBe(dash.kpis.clicks.previous);
        expect(report.technical!.simulated).toBe(true);
        expect(report.recommendations.length).toBeGreaterThan(0);
        expect(report.tasks.length).toBeGreaterThan(0);
        const csv = reportToCsv(report, 'LIPSKY', '2026-11-25 12:00:00 UTC');
        expect(csv.split('\r\n')[1]).toContain('DEMO / SYNTHETIC DATA');
        expect(csv).toContain(`GA4 Sessions,${report.summary.ga4Sessions}`);
        expect(csv).toContain(`GSC Clicks,${report.summary.gscClicks}`);
        expect(csv).toContain('2026-10-26 to 2026-11-22');
        expect(csv.trim().split('\r\n').pop()).toBe(`"${DEMO_DATA_NOTICE}"`);
        const pdf = new TextDecoder('latin1').decode(reportToPdf(report, 'LIPSKY', '2026-11-25 12:00:00 UTC'));
        expect(pdf).toContain('(DEMO - SYNTHETIC DATA) Tj');
        expect(pdf).toContain('DEMO / SYNTHETIC DATA');
        expect(pdf).toContain(`GA4 sessions: ${report.summary.ga4Sessions.toLocaleString('en-US')}`);
    });

    it('SEO overview breakdowns sum to the search totals; movers come from the same queries', async () => {
        const o = await vca().analytics.seoOverview(CMS, { ...range(28), websiteId: null });
        expect(o.simulated).toBe(true);
        expect(o.searchDevices.reduce((a, r) => a + r.value, 0)).toBe(o.totals.clicks);
        expect(o.searchCountries.reduce((a, r) => a + r.value, 0)).toBe(o.totals.clicks);
        expect(o.movers.decliners.map((m) => m.query)).toContain('construction seo services');
    });

    it('intelligence scores are the same everywhere they appear', async () => {
        const api = vca();
        const intel = await api.intelligence.overview(HLDC, { ...range(28), websiteId: null });
        const report = await api.reports.preview(HLDC, { ...range(28), websiteId: null, source: 'all' });
        expect(intel.audits).toHaveLength(1);
        const a = intel.audits[0]!;
        expect(a.simulated).toBe(true);
        expect(a.score).toBe(report.technical!.score);
        expect(a.trend[a.trend.length - 1]!.value).toBe(a.score);
        expect(a.competitors.filter((c) => !c.isSelf).every((c) => c.domain.endsWith('.example'))).toBe(true);
        expect(intel.recommendations.length).toBeGreaterThan(0);
        expect(intel.contentGaps.every((i) => i.type === 'content_gap')).toBe(true);
        expect(a.distribution.reduce((x, d) => x + d.pages, 0)).toBe(a.lines.reduce((x, l) => x + l.count, 0));
        expect(healthScore([], 10).score).toBe(100);
    });
});

describe('VCA demo: simulated integrations', () => {
    it('sync records a simulated attempt, never calls the network, and a failing demo connection stays failing', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const d = db();
        const api = vca(d);
        const list = await api.integrations.list(CMS);
        expect(list.every((i) => i.simulated)).toBe(true);
        const ga4 = list.find((i) => i.provider === 'google_analytics')!;
        const before = ga4.syncHistory!.length;
        const after = await api.integrations.sync(CMS, ga4.id);
        expect(after.syncHistory![0]).toMatchObject({ ok: true, at: '2026-11-25T12:00:00.000Z' });
        expect(after.syncHistory!.length).toBe(Math.min(10, before + 1));
        const failing = (await api.integrations.list(LOOP19)).find((i) => i.status === 'error')!;
        const f = await api.integrations.sync(LOOP19, failing.id);
        expect(f.status).toBe('error');
        expect(f.syncHistory![0]!.ok).toBe(false);
        // Metrics are unchanged by a simulated sync.
        expect(d.all('dailyMetrics').filter((m) => m.brandId === CMS)).toHaveLength(90);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('VCA demo: insights, chat and work', () => {
    it('insight detail names its agent and task; review status changes work', async () => {
        const api = vca();
        const i = await api.insights.get(CMS, 'vd_cms_ins_6');
        expect(i.assignedAgentName).toBe('Technical SEO Agent');
        expect(i.task).toMatchObject({ id: 'vd_cms_tsk_1', title: 'Audit title tags' });
        const approved = await api.insights.setStatus(CMS, 'vd_cms_ins_1', 'approved', 'ok');
        expect(approved.status).toBe('approved');
        expect((await api.insights.list(CMS, { status: 'open' })).every((x) => x.status === 'pending' || x.status === 'reviewed')).toBe(true);
    });

    it('chat conversations stay inside the client and website; messages are simulated', async () => {
        const api = vca();
        const convs = await api.chat.list(CMS);
        expect(convs.filter((c) => c.id.startsWith('vd_cms_')).length).toBe(9);
        const msgs = await api.chat.messages(CMS, 'vd_cms_cnv_7');
        expect(msgs.length).toBeGreaterThan(5);
        expect(msgs.filter((m) => m.author.type === 'agent').every((m) => m.mode === 'simulated')).toBe(true);
        await expect(api.chat.messages(LIPSKY, 'vd_cms_cnv_7')).rejects.toThrow();
        const executions = await api.agents.executions(CMS);
        expect(executions.length).toBeGreaterThan(20);
        expect(executions.every((e) => e.mode === 'simulated' && e.costUsd === 0)).toBe(true);
    });

    it('a simulated approval can be decided without any external effect', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const d = db();
        const api = vca(d);
        const pending = (await api.work.approvals(CMS, { status: 'pending' })).find((a) => a.simulated)!;
        const decided = await api.work.decideApproval(CMS, pending.id, 'approved', 'demo');
        expect(decided.status).toBe('approved');
        expect(d.all('n8nDeliveries')).toHaveLength(0);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('knowledge documents are per client and searchable', async () => {
        const api = vca();
        const docs = await api.knowledge.list(LOOP19);
        expect(docs.filter((x) => x.id.startsWith('vd_loop19_'))).toHaveLength(5);
        expect((await api.knowledge.list(CMS)).every((x) => x.brandId === CMS)).toBe(true);
    });
});
