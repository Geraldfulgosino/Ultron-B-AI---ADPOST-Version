// @vitest-environment node
/**
 * Migration 0008 (agency → client → website) and the dev sample seed on real Postgres (PGlite).
 * Synthetic users only; the sample seed creates no users, websites or credentials.
 */
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { as, attempt, createDb, MIGRATIONS_DIR, type TestUser } from './pg';
import { id } from './seed';

const DENIED = '42501';
const CHECK = '23514';
const UNIQUE = '23505';
const SEED_SQL = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'dev', 'sample_hierarchy.sql'), 'utf8');
const runSeed = (db: PGlite) => db.exec(`set app.allow_dev_seed = 'on';\n${SEED_SQL}\nreset app.allow_dev_seed;`);

const user = (n: number, email: string): TestUser => ({ id: id(n), email });
const U = {
    platform: user(2001, 'platform.admin@example.test'),
    adpostOwner: user(2002, 'owner@adpost.example.test'),
    adpostManager: user(2003, 'manager@adpost.example.test'),
    vcaAdmin: user(2004, 'admin@vca.example.test'),
    podAdmin: user(2005, 'admin@pod.example.test'),
    podMember: user(2006, 'seo@pod.example.test'),
    dspViewer: user(2007, 'viewer@dsp.example.test'),
    stranger: user(2008, 'stranger@example.test'),
};

let db: PGlite;
let A: Record<string, string>;
let C: Record<string, string>;
const count = async (who: TestUser, table: string, where = 'true') =>
    (await as<{ n: number }>(db, who, `select count(*)::int as n from public.${table} where ${where}`))[0]!.n;

beforeAll(async () => {
    db = await createDb();
    await runSeed(db);
    A = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.agencies')).rows.map((r) => [r.slug, r.id]));
    C = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.brands')).rows.map((r) => [r.slug, r.id]));
    await db.exec(`
        set role supabase_auth_admin;
        insert into auth.users (id, email, email_confirmed_at) values
        ${Object.values(U).map((u) => `('${u.id}', '${u.email}', now())`).join(',\n')};
        reset role;
        insert into public.platform_admins (user_id) values ('${U.platform.id}');
        insert into public.agency_memberships (agency_id, user_id, role, job_function) values
            ('${A.adpost}', '${U.adpostOwner.id}', 'agency_owner', null),
            ('${A.adpost}', '${U.adpostManager.id}', 'agency_manager', 'client_manager'),
            ('${A.vca}', '${U.vcaAdmin.id}', 'agency_admin', null);
        insert into public.brand_memberships (brand_id, user_id, role, job_function) values
            ('${C.pod}', '${U.podAdmin.id}', 'admin', null),
            ('${C.pod}', '${U.podMember.id}', 'member', 'seo_specialist'),
            ('${C.dsp}', '${U.dspViewer.id}', 'viewer', null);
    `);
}, 120_000);
afterAll(async () => db?.close());

describe('dev sample seed', () => {
    const counts = async () => (await db.query<{ slug: string; n: number }>(`select a.slug, count(b.id)::int as n from public.agencies a
        left join public.brands b on b.agency_id = a.id group by a.slug order by a.slug`)).rows;

    it('creates exactly 3 agencies and 10 clients (5 ADPOST, 4 VCA, 1 Lugenix), no websites, six agents each', async () => {
        expect(await counts()).toEqual([{ slug: 'adpost', n: 5 }, { slug: 'lugenix-digital-services', n: 1 }, { slug: 'vca', n: 4 }]);
        const names = (await db.query<{ name: string }>(`select b.name from public.brands b join public.agencies a on a.id = b.agency_id where a.slug = 'adpost' order by b.name`)).rows.map((r) => r.name);
        expect(names).toEqual(['DSP', 'FMF', 'POD', 'STUDIO PILATES', 'TRADE BAGS']);
        expect((await db.query<{ n: number }>('select count(*)::int as n from public.websites')).rows[0]!.n).toBe(0);
        expect((await db.query<{ n: number }>("select count(*)::int as n from public.brands where status = 'active'")).rows[0]!.n).toBe(10);
        expect((await db.query<{ n: number }>('select count(*)::int as n from public.agent_instances')).rows[0]!.n).toBe(60);
        const v = await db.query<{ instructions: string }>(`select v.instructions from public.agent_instances i join public.agent_instruction_versions v on v.id = i.active_instruction_version_id where i.brand_id = '${C['goldstar-atm']}' and i.template_key = 'seo_manager'`);
        expect(v.rows[0]!.instructions).toContain('GoldStar ATM');
    });

    it('is idempotent and never alters existing rows', async () => {
        await db.exec(`update public.brands set description = 'edited by a user' where id = '${C.pod}'`);
        await runSeed(db);
        await runSeed(db);
        expect(await counts()).toEqual([{ slug: 'adpost', n: 5 }, { slug: 'lugenix-digital-services', n: 1 }, { slug: 'vca', n: 4 }]);
        expect((await db.query<{ n: number }>('select count(*)::int as n from public.agent_instances')).rows[0]!.n).toBe(60);
        expect((await db.query<{ d: string }>(`select description as d from public.brands where id = '${C.pod}'`)).rows[0]!.d).toBe('edited by a user');
    });

    it('refuses to run without the explicit development opt-in', async () => {
        await expect(db.exec(SEED_SQL)).rejects.toThrow(/dev seed refused/);
    });
});

describe('agencies', () => {
    it('only platform admins create agencies (creator becomes owner); slugs are validated', async () => {
        for (const u of [U.adpostOwner, U.vcaAdmin, U.podAdmin, U.stranger]) {
            expect(await attempt(db, u, `select public.create_agency('Rogue', 'rogue')`), u.email).toBe(DENIED);
        }
        expect(await attempt(db, U.adpostOwner, `insert into public.agencies (name, slug) values ('Direct', 'direct')`)).toBe(DENIED);
        const newId = (await as<{ create_agency: string }>(db, U.platform, `select public.create_agency('North Agency', 'north-agency')`))[0]!.create_agency;
        expect(await count(U.platform, 'agency_memberships', `agency_id = '${newId}' and user_id = '${U.platform.id}' and role = 'agency_owner'`)).toBe(1);
        expect(await attempt(db, U.platform, `select public.create_agency('Bad', 'Bad Slug!')`)).toBe(CHECK);
        expect(await attempt(db, U.platform, `select public.create_agency('Dup', 'adpost')`)).toBe(UNIQUE);
    });

    it('platform admins see the directory and totals but no client data; others cannot read totals', async () => {
        expect(await count(U.platform, 'agencies', `slug in ('adpost', 'vca', 'lugenix-digital-services')`)).toBe(3);
        expect(await count(U.platform, 'brands', `agency_id = '${A.adpost}'`)).toBe(0);
        const o = (await as<{ platform_overview: Record<string, number> }>(db, U.platform, 'select public.platform_overview()'))[0]!.platform_overview;
        expect(o).toMatchObject({ agencies: 4, clients: 10, websites: 0 });
        for (const u of [U.adpostOwner, U.podAdmin, U.stranger]) expect(await attempt(db, u, 'select public.platform_overview()'), u.email).toBe(DENIED);
    });

    it('agency admins edit their own agency profile but not its status; platform admins archive and restore', async () => {
        expect(await attempt(db, U.adpostOwner, `update public.agencies set description = 'Our agency' where id = '${A.adpost}'`)).toBe('ok');
        expect(await attempt(db, U.adpostOwner, `update public.agencies set status = 'archived' where id = '${A.adpost}'`)).toBe(DENIED);
        expect((await as(db, U.vcaAdmin, `update public.agencies set description = 'x' where id = '${A.adpost}' returning 1`))).toHaveLength(0);
        expect(await attempt(db, U.adpostOwner, `update public.agencies set slug = 'renamed' where id = '${A.adpost}'`)).toBe(DENIED);
        await as(db, U.platform, `update public.agencies set status = 'archived' where id = '${A.vca}'`);
        expect((await db.query<{ archived_at: string | null }>(`select archived_at from public.agencies where id = '${A.vca}'`)).rows[0]!.archived_at).not.toBeNull();
        await as(db, U.platform, `update public.agencies set status = 'active' where id = '${A.vca}'`);
        expect((await db.query<{ archived_at: string | null }>(`select archived_at from public.agencies where id = '${A.vca}'`)).rows[0]!.archived_at).toBeNull();
    });
});

describe('clients', () => {
    it('agency owners add clients to their own agency only; slugs unique per agency, reusable across agencies', async () => {
        const nc = (await as<{ create_client: string }>(db, U.adpostOwner, `select public.create_client('${A.adpost}', 'Northwind', 'northwind')`))[0]!.create_client;
        expect(await count(U.adpostOwner, 'agent_instances', `brand_id = '${nc}'`)).toBe(6);
        expect(await attempt(db, U.adpostOwner, `select public.create_client('${A.adpost}', 'POD again', 'pod')`)).toBe(UNIQUE);
        expect(await attempt(db, U.vcaAdmin, `select public.create_client('${A.vca}', 'POD (VCA)', 'pod')`)).toBe('ok');
        for (const u of [U.adpostManager, U.podAdmin, U.vcaAdmin, U.platform, U.stranger]) {
            expect(await attempt(db, u, `select public.create_client('${A.adpost}', 'Rogue', 'rogue-${u.id.slice(-2)}')`), u.email).toBe(DENIED);
        }
        expect(await attempt(db, U.vcaAdmin, `insert into public.brands (agency_id, name, slug) values ('${A.adpost}', 'Smuggled', 'smuggled')`)).toBe(DENIED);
    });

    it('archive and restore stamp archived_at; a client cannot move to another agency', async () => {
        await as(db, U.podAdmin, `update public.brands set status = 'archived' where id = '${C.pod}'`);
        expect((await db.query<{ a: string | null }>(`select archived_at as a from public.brands where id = '${C.pod}'`)).rows[0]!.a).not.toBeNull();
        await as(db, U.podAdmin, `update public.brands set status = 'active' where id = '${C.pod}'`);
        expect((await db.query<{ a: string | null }>(`select archived_at as a from public.brands where id = '${C.pod}'`)).rows[0]!.a).toBeNull();
        expect(await attempt(db, U.adpostOwner, `update public.brands set agency_id = '${A.vca}' where id = '${C.pod}'`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `update public.brands set industry = 'Printing', display_name = 'POD Prints' where id = '${C.pod}'`)).toBe('ok');
    });
});

describe('isolation across agencies and clients', () => {
    it('agency staff see their agency only; client members see their client only', async () => {
        expect(await count(U.adpostOwner, 'brands', `agency_id = '${A.adpost}'`)).toBeGreaterThanOrEqual(5);
        expect(await count(U.adpostOwner, 'brands', `agency_id <> '${A.adpost}'`)).toBe(0);
        expect(await count(U.vcaAdmin, 'brands', `agency_id = '${A.adpost}'`)).toBe(0);
        expect(await count(U.podAdmin, 'brands')).toBe(1);
        expect(await count(U.podAdmin, 'agent_instances', `brand_id = '${C.dsp}'`)).toBe(0);
        expect(await count(U.dspViewer, 'agent_instances', `brand_id = '${C.pod}'`)).toBe(0);
        expect(await count(U.stranger, 'agencies')).toBe(0);
        expect(await count(U.podAdmin, 'agencies')).toBe(1); // their client's agency (name only)
    });

    it('agency managers read and write every agency client but cannot administer or touch AI credentials', async () => {
        expect(await count(U.adpostManager, 'brands', `agency_id = '${A.adpost}'`)).toBeGreaterThanOrEqual(5);
        expect(await attempt(db, U.adpostManager, `insert into public.websites (brand_id, name) values ('${C.fmf}', 'FMF draft')`)).toBe('ok');
        expect(await as(db, U.adpostManager, `update public.brands set name = 'x' where id = '${C.fmf}' returning 1`)).toHaveLength(0);
        expect(await attempt(db, U.adpostManager, `insert into public.ai_provider_connections (agency_id, provider_code, display_name, authentication_method, credential_reference)
            values ('${A.adpost}', 'anthropic', 'Manager key', 'platform_secret', 'ANTHROPIC_API_KEY')`)).toBe(DENIED);
        expect(await attempt(db, U.adpostManager, `select public.create_client('${A.adpost}', 'M', 'manager-client')`)).toBe(DENIED);
        expect(await count(U.adpostManager, 'brands', `agency_id = '${A.vca}'`)).toBe(0);
    });

    it('manipulated brand_id / client_id / website_id values are refused', async () => {
        expect(await attempt(db, U.podAdmin, `insert into public.websites (brand_id, name) values ('${C.dsp}', 'Smuggled site')`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `insert into public.websites (brand_id, name) values ('${C.pod}', 'Cross-agency site')`)).toBe(DENIED);
        await db.exec(`insert into public.clients (id, brand_id, name, slug) values ('${id(2100)}', '${C.dsp}', 'DSP legacy', 'dsp-legacy')`);
        expect(await attempt(db, U.podAdmin, `insert into public.websites (brand_id, client_id, name) values ('${C.pod}', '${id(2100)}', 'Foreign client')`)).toBe(DENIED);
        const dspSite = (await as<{ id: string }>(db, U.adpostOwner, `insert into public.websites (brand_id, name) values ('${C.dsp}', 'DSP site') returning id`))[0]!.id;
        expect(await attempt(db, U.podAdmin, `insert into public.conversations (brand_id, kind, title, created_by, website_id) values ('${C.pod}', 'direct', 't', '${U.podAdmin.id}', '${dspSite}')`)).toBe(DENIED);
        expect(await as(db, U.podAdmin, `update public.websites set name = 'hijack' where id = '${dspSite}' returning 1`)).toHaveLength(0);
        expect(await as(db, U.dspViewer, `update public.websites set name = 'viewer edit' where id = '${dspSite}' returning 1`)).toHaveLength(0);
    });

    it('job functions grant no permissions', async () => {
        expect(await as(db, U.podMember, `update public.brands set name = 'x' where id = '${C.pod}' returning 1`)).toHaveLength(0);
        expect(await attempt(db, U.podMember, `update public.brand_memberships set role = 'admin' where user_id = '${U.podMember.id}'`)).toBe('ok');
        expect((await db.query<{ role: string }>(`select role from public.brand_memberships where user_id = '${U.podMember.id}'`)).rows[0]!.role).toBe('member');
    });
});

describe('websites', () => {
    const add = (sql: string) => attempt(db, U.podAdmin, `insert into public.websites (brand_id, name, website_url, domain, environment) values ${sql}`);
    const row = async (name: string) => (await db.query<Record<string, unknown>>(`select website_url, domain, platform, is_primary, status, archived_at from public.websites where brand_id = '${C.pod}' and name = '${name}'`)).rows[0]!;

    it('validates and normalizes URLs; a draft may have no URL and an unknown platform', async () => {
        expect(await add(`('${C.pod}', 'Prod', 'HTTPS://Shop.Example.COM/Path', null, 'production')`)).toBe('ok');
        expect(await row('Prod')).toMatchObject({ website_url: 'https://shop.example.com/Path', domain: 'shop.example.com', platform: 'unknown' });
        for (const bad of ['ftp://shop.example.com', 'shop.example.com', 'https://localhost', 'https://exa mple.com', 'javascript:alert(1)']) {
            expect(await add(`('${C.pod}', 'Bad ${bad.length}', '${bad}', null, 'production')`), bad).toBe(CHECK);
        }
        expect(await add(`('${C.pod}', 'Creds', 'https://user:pw@shop.example.com/', null, 'production')`)).toBe(CHECK);
        expect(await add(`('${C.pod}', 'Mismatch', 'https://a.example.com/', 'b.example.com', 'staging')`)).toBe(CHECK);
        expect(await add(`('${C.pod}', 'Draft', null, null, 'development')`)).toBe('ok');
        expect(await row('Draft')).toMatchObject({ website_url: null, domain: null });
        expect(await add(`('${C.pod}', 'Env', 'https://env.example.com', null, 'qa')`)).toBe(CHECK);
    });

    it('only verified-format active URLs are auditable', async () => {
        const ids = Object.fromEntries((await db.query<{ name: string; id: string }>(`select name, id from public.websites where brand_id = '${C.pod}'`)).rows.map((r) => [r.name, r.id]));
        const auditable = async (wid: string, who: TestUser) => (await as<{ ok: boolean }>(db, who, `select app.website_is_auditable('${wid}') as ok`))[0]!.ok;
        expect(await auditable(ids.Prod!, U.podAdmin)).toBe(true);
        expect(await auditable(ids.Draft!, U.podAdmin)).toBe(false);
        expect(await auditable(ids.Prod!, U.dspViewer)).toBe(false);
    });

    it('one primary website per client; archiving clears primary and stamps archived_at; restore clears it', async () => {
        await add(`('${C.pod}', 'Stage', 'https://staging.example.com', null, 'staging')`);
        await as(db, U.podAdmin, `update public.websites set is_primary = true where brand_id = '${C.pod}' and name = 'Prod'`);
        await as(db, U.podAdmin, `update public.websites set is_primary = true where brand_id = '${C.pod}' and name = 'Stage'`);
        expect((await row('Prod')).is_primary).toBe(false);
        expect((await row('Stage')).is_primary).toBe(true);
        await as(db, U.podAdmin, `update public.websites set status = 'archived' where brand_id = '${C.pod}' and name = 'Stage'`);
        expect(await row('Stage')).toMatchObject({ is_primary: false, status: 'archived' });
        expect((await row('Stage')).archived_at).not.toBeNull();
        await as(db, U.podAdmin, `update public.websites set status = 'active' where brand_id = '${C.pod}' and name = 'Stage'`);
        expect((await row('Stage')).archived_at).toBeNull();
    });
});
