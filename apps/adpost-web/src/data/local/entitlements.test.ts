import { as, IDS, testDb } from '@/test/helpers';
import { PlanLimitError } from '../errors';
import { Scope } from './scope';
import { runAgent } from './engine';
import { usageVsLimits } from '@/domain/plans';
import type { PlanKey } from '@/domain/plans';

const { pod } = IDS.brands;

function onPlan(plan: PlanKey) {
    const db = testDb();
    db.patch('agencies', IDS.agency, { planKey: plan });
    return db;
}

describe('plans & entitlements', () => {
    it('internal plan (ADPOST today) is unlimited', async () => {
        const db = testDb();
        expect(db.find('agencies', IDS.agency)!.planKey).toBe('internal');
        await expect(as('alex', db).api.workspace.createBrand({ name: 'Extra' })).resolves.toBeTruthy();
        const usage = await as('alex', db).api.workspace.agencyUsage();
        expect(usage).toMatchObject({ planKey: 'internal', brands: 6 });
        expect(usageVsLimits(usage).every((r) => r.limit === null)).toBe(true);
    });

    it('brand and member limits are enforced', async () => {
        const db = onPlan('starter');
        await expect(as('alex', db).api.workspace.createBrand({ name: 'Extra' })).rejects.toBeInstanceOf(PlanLimitError); // 5 brands > 1
        db.patch('agencies', IDS.agency, { planKey: 'growth' });
        // growth: 20 members/brand; POD has 4 → fine
        await expect(as('priya', db).api.invitations.send(pod, { email: 'seat@example.test', role: 'member' })).resolves.toBeTruthy();
    });

    it('feature gates: starter has no team chat, studio or automation', async () => {
        const db = onPlan('starter');
        const api = as('priya', db).api;
        await expect(api.chat.createGroup(pod, { team: 'seo' })).rejects.toBeInstanceOf(PlanLimitError);
        await expect(api.studio.create(pod, { websiteId: 'web_pod_1', title: 't', brief: 'b' })).rejects.toBeInstanceOf(PlanLimitError);
        await expect(api.automation.save(pod, { name: 'n', webhookUrl: 'https://h.example.test/x', events: [] })).rejects.toBeInstanceOf(PlanLimitError);
        await expect(api.intelligence.overview(pod, { from: '2026-10-01', to: '2026-10-24' })).resolves.toBeTruthy();
    });

    it('monthly agent run quota limits executions without calling the provider', async () => {
        const db = onPlan('starter');
        const scope = new Scope(db, IDS.users.priya);
        // 500 runs already this month across the agency (spread over agents so per-agent daily limits do not interfere).
        const base = (await runAgent(scope, pod, { agentInstanceId: 'agt_pod_statistics_seo', conversationId: null, triggerMessageId: null, messages: [] })).execution;
        db.insertMany('executions', Array.from({ length: 499 }, (_, i) => ({ ...base, id: `seed_${i}`, agentInstanceId: `agt_seed_${i}` })));
        const r = await runAgent(scope, pod, { agentInstanceId: 'agt_pod_statistics_seo', conversationId: null, triggerMessageId: null, messages: [] });
        expect(r.execution).toMatchObject({ status: 'limited', error: expect.stringContaining('Monthly agent run quota') });
    });

    it('only agency staff can read agency usage', async () => {
        await expect(as('priya').api.workspace.agencyUsage()).rejects.toThrow('Only agency staff');
    });
});
