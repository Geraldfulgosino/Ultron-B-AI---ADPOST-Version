/** Agencies, clients and websites on the dev sample seed (mirrors hierarchy.db.test.ts). */
import { AccessDeniedError, ValidationError } from '../errors';
import { apiFor } from './backend';
import { LocalDatabase } from './db';
import { applySampleSeed, buildSampleSeed, sampleClientId } from './sampleSeed';

const sampleDb = () => {
    const { snapshot, credentials } = buildSampleSeed();
    return new LocalDatabase(snapshot, credentials, { now: () => new Date('2026-11-05T12:00:00.000Z') });
};
const api = (db: LocalDatabase, userId: string) => apiFor(db, userId);
const POD = sampleClientId('adpost', 'pod');
const DSP = sampleClientId('adpost', 'dsp');

describe('dev sample seed', () => {
    it('has exactly 3 agencies and 10 clients (5 / 4 / 1), each with six agents, and no websites or metrics', () => {
        const db = sampleDb();
        expect(db.all('agencies').map((a) => a.name).sort()).toEqual(['ADPOST', 'Lugenix Digital Services', 'VCA']);
        const by = (slug: string) => db.all('brands').filter((b) => b.agencySlug === slug).map((b) => b.name).sort();
        expect(by('adpost')).toEqual(['DSP', 'FMF', 'POD', 'STUDIO PILATES', 'TRADE BAGS']);
        expect(by('vca')).toEqual(['CMS', 'HAMPTONS', 'LIPSKY', 'LOOP19']);
        expect(by('lugenix-digital-services')).toEqual(['GoldStar ATM']);
        expect(db.all('brands')).toHaveLength(10);
        expect(db.all('brands').every((b) => b.status === 'active')).toBe(true);
        expect(db.all('agentInstances')).toHaveLength(60);
        for (const t of ['websites', 'dailyMetrics', 'searchQueries', 'seoInsights', 'integrations', 'knowledgeDocuments', 'invitations'] as const) {
            expect(db.all(t), t).toHaveLength(0);
        }
        expect(db.all('aiConnections').every((c) => c.provider === 'simulated')).toBe(true);
    });

    it('is idempotent', () => {
        const { snapshot } = buildSampleSeed();
        const again = applySampleSeed(applySampleSeed(structuredClone(snapshot)));
        for (const t of ['agencies', 'brands', 'agentInstances', 'users', 'agencyMemberships', 'aiConnections'] as const) {
            expect(again[t].length, t).toBe(snapshot[t].length);
        }
    });
});

describe('agencies', () => {
    it('platform admins see the directory and totals, create agencies, but no client data', async () => {
        const db = sampleDb();
        const p = api(db, 'usr_platform');
        expect(await p.agencies.isPlatformAdmin()).toBe(true);
        const list = await p.agencies.list();
        expect(list.map((a) => [a.name, a.counts])).toEqual([['ADPOST', null], ['Lugenix Digital Services', null], ['VCA', null]]);
        expect(await p.agencies.platformOverview()).toMatchObject({ agencies: 3, clients: 10, websites: 0 });
        expect(await p.agencies.clients('agy_adpost')).toEqual([]);
        await expect(p.agencies.overview('agy_adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        const north = await p.agencies.create({ name: 'North Agency' });
        expect(north).toMatchObject({ slug: 'north-agency', status: 'active', access: { isMember: true, canAddClients: true } });
        await expect(p.agencies.create({ name: 'ADPOST' })).rejects.toBeInstanceOf(ValidationError);
        await expect(p.agencies.create({ name: 'Bad', slug: 'Bad Slug' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('only platform admins create agencies or change their status; agency admins edit their profile', async () => {
        const db = sampleDb();
        const admin = api(db, 'usr_adpost_admin');
        await expect(admin.agencies.create({ name: 'Rogue' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(admin.agencies.platformOverview()).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await admin.agencies.update('agy_adpost', { description: 'Digital agency' })).description).toBe('Digital agency');
        await expect(admin.agencies.update('agy_adpost', { status: 'archived' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(admin.agencies.update('agy_adpost', { contactEmail: 'not-an-email' })).rejects.toBeInstanceOf(ValidationError);
        const p = api(db, 'usr_platform');
        expect((await p.agencies.update('agy_vca', { status: 'archived' })).archivedAt).not.toBeNull();
        expect((await p.agencies.list({ status: 'archived' })).map((a) => a.slug)).toEqual(['vca']);
        expect((await p.agencies.update('agy_vca', { status: 'active' })).archivedAt).toBeNull();
    });

    it('agency members see only their agency; counts reflect real records', async () => {
        const db = sampleDb();
        expect((await api(db, 'usr_adpost_admin').agencies.list()).map((a) => [a.slug, a.counts])).toEqual([
            ['adpost', { clients: 5, activeClients: 5, archivedClients: 0, websites: 0 }],
        ]);
        expect((await api(db, 'usr_vca_admin').agencies.list()).map((a) => a.slug)).toEqual(['vca']);
        await expect(api(db, 'usr_vca_admin').agencies.bySlug('adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api(db, 'usr_vca_admin').agencies.clients('agy_adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        const seo = api(db, 'usr_pod_seo');
        expect((await seo.agencies.list()).map((a) => [a.slug, a.counts?.clients])).toEqual([['adpost', 1]]);
        expect((await seo.agencies.clients('agy_adpost')).map((c) => c.client.name)).toEqual(['POD']);
        const overview = await api(db, 'usr_adpost_admin').agencies.overview('agy_adpost');
        expect(overview).toMatchObject({ clients: 5, websites: 0, activeProjects: 0, openTasks: 0, integrations: { connected: 0, pending: 0, error: 0 } });
    });
});

describe('clients', () => {
    it('agency owners add clients (six agents each); slugs are unique per agency but reusable across agencies', async () => {
        const db = sampleDb();
        const admin = api(db, 'usr_adpost_admin');
        const c = await admin.agencies.createClient('agy_adpost', { name: 'Northwind Labs', industry: 'Retail' });
        expect(c).toMatchObject({ slug: 'northwind-labs', agencySlug: 'adpost', industry: 'Retail' });
        expect(db.all('agentInstances').filter((a) => a.brandId === c.id)).toHaveLength(6);
        await expect(admin.agencies.createClient('agy_adpost', { name: 'POD' })).rejects.toMatchObject({ fields: { slug: expect.stringContaining('already exists') } });
        expect((await api(db, 'usr_vca_admin').agencies.createClient('agy_vca', { name: 'POD' })).slug).toBe('pod');
        await expect(admin.agencies.createClient('agy_vca', { name: 'Smuggled' })).rejects.toBeInstanceOf(AccessDeniedError);
        for (const u of ['usr_adpost_manager', 'usr_pod_seo', 'usr_platform']) {
            await expect(api(db, u).agencies.createClient('agy_adpost', { name: `By ${u}` }), u).rejects.toBeInstanceOf(AccessDeniedError);
        }
        await expect(admin.agencies.createClient('agy_adpost', { name: 'Bad email', primaryContactEmail: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('archive and restore; filters by status and search', async () => {
        const db = sampleDb();
        const admin = api(db, 'usr_adpost_admin');
        expect((await admin.agencies.updateClient(DSP, { status: 'archived' })).archivedAt).not.toBeNull();
        expect((await admin.agencies.clients('agy_adpost', { status: 'archived' })).map((c) => c.client.name)).toEqual(['DSP']);
        expect((await admin.agencies.list())[0]!.counts).toMatchObject({ clients: 4, archivedClients: 1 });
        expect((await admin.agencies.clients('agy_adpost', { query: 'pila' })).map((c) => c.client.name)).toEqual(['STUDIO PILATES']);
        expect((await admin.agencies.updateClient(DSP, { status: 'active' })).archivedAt).toBeNull();
        await expect(api(db, 'usr_adpost_manager').agencies.updateClient(DSP, { name: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api(db, 'usr_vca_admin').agencies.updateClient(DSP, { name: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('agency managers read and write every agency client but cannot administer or manage AI credentials', async () => {
        const db = sampleDb();
        const m = api(db, 'usr_adpost_manager');
        expect((await m.agencies.clients('agy_adpost')).map((c) => c.roleLabel)).toEqual(Array(5).fill('Agency manager'));
        expect((await m.websites.create(POD, { name: 'POD draft' })).websiteUrl).toBeNull();
        expect(await m.ai.access(POD)).toMatchObject({ canManageConnections: false, canAssign: false });
        await expect(m.members.list(POD)).resolves.toBeDefined();
        await expect(m.invitations.send(POD, { email: 'x@example.test', role: 'member' })).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('websites', () => {
    it('drafts need no URL; URLs are validated and normalized; the platform is never assumed', async () => {
        const db = sampleDb();
        const a = api(db, 'usr_adpost_admin');
        const draft = await a.websites.create(POD, { name: 'Campaign site' });
        expect(draft).toMatchObject({ websiteUrl: null, domain: null, platform: 'unknown', environment: 'production', isPrimary: false });
        const prod = await a.websites.create(POD, { name: 'Production', websiteUrl: ' HTTPS://Shop.Example.COM/Home ', isPrimary: true });
        expect(prod).toMatchObject({ websiteUrl: 'https://shop.example.com/Home', domain: 'shop.example.com', isPrimary: true });
        for (const bad of ['shop.example.com', 'ftp://shop.example.com', 'https://localhost', 'https://10.0.0.1', 'https://user:pw@shop.example.com']) {
            await expect(a.websites.create(POD, { name: 'Bad', websiteUrl: bad }), bad).rejects.toBeInstanceOf(ValidationError);
        }
        await expect(a.websites.create(POD, { name: 'Dup', websiteUrl: 'https://shop.example.com/other' })).rejects.toBeInstanceOf(ValidationError);
        // The same domain is fine for a different client.
        expect((await a.websites.create(DSP, { name: 'Same host', websiteUrl: 'https://shop.example.com' })).domain).toBe('shop.example.com');
    });

    it('one primary per client; archive clears primary and hides by default; restore brings it back', async () => {
        const db = sampleDb();
        const a = api(db, 'usr_adpost_admin');
        const one = await a.websites.create(POD, { name: 'One', websiteUrl: 'https://one.example.com', isPrimary: true });
        const two = await a.websites.create(POD, { name: 'Two', websiteUrl: 'https://staging.one.example.com', environment: 'staging' });
        await a.websites.update(POD, two.id, { isPrimary: true });
        expect((await a.websites.get(POD, one.id)).isPrimary).toBe(false);
        const archived = await a.websites.update(POD, two.id, { status: 'archived' });
        expect(archived).toMatchObject({ isPrimary: false, status: 'archived' });
        expect(archived.archivedAt).not.toBeNull();
        expect((await a.websites.list(POD)).map((w) => w.name)).toEqual(['One']);
        expect((await a.websites.list(POD, { includeArchived: true })).map((w) => w.name).sort()).toEqual(['One', 'Two']);
        expect((await a.websites.update(POD, two.id, { status: 'active' })).archivedAt).toBeNull();
    });

    it('cross-client and cross-agency website access is refused', async () => {
        const db = sampleDb();
        const site = await api(db, 'usr_adpost_admin').websites.create(DSP, { name: 'DSP site' });
        await expect(api(db, 'usr_pod_seo').websites.get(DSP, site.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api(db, 'usr_pod_seo').websites.update(POD, site.id, { name: 'hijack' })).rejects.toThrow();
        await expect(api(db, 'usr_vca_admin').websites.create(POD, { name: 'cross-agency' })).rejects.toBeInstanceOf(AccessDeniedError);
    });
});
