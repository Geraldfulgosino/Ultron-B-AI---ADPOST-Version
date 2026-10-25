import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { FIXTURE_END_DATE } from './fixtures';
import { validateWebhookUrl } from './automation';

const { pod, dmd } = IDS.brands;
const range = { from: '2026-09-27', to: FIXTURE_END_DATE };

describe('analytics', () => {
    it('dashboard KPIs use the 28 days ending on the latest data date', async () => {
        const d = await as('priya').api.analytics.dashboard(pod);
        expect(d.window).toEqual({ from: '2026-09-27', to: FIXTURE_END_DATE });
        expect(d.sessionsTrend).toHaveLength(28);
        expect(d.counts).toMatchObject({ clients: 2, websites: 2 });
        expect(d.kpis.sessions.current).toBeGreaterThan(0);
    });

    it('client user analytics include only their client', async () => {
        const all = await as('priya').api.analytics.dashboard(pod);
        const mine = await as('casey').api.analytics.dashboard(pod);
        expect(mine.counts).toMatchObject({ clients: 1, websites: 1 });
        expect(mine.kpis.sessions.current).toBeLessThan(all.kpis.sessions.current);
        expect(mine.integrations.every((i) => i.websiteId === 'web_pod_1')).toBe(true);
    });

    it('cross-brand analytics are denied and foreign website filters rejected', async () => {
        await expect(as('priya').api.analytics.dashboard(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('priya').api.analytics.seoOverview(pod, { ...range, websiteId: 'web_dmd_1' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('casey').api.analytics.seoOverview(pod, { ...range, websiteId: 'web_pod_2' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('validates date ranges', async () => {
        await expect(as('priya').api.analytics.seoOverview(pod, { from: '2026-10-10', to: '2026-10-01' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('priya').api.analytics.seoOverview(pod, { from: 'yesterday', to: '2026-10-01' })).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('reports', () => {
    it('client user report excludes other clients\' websites', async () => {
        const r = await as('casey').api.reports.preview(pod, { ...range, websiteId: null, source: 'all' });
        expect(r.websites.map((w) => w.id)).toEqual(['web_pod_1']);
        const staff = await as('priya').api.reports.preview(pod, { ...range, websiteId: 'web_pod_1', source: 'all' });
        expect(r.summary).toEqual(staff.summary);
    });

    it('recording an export emits a simulated automation delivery when subscribed', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        await priya.automation.save(pod, { name: 'n8n', webhookUrl: 'https://hooks.example.test/webhook/abc', events: ['report.generated'] });
        await priya.reports.recordExport(pod, 'csv');
        const state = await priya.automation.get(pod);
        expect(state.deliveries.map((d) => [d.event, d.status])).toEqual([['report.generated', 'simulated']]);
    });
});

describe('insights', () => {
    it('lists seeded insights; client sees only own; foreign brand denied', async () => {
        const staff = await as('priya').api.insights.list(pod);
        const client = await as('casey').api.insights.list(pod);
        expect(staff.length).toBeGreaterThan(client.length);
        expect(client.every((i) => i.websiteId === 'web_pod_1')).toBe(true);
        await expect(as('priya').api.insights.list(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('review workflow: reviewed → approved → reopened, with notes and audit', async () => {
        const db = testDb();
        const api = as('morgan', db).api; // POD manager can review
        const [first] = await api.insights.list(pod, { status: 'pending' });
        await api.insights.setStatus(pod, first!.id, 'reviewed', 'Looks right');
        const approved = await api.insights.setStatus(pod, first!.id, 'approved');
        expect(approved).toMatchObject({ status: 'approved', reviewNotes: 'Looks right', reviewedBy: IDS.users.morgan });
        const reopened = await api.insights.setStatus(pod, first!.id, 'pending');
        expect(reopened.reviewedBy).toBeNull();
        await expect(api.insights.setStatus(pod, first!.id, 'pending')).rejects.toBeInstanceOf(ValidationError);
    });

    it('viewers and clients cannot change status', async () => {
        const [first] = await as('priya').api.insights.list(pod);
        await expect(as('vic').api.insights.setStatus(pod, first!.id, 'dismissed')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('casey').api.insights.setStatus(pod, first!.id, 'dismissed')).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('bulk update rejects foreign ids atomically', async () => {
        const db = testDb();
        const [mine] = await as('priya', db).api.insights.list(pod);
        const [theirs] = await as('dana', db).api.insights.list(dmd);
        await expect(as('priya', db).api.insights.bulkSetStatus(pod, [mine!.id, theirs!.id], 'dismissed')).rejects.toBeInstanceOf(NotFoundError);
        expect(db.find('seoInsights', mine!.id)!.status).toBe('pending');
        expect(await as('priya', db).api.insights.bulkSetStatus(pod, [mine!.id], 'dismissed')).toEqual({ updated: 1 });
    });

    it('generate does not duplicate open subjects', async () => {
        const db = testDb();
        expect(await as('priya', db).api.insights.generate(pod)).toEqual({ created: 0 });
    });
});

describe('integrations', () => {
    it('connect creates pending (OAuth is server-side), sync is simulated, admin-only disconnect', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        await expect(priya.integrations.connect(pod, 'web_pod_1', 'google_analytics')).rejects.toBeInstanceOf(ValidationError);
        await priya.integrations.disconnect(pod, 'int_web_pod_1_ga4');
        const pending = await priya.integrations.connect(pod, 'web_pod_1', 'google_analytics');
        expect(pending.status).toBe('pending');
        await expect(priya.integrations.sync(pod, pending.id)).rejects.toBeInstanceOf(ValidationError);
        const synced = await as('morgan', db).api.integrations.sync(pod, 'int_web_pod_1_gsc');
        expect(synced.lastSyncedAt).toBe('2026-10-25T12:00:00.000Z');
        await expect(as('morgan', db).api.integrations.disconnect(pod, 'int_web_pod_1_gsc')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.integrations.connect(pod, 'web_dmd_1', 'google_analytics')).rejects.toBeInstanceOf(ValidationError);
    });

    it('never exposes credentials', async () => {
        const list = await as('priya').api.integrations.list(pod);
        const keys = list.flatMap((i) => Object.keys(i));
        expect(keys.filter((k) => /token|secret|credential|password/i.test(k))).toEqual([]);
    });
});

describe('automation', () => {
    it('validates webhook URLs', () => {
        expect(validateWebhookUrl('https://n8n.example.test/webhook/x')).toBeNull();
        expect(validateWebhookUrl('http://n8n:5678/webhook/x')).toBeNull();
        expect(validateWebhookUrl('http://evil.example/x')).not.toBeNull();
        expect(validateWebhookUrl('https://user:pass@x.test/')).not.toBeNull();
        expect(validateWebhookUrl('not a url')).not.toBeNull();
    });

    it('stores only the host; full URL never returned; admin only; isolated', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        await priya.automation.save(pod, { name: 'Main', webhookUrl: 'https://hooks.example.test/webhook/s3cr3t-path', events: ['insight.approved'] });
        const state = await priya.automation.get(pod);
        expect(state.connection?.webhookHost).toBe('hooks.example.test');
        expect(JSON.stringify(state)).not.toContain('s3cr3t-path');
        await expect(as('morgan', db).api.automation.get(pod)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('dana', db).api.automation.get(pod)).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await priya.automation.test(pod)).status).toBe('simulated');
        await priya.automation.clearDeliveries(pod);
        expect((await priya.automation.get(pod)).deliveries).toEqual([]);
        await priya.automation.disconnect(pod);
        expect((await priya.automation.get(pod)).connection).toBeNull();
    });
});
