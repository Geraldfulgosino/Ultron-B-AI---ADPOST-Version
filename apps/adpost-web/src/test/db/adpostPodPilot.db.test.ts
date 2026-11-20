// @vitest-environment node
/**
 * ADPOST/POD pilot seed on PGlite: guarded, owner-supplied URLs only, idempotent, two separate
 * clients. The domains below are synthetic test values, not the real websites.
 */
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, MIGRATIONS_DIR } from './pg';

const PILOT = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'pilot', 'adpost_pod_pilot.sql'), 'utf8');
const ADPOST_URL = 'https://adpost-synthetic-test.com/';
const POD_URL = 'https://pod-synthetic-test.com/';

async function run(db: PGlite, settings: Record<string, string>) {
    const sets = Object.entries(settings).map(([k, v]) => `set ${k} = '${v}';`).join('\n');
    const resets = Object.keys(settings).map((k) => `reset ${k};`).join('\n');
    try {
        await db.exec(`${sets}\n${PILOT}`);
    } finally {
        await db.exec(resets);
    }
}

const ok = { 'app.allow_pilot_seed': 'on', 'app.pilot_adpost_url': ADPOST_URL, 'app.pilot_pod_url': POD_URL };

describe('pilot seed: ADPOST and POD', () => {
    let db: PGlite;
    beforeEach(async () => {
        db = await createDb();
    }, 120_000);
    afterEach(async () => db.close());

    it.each([
        ['no opt-in', { 'app.pilot_adpost_url': ADPOST_URL, 'app.pilot_pod_url': POD_URL }, /set app.allow_pilot_seed/],
        ['no URLs', { 'app.allow_pilot_seed': 'on' }, /app.pilot_adpost_url to the real production URL/],
        ['a placeholder', { ...ok, 'app.pilot_pod_url': 'https://<Promo On Demand domain>/' }, /must be an https/],
        ['plain http', { ...ok, 'app.pilot_adpost_url': 'http://adpost-synthetic-test.com/' }, /must be an https/],
        ['a reserved test domain', { ...ok, 'app.pilot_pod_url': 'https://pod.example/' }, /public production domain/],
        ['an IP address', { ...ok, 'app.pilot_pod_url': 'https://203.0.113.10/' }, /public production domain/],
        ['the same domain twice', { ...ok, 'app.pilot_pod_url': 'https://ADPOST-synthetic-test.com/shop' }, /different domains/],
    ])('refuses %s and writes nothing', async (_label, settings, error) => {
        await expect(run(db, settings)).rejects.toThrow(error);
        expect((await db.query('select 1 from public.agencies')).rows).toHaveLength(0);
    });

    it('creates ADPOST → {ADPOST, POD} → one live production website each, once', async () => {
        for (let i = 0; i < 2; i++) await run(db, ok);
        const rows = (await db.query<Record<string, unknown>>(`
            select a.slug agency, b.slug client, b.display_name, w.website_url, w.domain, w.environment, w.is_primary, w.is_demo,
                   (select count(*)::int from public.agent_instances i where i.brand_id = b.id) agents
            from public.agencies a join public.brands b on b.agency_id = a.id join public.websites w on w.brand_id = b.id order by b.slug`)).rows;
        expect(rows).toEqual([
            { agency: 'adpost', client: 'adpost', display_name: null, website_url: ADPOST_URL, domain: 'adpost-synthetic-test.com', environment: 'production', is_primary: true, is_demo: false, agents: 6 },
            { agency: 'adpost', client: 'pod', display_name: 'Promo On Demand', website_url: POD_URL, domain: 'pod-synthetic-test.com', environment: 'production', is_primary: true, is_demo: false, agents: 6 },
        ]);
        expect((await db.query('select 1 from public.integrations')).rows).toHaveLength(0);
        expect((await db.query('select 1 from public.brand_memberships')).rows).toHaveLength(0);
    });

    it('refuses a domain that already belongs to another client', async () => {
        await run(db, ok);
        await db.exec(`insert into public.brands (agency_id, name, slug) select id, 'Other', 'other' from public.agencies where slug = 'adpost'`);
        await db.exec(`delete from public.websites where domain = 'pod-synthetic-test.com'`);
        await db.exec(`insert into public.websites (brand_id, name, website_url) select id, 'Taken', '${POD_URL}' from public.brands where slug = 'other'`);
        await expect(run(db, ok)).rejects.toThrow(/already a website of another client/);
    });
});
