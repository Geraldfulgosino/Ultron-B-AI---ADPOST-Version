// @vitest-environment node
/** Pilot seed (Lugenix Digital Services) on PGlite: guarded, idempotent, non-destructive, live (not demo). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, MIGRATIONS_DIR } from './pg';

const PILOT = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'pilot', 'lugenix_pilot.sql'), 'utf8');
const DEV = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'dev', 'sample_hierarchy.sql'), 'utf8');

describe('pilot seed: Lugenix Digital Services', () => {
    it('refuses without the opt-in, then creates agency → client → live production WordPress website once', async () => {
        const db = await createDb();
        await expect(db.exec(PILOT)).rejects.toThrow(/pilot seed refused/);
        // alongside the development seed: nothing of GoldStarATM changes
        await db.exec(`set app.allow_dev_seed = 'on';\n${DEV}\nreset app.allow_dev_seed;`);
        const before = (await db.query<{ n: number }>(`select count(*)::int n from public.brands b join public.agencies a on a.id = b.agency_id where a.slug = 'lugenix-digital-services'`)).rows[0]!.n;
        for (let i = 0; i < 2; i++) await db.exec(`set app.allow_pilot_seed = 'on';\n${PILOT}\nreset app.allow_pilot_seed;`);
        const r = (await db.query<Record<string, unknown>>(`
            select a.name agency, b.name client, w.website_url, w.domain, w.environment, w.platform, w.is_primary, w.is_demo,
                   (select count(*)::int from public.websites x where x.brand_id = b.id) websites,
                   (select count(*)::int from public.agent_instances i where i.brand_id = b.id) agents
            from public.agencies a join public.brands b on b.agency_id = a.id join public.websites w on w.brand_id = b.id where a.slug = 'lugenix'`)).rows;
        expect(r).toEqual([{ agency: 'Lugenix Digital Services', client: 'Lugenix Digital Services', website_url: 'https://lugenixdigitalservices.com', domain: 'lugenixdigitalservices.com', environment: 'production', platform: 'wordpress', is_primary: true, is_demo: false, websites: 1, agents: 6 }]);
        const after = (await db.query<{ n: number; name: string }>(`select count(*)::int n, min(a.name) name from public.brands b join public.agencies a on a.id = b.agency_id where a.slug = 'lugenix-digital-services'`)).rows[0]!;
        expect(after).toEqual({ n: before, name: 'GoldStarATM' });
        expect((await db.query(`select 1 from public.integrations`)).rows).toHaveLength(0);
        await db.close();
    }, 120_000);
});
