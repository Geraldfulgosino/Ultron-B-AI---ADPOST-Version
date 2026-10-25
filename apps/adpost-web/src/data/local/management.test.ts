import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { normalizeDomain } from './management';

const { pod, dmd } = IDS.brands;

describe('workspace', () => {
    it('lists only brands the user belongs to', async () => {
        const { api } = as('priya');
        expect((await api.workspace.listBrands()).map((b) => b.brand.slug)).toEqual(['pod']);
    });

    it('agency owner sees every brand in the agency', async () => {
        const { api } = as('alex');
        expect((await api.workspace.listBrands()).map((b) => b.brand.slug)).toEqual(['adpost', 'dmd', 'fmf', 'pod', 'urban-rest']);
    });

    it('a user with two memberships sees both brands with the right roles', async () => {
        const { api } = as('morgan');
        const brands = await api.workspace.listBrands();
        expect(brands.map((b) => [b.brand.slug, b.role])).toEqual([['adpost', 'admin'], ['pod', 'manager']]);
    });

    it('denies an inaccessible slug', async () => {
        const { api } = as('priya');
        await expect(api.workspace.brandBySlug('dmd')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.workspace.brandBySlug('does-not-exist')).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('only agency staff can create brands', async () => {
        await expect(as('priya').api.workspace.createBrand({ name: 'New' })).rejects.toBeInstanceOf(AccessDeniedError);
        const brand = await as('alex').api.workspace.createBrand({ name: 'Northwind' });
        expect(brand.slug).toBe('northwind');
    });
});

describe('clients — tenant isolation', () => {
    it('brand A user cannot list, read, update or delete brand B clients', async () => {
        const db = testDb();
        const priya = as('priya', db).api; // POD owner
        await expect(priya.clients.list(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.clients.get(dmd, 'cli_dmd_1')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.clients.update(dmd, 'cli_dmd_1', { name: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.clients.remove(dmd, 'cli_dmd_1')).rejects.toBeInstanceOf(AccessDeniedError);
        expect(db.find('clients', 'cli_dmd_1')?.name).toBe('DMD Services');
    });

    it('cannot reach a brand B record through a brand A route (id smuggling)', async () => {
        const priya = as('priya').api;
        await expect(priya.clients.get(pod, 'cli_dmd_1')).rejects.toBeInstanceOf(NotFoundError);
        await expect(priya.clients.update(pod, 'cli_dmd_1', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('viewer can read but not write', async () => {
        const vic = as('vic').api;
        expect(await vic.clients.list(pod)).toHaveLength(2);
        await expect(vic.clients.create(pod, { name: 'Nope' })).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('client user sees only their own client', async () => {
        const casey = as('casey').api;
        expect((await casey.clients.list(pod)).map((c) => c.id)).toEqual(['cli_pod_1']);
        await expect(casey.clients.get(pod, 'cli_pod_2')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('validates name and uniqueness, and only admins delete', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        await expect(priya.clients.create(pod, { name: '  ' })).rejects.toBeInstanceOf(ValidationError);
        await expect(priya.clients.create(pod, { name: 'POD Store' })).rejects.toBeInstanceOf(ValidationError);
        const created = await priya.clients.create(pod, { name: 'POD Wholesale' });
        await expect(as('morgan', db).api.clients.remove(pod, created.id)).rejects.toBeInstanceOf(AccessDeniedError); // manager in POD
        await priya.clients.remove(pod, created.id);
        expect(db.find('clients', created.id)).toBeUndefined();
        expect(db.all('auditLogs').map((a) => a.action)).toEqual(['client.created', 'client.deleted']);
    });
});

describe('websites', () => {
    it('normalizes domains like legacy', () => {
        expect(normalizeDomain(' HTTPS://www.Example.com/path ')).toBe('www.example.com');
    });

    it('rejects a client from another brand', async () => {
        const priya = as('priya').api;
        await expect(priya.websites.create(pod, { clientId: 'cli_dmd_1', name: 'X', domain: 'x.example.test' })).rejects.toMatchObject({
            fields: { clientId: 'Choose a client from this brand.' },
        });
    });

    it('rejects duplicate domains within a brand', async () => {
        const priya = as('priya').api;
        await expect(priya.websites.create(pod, { clientId: 'cli_pod_1', name: 'Dup', domain: 'https://shop.pod.example.test' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('client user only sees websites of their client; other brands are denied', async () => {
        const casey = as('casey').api;
        expect((await casey.websites.list(pod)).map((w) => w.id)).toEqual(['web_pod_1']);
        await expect(casey.websites.list(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('removing a website removes its integrations', async () => {
        const db = testDb();
        await as('priya', db).api.websites.remove(pod, 'web_pod_1');
        expect(db.all('integrations').filter((i) => i.websiteId === 'web_pod_1')).toHaveLength(0);
    });
});

describe('fixtures', () => {
    it('are deterministic', () => {
        expect(testDb().snapshot()).toEqual(testDb().snapshot());
    });
});
