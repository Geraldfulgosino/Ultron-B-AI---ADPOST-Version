import { describe, expect, it } from 'vitest';
import { buildSampleSeed, applySampleSeed, sampleClientId } from './sampleSeed';
import { LocalDatabase, type DbSnapshot, type TableName } from './db';
import { apiFor } from './backend';
import { applyVcaDemo, isDemoRowId, resetVcaDemo, VCA_DEMO_CLIENTS, VCA_DEMO_DAYS, VCA_DEMO_END } from './vcaDemo';
import { AccessDeniedError } from '../errors';
import { healthScore } from '@/domain/audit';

const BRANDS = { cms: sampleClientId('vca', 'cms'), lipsky: sampleClientId('vca', 'lipsky'), hldc: sampleClientId('vca', 'hamptons'), loop19: sampleClientId('vca', 'loop19') };
const fresh = () => {
    const { snapshot, credentials } = buildSampleSeed();
    return new LocalDatabase(snapshot, credentials, { now: () => new Date('2026-11-25T12:00:00Z') });
};
const sum = (rows: Array<Record<string, unknown>>, k: string) => rows.reduce((a, r) => a + (r[k] as number), 0);

describe('VCA demo dataset', () => {
    it('is deterministic and owned by the demo id prefix', () => {
        const a = buildSampleSeed().snapshot;
        const b = buildSampleSeed().snapshot;
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        for (const t of ['dailyMetrics', 'seoInsights', 'messages', 'tasks', 'approvals', 'siteAudits', 'knowledgeDocuments'] as TableName[]) {
            const rows = (a[t] as Array<{ id: string; brandId: string }>).filter((r) => Object.values(BRANDS).includes(r.brandId));
            expect(rows.length, t).toBeGreaterThan(0);
            expect(rows.every((r) => isDemoRowId(r.id)), t).toBe(true);
        }
    });

    it('covers all four VCA clients with 90 days ending on the fixed end date, on their existing demo websites only', () => {
        const s = buildSampleSeed().snapshot;
        for (const spec of VCA_DEMO_CLIENTS) {
            const brandId = BRANDS[spec.key];
            const m = s.dailyMetrics.filter((x) => x.brandId === brandId);
            expect(m).toHaveLength(VCA_DEMO_DAYS);
            expect(m[m.length - 1]!.date).toBe(VCA_DEMO_END);
            const site = s.websites.find((w) => w.id === m[0]!.websiteId)!;
            expect(site.isDemo).toBe(true);
            expect(site.domain).toMatch(/\.example$/);
            expect(site.environment).toBe('production');
            // Baselines are approximate monthly averages over the 90 days.
            const perMonth = (k: string) => (sum(m as never, k) / VCA_DEMO_DAYS) * 30.4375;
            expect(perMonth('sessions') / spec.monthly.sessions).toBeGreaterThan(0.97);
            expect(perMonth('sessions') / spec.monthly.sessions).toBeLessThan(1.03);
            expect(perMonth('impressions') / spec.monthly.impressions).toBeGreaterThan(0.97);
            expect(perMonth('clicks') / spec.monthly.clicks).toBeGreaterThan(0.95);
        }
        // Other agencies' clients get nothing.
        expect(s.dailyMetrics.every((x) => Object.values(BRANDS).includes(x.brandId))).toBe(true);
    });

    it('keeps breakdowns, queries and pages consistent with the daily totals', () => {
        const s = buildSampleSeed().snapshot;
        for (const brandId of Object.values(BRANDS)) {
            const m = s.dailyMetrics.filter((x) => x.brandId === brandId);
            for (const r of m) {
                const b = r.breakdown!;
                const total = (o: Record<string, number>) => Object.values(o).reduce((a, x) => a + x, 0);
                expect(total(b.device)).toBe(r.sessions);
                expect(total(b.source)).toBe(r.sessions);
                expect(total(b.country)).toBe(r.sessions);
                expect(total(b.searchDevice)).toBe(r.clicks);
                expect(total(b.searchCountry)).toBe(r.clicks);
                expect(r.clicks).toBeLessThanOrEqual(r.impressions);
                expect(r.engagedSessions!).toBeLessThanOrEqual(r.sessions);
            }
            const weeks = new Set(s.searchQueries.filter((q) => q.brandId === brandId).map((q) => q.date));
            for (const w of weeks) {
                const days = m.filter((x) => x.date >= w && x.date < new Date(Date.parse(w) + 7 * 86_400_000).toISOString().slice(0, 10));
                const q = s.searchQueries.filter((x) => x.brandId === brandId && x.date === w);
                const p = s.landingPages.filter((x) => x.brandId === brandId && x.date === w);
                expect(sum(q as never, 'clicks')).toBeLessThanOrEqual(sum(days as never, 'clicks'));
                expect(sum(q as never, 'impressions')).toBeLessThanOrEqual(sum(days as never, 'impressions'));
                expect(sum(p as never, 'sessions')).toBeLessThanOrEqual(sum(days as never, 'sessions'));
            }
        }
    });

    it('labels everything simulated and never uses a real-looking property id or token', () => {
        const s = buildSampleSeed().snapshot;
        const demo = <R extends { brandId: string }>(rows: R[]) => rows.filter((r) => Object.values(BRANDS).includes(r.brandId));
        for (const i of demo(s.integrations)) {
            expect(i.simulated).toBe(true);
            expect(i.externalPropertyName).toMatch(/Simulated/);
            expect(i.externalPropertyName).not.toMatch(/properties\/\d|G-[A-Z0-9]{6,}|UA-\d/);
        }
        expect(demo(s.seoInsights).every((i) => i.simulated)).toBe(true);
        expect(demo(s.siteAudits).every((a) => a.simulated)).toBe(true);
        expect(demo(s.approvals).every((a) => a.simulated && a.payload.simulated === 'true')).toBe(true);
        const agentMsgs = demo(s.messages).filter((m) => m.author.type === 'agent');
        expect(agentMsgs.length).toBeGreaterThan(20);
        expect(agentMsgs.every((m) => m.mode === 'simulated' && /Simulated demo response/.test(m.body))).toBe(true);
        expect(demo(s.executions).every((e) => e.mode === 'simulated' && e.provider === 'simulated' && e.costUsd === 0)).toBe(true);
        // Competitors are fictitious .example domains.
        expect(demo(s.siteAudits).flatMap((a) => a.competitors).filter((c) => !c.isSelf).every((c) => c.domain.endsWith('.example'))).toBe(true);
    });

    it('links insights, tasks, approvals, conversations and executions inside one client', () => {
        const s = buildSampleSeed().snapshot;
        for (const brandId of Object.values(BRANDS)) {
            const ins = s.seoInsights.filter((i) => i.brandId === brandId);
            expect(ins.length).toBeGreaterThanOrEqual(8);
            expect(ins.length).toBeLessThanOrEqual(12);
            const tasks = s.tasks.filter((t) => t.brandId === brandId);
            for (const t of tasks.filter((t) => t.insightId)) expect(ins.find((i) => i.id === t.insightId)?.taskId).toBe(t.id);
            const agents = new Set(s.agentInstances.filter((a) => a.brandId === brandId).map((a) => a.id));
            for (const i of ins) expect(agents.has(i.assignedAgentId!)).toBe(true);
            const convs = s.conversations.filter((c) => c.brandId === brandId);
            expect(convs.length).toBeGreaterThanOrEqual(9);
            expect(new Set(convs.map((c) => c.teamKey))).toEqual(new Set([null, 'seo', 'web', 'all']));
            const site = ins[0]!.websiteId;
            for (const c of convs) {
                expect(c.websiteId).toBe(site);
                expect(c.agentInstanceIds.every((id) => agents.has(id))).toBe(true);
            }
            for (const m of s.messages.filter((m) => m.brandId === brandId)) {
                expect(convs.some((c) => c.id === m.conversationId)).toBe(true);
                if (m.executionId) expect(s.executions.find((e) => e.id === m.executionId)?.brandId).toBe(brandId);
                for (const p of m.proposals) if (p.resultId && p.action.type !== 'delegate') expect([...tasks, ...s.approvals.filter((a) => a.brandId === brandId)].some((r) => r.id === p.resultId)).toBe(true);
            }
            for (const a of s.approvals.filter((a) => a.brandId === brandId)) if (a.taskId) expect(tasks.some((t) => t.id === a.taskId)).toBe(true);
        }
    });

    it('tells the CMS decline story in the data the agents quote', () => {
        const s = buildSampleSeed().snapshot;
        const m = s.dailyMetrics.filter((x) => x.brandId === BRANDS.cms);
        const cur = sum(m.slice(-28) as never, 'clicks');
        const prev = sum(m.slice(-56, -28) as never, 'clicks');
        expect(cur).toBeLessThan(prev * 0.92);
        const answer = s.messages.find((x) => x.id === 'vd_cms_cnv_1_m1')!;
        expect(answer.body).toContain(cur.toLocaleString('en-US'));
        expect(answer.body).toContain(prev.toLocaleString('en-US'));
        expect(answer.body).toContain('construction seo services');
    });

    it('is idempotent and never re-creates rows the user removed', () => {
        const s = buildSampleSeed().snapshot;
        const count = s.dailyMetrics.length + s.messages.length;
        applySampleSeed(s);
        applyVcaDemo(s);
        expect(s.dailyMetrics.length + s.messages.length).toBe(count);
        s.tasks = s.tasks.filter((t) => t.id !== 'vd_cms_tsk_1');
        applySampleSeed(s);
        expect(s.tasks.some((t) => t.id === 'vd_cms_tsk_1')).toBe(false);
    });

    it('does not touch websites or create clients', () => {
        const before = buildSampleSeed().snapshot;
        const { snapshot } = buildSampleSeed();
        expect(snapshot.websites).toEqual(before.websites);
        expect(snapshot.brands.filter((b) => b.agencyId === 'agy_vca').map((b) => b.name).sort()).toEqual(['CMS', 'HLDC', 'LIPSKY', 'LOOP19']);
    });

    it('skips a client whose demo website is gone instead of creating one', () => {
        const { snapshot } = buildSampleSeed();
        const s: DbSnapshot = structuredClone(snapshot);
        // Simulate an older database without the demo step and without the CMS demo website.
        s.seedSteps = s.seedSteps.filter((x) => !x.id.startsWith('vca-demo'));
        for (const t of Object.keys(s) as TableName[]) (s[t] as Array<{ id?: string }>) = (s[t] as Array<{ id?: string }>).filter((r) => !r.id || !isDemoRowId(r.id));
        s.websites = s.websites.filter((w) => w.id !== 'web_demo_vca_cms_prod');
        applyVcaDemo(s);
        expect(s.dailyMetrics.some((m) => m.brandId === BRANDS.cms)).toBe(false);
        expect(s.websites.some((w) => w.id === 'web_demo_vca_cms_prod')).toBe(false);
        expect(s.dailyMetrics.some((m) => m.brandId === BRANDS.lipsky)).toBe(true);
    });

    it('reset restores only demo-owned rows of one client and keeps user records', async () => {
        const db = fresh();
        const api = apiFor(db, 'usr_vca_admin');
        const project = await api.work.createProject(BRANDS.cms, { name: 'My own project', description: 'user data' });
        await api.insights.setStatus(BRANDS.cms, 'vd_cms_ins_1', 'dismissed', 'changed by user');
        db.delete('tasks', (t) => t.id === 'vd_cms_tsk_2');
        const lipskyBefore = JSON.stringify(db.all('messages').filter((m) => m.brandId === BRANDS.lipsky));
        const r = resetVcaDemo(db, BRANDS.cms);
        expect(r.created).toBeGreaterThan(r.removed - 1);
        expect(db.find('seoInsights', 'vd_cms_ins_1')!.status).toBe('pending');
        expect(db.find('tasks', 'vd_cms_tsk_2')).toBeDefined();
        expect(db.find('projects', project.id)).toBeDefined();
        expect(JSON.stringify(db.all('messages').filter((m) => m.brandId === BRANDS.lipsky))).toBe(lipskyBefore);
        const ids = db.all('dailyMetrics').map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('health scores are explainable and recomputed from issues', () => {
        const s = buildSampleSeed().snapshot;
        const a = s.siteAudits.find((x) => x.brandId === BRANDS.hldc)!;
        const h = healthScore(a.issues, a.pagesCrawled);
        expect(h.score).toBe(Math.max(0, Math.round(100 - h.lines.reduce((x, l) => x + l.deduction, 0))));
        expect(h.lines.every((l) => l.deduction <= 15)).toBe(true);
    });
});

describe('VCA demo isolation', () => {
    it('VCA Admin sees all four clients; other agencies see none of their data', async () => {
        const db = fresh();
        const vca = apiFor(db, 'usr_vca_admin');
        for (const brandId of Object.values(BRANDS)) expect((await vca.analytics.dashboard(brandId)).kpis.sessions.current).toBeGreaterThan(0);
        const adpost = apiFor(db, 'usr_adpost_admin');
        await expect(adpost.analytics.dashboard(BRANDS.cms)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(adpost.insights.list(BRANDS.lipsky)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(adpost.chat.list(BRANDS.hldc)).rejects.toBeInstanceOf(AccessDeniedError);
        const platform = apiFor(db, 'usr_platform');
        expect((await platform.analytics.dashboard(BRANDS.loop19)).counts.websites).toBeGreaterThan(0);
    });

    it('client dashboards never mix metrics between clients', async () => {
        const db = fresh();
        const vca = apiFor(db, 'usr_vca_admin');
        const cms = await vca.analytics.dashboard(BRANDS.cms);
        const lipsky = await vca.analytics.dashboard(BRANDS.lipsky);
        const own = (brandId: string) => sum(db.all('dailyMetrics').filter((m) => m.brandId === brandId && m.date >= cms.window!.from && m.date <= cms.window!.to) as never, 'sessions');
        expect(cms.kpis.sessions.current).toBe(own(BRANDS.cms));
        expect(lipsky.kpis.sessions.current).toBe(own(BRANDS.lipsky));
        expect(cms.recentInsights.every((i) => i.brandId === BRANDS.cms)).toBe(true);
        expect(lipsky.integrations.every((i) => i.brandId === BRANDS.lipsky)).toBe(true);
    });

    it('the LIPSKY Client User reads only LIPSKY and only shared conversations', async () => {
        const db = fresh();
        const client = apiFor(db, 'usr_lipsky_client');
        expect((await client.analytics.dashboard(BRANDS.lipsky)).kpis.clicks.current).toBeGreaterThan(0);
        await expect(client.analytics.dashboard(BRANDS.cms)).rejects.toBeInstanceOf(AccessDeniedError);
        const convs = await client.chat.list(BRANDS.lipsky);
        expect(convs.length).toBeGreaterThan(0);
        expect(convs.every((c) => c.visibility === 'client_shared')).toBe(true);
        await expect(client.work.approvals(BRANDS.lipsky)).rejects.toBeInstanceOf(AccessDeniedError);
    });
});
