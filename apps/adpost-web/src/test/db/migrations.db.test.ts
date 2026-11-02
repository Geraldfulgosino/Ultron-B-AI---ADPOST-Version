// @vitest-environment node
import { createDb, migrationFiles } from './pg';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('supabase migrations on real Postgres (PGlite, non-superuser migration role)', () => {
    it('apply cleanly in filename order, with RLS (not FORCE) on every public table', async () => {
        const db = await createDb();
        const tables = await db.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = 'public'`);
        expect(tables.rows[0]!.n).toBeGreaterThanOrEqual(30);
        const noRls = await db.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
        expect(noRls.rows).toEqual([]);
        const forced = await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relforcerowsecurity`);
        expect(forced.rows).toEqual([]);
        const templates = await db.query<{ n: number }>(`select count(*)::int as n from public.agent_templates`);
        expect(templates.rows[0]!.n).toBe(6);
        expect(migrationFiles().length).toBeGreaterThanOrEqual(5);
        await db.close();
    }, 60_000);

    it('R1/R2: sign-up creates a profile through the auth trigger (as supabase_auth_admin)', async () => {
        const db = await createDb();
        await db.exec(`set role supabase_auth_admin;
            insert into auth.users (id, email, raw_user_meta_data) values ('${uid(1)}', 'New.User@X.test', '{"name": "  New User  ", "role": "owner"}');
            reset role;`);
        const p = await db.query(`select name, email, deactivated_at from public.profiles where id = '${uid(1)}'`);
        // Only the trimmed display name is taken from user metadata; a "role" claim grants nothing.
        expect(p.rows).toEqual([{ name: 'New User', email: 'new.user@x.test', deactivated_at: null }]);
        const grants = await db.query(`select count(*)::int as n from public.brand_memberships union all select count(*)::int from public.agency_memberships`);
        expect(grants.rows).toEqual([{ n: 0 }, { n: 0 }]);
        await db.close();
    }, 60_000);

    it('R1 evidence: with FORCE RLS (the original 0002), the profile trigger cannot insert and sign-up fails', async () => {
        const db = await createDb();
        await db.exec('set role migrator; alter table public.profiles force row level security; reset role;');
        const err = await db
            .exec(`set role supabase_auth_admin; insert into auth.users (id, email) values ('${uid(2)}', 'b@x.test');`)
            .then(() => 'no error', (e: Error) => e.message);
        await db.exec('reset role;');
        expect(err).toMatch(/row-level security/i);
        await db.close();
    }, 60_000);
});
