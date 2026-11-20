// @vitest-environment node
/** Migration 0012: a Google property can be assigned to one website only (PGlite, synthetic fixture). */
import type { PGlite } from '@electric-sql/pglite';
import { createDb } from './pg';
import { SEED, W } from './seed';

let db: PGlite;
const assign = (websiteId: string, property: string | null, provider = 'google_analytics') =>
    db.query(`update public.integrations set external_property_id = $1 where website_id = $2 and provider = $3`, [property, websiteId, provider]);
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');

beforeAll(async () => {
    db = await createDb();
    await db.exec(SEED);
}, 120_000);
afterAll(async () => db?.close());

describe('integrations_google_property_unique (0012)', () => {
    it('refuses the same GA4 property on a second website, even of another client', async () => {
        expect(await code(assign(W.pod1, 'properties/500'))).toBe('ok');
        expect(await code(assign(W.dmd1, 'properties/500'))).toBe('23505');
        expect(await code(assign(W.pod2, 'properties/500'))).toBe('23505');
    });

    it('a disconnect (property cleared) frees the property for another website', async () => {
        await assign(W.pod1, null);
        expect(await code(assign(W.dmd1, 'properties/500'))).toBe('ok');
    });

    it('applies per provider and only to Google providers', async () => {
        await db.query(`insert into public.integrations (brand_id, website_id, provider) select brand_id, id, 'google_search_console' from public.websites where id in ($1, $2)`, [W.pod1, W.zed1]);
        expect(await code(assign(W.pod1, 'properties/500', 'google_search_console'))).toBe('ok');
        expect(await code(assign(W.zed1, 'properties/500', 'google_search_console'))).toBe('23505');
    });
});
