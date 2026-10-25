import { compareWebsites, detectAnomalies, expectedCtr, scoreOpportunities } from './intelligence';
import { as, IDS, testDb } from '@/test/helpers';
import { AccessDeniedError, ValidationError } from '@/data/errors';
import { FIXTURE_END_DATE } from '@/data/local/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';

const { pod } = IDS.brands;
const range = { from: '2026-09-27', to: FIXTURE_END_DATE };

describe('intelligence (pure)', () => {
    it('flags a spike against the trailing window, not normal noise', () => {
        const base = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: 100 + (i % 3) }));
        base[17] = { ...base[17]!, value: 300 };
        const found = detectAnomalies(base);
        expect(found.map((a) => a.date)).toEqual(['2026-10-18']);
        expect(found[0]!.z).toBeGreaterThan(2.5);
        expect(detectAnomalies(base.slice(0, 10))).toEqual([]); // not enough history
    });

    it('expected CTR curve and opportunity scoring', () => {
        expect(expectedCtr(1)).toBe(0.28);
        expect(expectedCtr(3.4)).toBe(0.1);
        expect(expectedCtr(15)).toBe(0.01);
        const ops = scoreOpportunities(
            [
                { id: 'a', brandId: 'b', clientId: 'c', websiteId: 'w', date: '2026-10-01', query: 'low ctr top spot', clicks: 10, impressions: 1000, position: 1.2 },
                { id: 'b', brandId: 'b', clientId: 'c', websiteId: 'w', date: '2026-10-01', query: 'healthy', clicks: 300, impressions: 1000, position: 1 },
            ],
            '2026-10-01', '2026-10-07',
        );
        expect(ops.map((o) => [o.query, o.ctrGap])).toEqual([['low ctr top spot', 270]]);
    });

    it('website comparison computes deltas vs the previous window', () => {
        const db = testDb();
        const rows = compareWebsites(db.all('websites').filter((w) => w.brandId === pod), db.all('dailyMetrics'), range.from, range.to);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.sessions).toBeGreaterThanOrEqual(rows[1]!.sessions);
        expect(rows.every((r) => r.sessionsDelta !== null)).toBe(true);
    });
});

describe('intelligence API', () => {
    it('finds the seeded POD spike; client scoping applies', async () => {
        const o = await as('priya').api.intelligence.overview(pod, range);
        expect(o.anomalies.some((a) => a.websiteId === 'web_pod_1' && a.metric === 'sessions' && a.direction === 'spike')).toBe(true);
        const c = await as('casey').api.intelligence.overview(pod, range);
        expect(c.comparison.map((r) => r.websiteId)).toEqual(['web_pod_1']);
        await expect(as('casey').api.intelligence.overview(pod, { ...range, websiteId: 'web_pod_2' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('priya').api.intelligence.overview(IDS.brands.dmd, range)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('discussInsight opens an SEO Manager chat seeded with the insight', async () => {
        const db = testDb();
        const [ins] = await as('priya', db).api.insights.list(pod);
        const { conversationId } = await as('priya', db).api.intelligence.discussInsight(pod, ins!.id);
        const msgs = await as('priya', db).api.chat.messages(pod, conversationId);
        expect(msgs[0]!.body).toContain(ins!.title);
        expect(msgs[1]!.author).toEqual({ type: 'agent', agentInstanceId: 'agt_pod_seo_manager' });
        await expect(as('vic', db).api.intelligence.discussInsight(pod, ins!.id)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('UI: renders comparison, anomalies and opportunities; insight discuss navigates to chat', async () => {
        const { router } = await renderApp('/b/pod/seo/intelligence', 'priya');
        expect(await screen.findByText('Website comparison')).toBeInTheDocument();
        expect(within(await screen.findByRole('list', { name: 'Anomalies' })).getAllByRole('listitem').length).toBeGreaterThan(0);
        expect(screen.getByRole('list', { name: 'Opportunities' })).toBeInTheDocument();
        await router.navigate('/b/pod/seo/insights/ins_pod_1');
        await userEvent.click(await screen.findByRole('button', { name: 'Discuss with SEO Manager' }));
        await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/b\/pod\/chat\/cnv_/));
    });
});
