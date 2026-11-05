/** Website- and client-scoped AI context (local adapter; mirrors conversations_website_guard and allowedHostsFor). */
import { ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { Scope } from './scope';
import { brandContext } from './engine';

const { pod } = IDS.brands;
const podManager = 'agt_pod_seo_manager';

describe('website-scoped conversations', () => {
    it('a conversation can be scoped to one of the client’s websites, never another client’s or an archived one', async () => {
        const db = testDb();
        const { api } = as('priya', db);
        const c = await api.chat.createDirect(pod, podManager, undefined, { websiteId: 'web_pod_2' });
        expect(c.websiteId).toBe('web_pod_2');
        await expect(api.chat.createDirect(pod, podManager, undefined, { websiteId: 'web_dmd_1' })).rejects.toBeInstanceOf(ValidationError);
        await api.websites.update(pod, 'web_pod_1', { status: 'archived' });
        await expect(api.chat.createGroup(pod, { team: 'seo', websiteId: 'web_pod_1' })).rejects.toBeInstanceOf(ValidationError);
        expect((await api.chat.createGroup(pod, { team: 'seo' })).websiteId).toBeNull();
    });

    it('agent context is limited to the scoped website; the unscoped context covers all of the client’s websites only', () => {
        const db = testDb();
        const scope = new Scope(db, IDS.users.priya);
        const all = brandContext(scope, pod, 'traffic');
        const one = brandContext(scope, pod, 'traffic', undefined, 'web_pod_1');
        const other = brandContext(scope, pod, 'traffic', undefined, 'web_pod_2');
        expect(one.kpis.sessions + other.kpis.sessions).toBe(all.kpis.sessions);
        expect(one.kpis.sessions).toBeGreaterThan(0);
        expect(one.topQueries.every((q) => q.query.startsWith('shop'))).toBe(true);
        expect(other.topQueries.every((q) => q.query.startsWith('blog'))).toBe(true);
        // A DMD website id under the POD client yields nothing from DMD.
        expect(brandContext(scope, pod, 'traffic', undefined, 'web_dmd_1').kpis.sessions).toBe(0);
    });
});
