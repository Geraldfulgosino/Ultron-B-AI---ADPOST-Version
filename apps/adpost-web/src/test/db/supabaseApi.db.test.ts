// @vitest-environment node
/**
 * Multi-tenant isolation through the full Supabase `BrandApi` (Phase 17F) on PGlite: the dev
 * sample hierarchy (Super Admin → agencies → clients → websites), real migrations and RLS.
 * Local emulation; staging verification with real JWTs is still required.
 */
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccessDeniedError, NotAvailableError } from '@/data/errors';
import type { Backend } from '@/data/contracts';
import { createDb, MIGRATIONS_DIR, type TestUser } from './pg';
import { pgBackend, simulatedAgentRunner } from './pgBackend';
import { id } from './seed';

const SEED_SQL = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'dev', 'sample_hierarchy.sql'), 'utf8');
const PASSWORD = 'synthetic-password';
const user = (n: number, email: string): TestUser => ({ id: id(n), email });
const U = {
    superAdmin: user(5001, 'super@platform.example.test'),
    superAdmin2: user(5002, 'super2@platform.example.test'),
    vcaAdmin: user(5003, 'admin@vca.example.test'),
    lipskyUser: user(5004, 'user@lipsky.example.test'),
    stranger: user(5005, 'stranger@example.test'),
};
const X = { internal: id(5100), shared: id(5101), liveSite: id(5140) };

let db: PGlite;
let A: Record<string, string>;
let C: Record<string, string>;

async function signedIn(u: TestUser): Promise<Backend> {
    const backend = await pgBackend(db, PASSWORD, { runAgents: simulatedAgentRunner(db) });
    await backend.auth.signIn(u.email, PASSWORD);
    return backend;
}

beforeAll(async () => {
    db = await createDb();
    await db.exec(`set app.allow_dev_seed = 'on';\n${SEED_SQL}\nreset app.allow_dev_seed;`);
    A = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.agencies')).rows.map((r) => [r.slug, r.id]));
    C = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.brands')).rows.map((r) => [r.slug, r.id]));
    await db.exec(`
        set role supabase_auth_admin;
        insert into auth.users (id, email, email_confirmed_at) values
        ${Object.values(U).map((u) => `('${u.id}', '${u.email}', now())`).join(',\n')};
        reset role;
        insert into public.platform_admins (user_id) values ('${U.superAdmin.id}'), ('${U.superAdmin2.id}');
        insert into public.agency_memberships (agency_id, user_id, role) values ('${A.vca}', '${U.vcaAdmin.id}', 'agency_admin');
        insert into public.brand_memberships (brand_id, user_id, role, permissions) values ('${C.lipsky}', '${U.lipskyUser.id}', 'client', '{ai_chat}');
        update public.agent_instances set client_facing = true where brand_id = '${C.lipsky}' and template_key = 'seo_manager';
        insert into public.conversations (id, brand_id, kind, title, created_by, visibility) values
            ('${X.internal}', '${C.lipsky}', 'direct', 'Internal strategy', '${U.vcaAdmin.id}', 'agency_internal'),
            ('${X.shared}', '${C.lipsky}', 'direct', 'Shared with client', '${U.vcaAdmin.id}', 'client_shared');
        insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values
            ('${C.lipsky}', '${X.internal}', 'user', '${U.vcaAdmin.id}', 'internal margin note'),
            ('${C.lipsky}', '${X.shared}', 'user', '${U.vcaAdmin.id}', 'hello LIPSKY');
        insert into public.websites (id, brand_id, name, website_url, platform) values ('${X.liveSite}', '${C.lipsky}', 'LIPSKY live', 'https://www.lipsky-pilot.com', 'wordpress');
        insert into public.integrations (brand_id, website_id, provider, status, label, auth_method, credential_configured, verified_at, config)
            values ('${C.lipsky}', '${X.liveSite}', 'google_analytics', 'connected', 'GA4', 'oauth2', true, now(), '{"propertyId": "properties/123"}');
    `);
}, 120_000);
afterAll(async () => db?.close());

describe('Super Admin', () => {
    it('sees every agency with counts, the platform totals and the other Super Admins (0011)', async () => {
        const api = (await signedIn(U.superAdmin)).api();
        const agencies = await api.agencies.list();
        const truth = (await db.query<{ slug: string; n: number }>(`select a.slug, count(b.id)::int as n from public.agencies a join public.brands b on b.agency_id = a.id and b.status <> 'archived' group by a.slug order by a.slug`)).rows;
        expect(agencies.map((a) => [a.slug, a.access.workspace, a.counts?.clients])).toEqual(truth.map((r) => [r.slug, true, r.n]));
        expect(await api.users.home()).toEqual({ path: '/platform', reason: 'super_admin' });
        const overview = await api.agencies.platformOverview();
        expect(overview).toMatchObject({ agencies: 3, clients: 12, integrations: { connected: 1, error: 0 } });
        const { users } = await api.users.list({ role: 'super_admin' });
        expect(users.map((u) => u.email).sort()).toEqual([U.superAdmin.email, U.superAdmin2.email].sort());
    });
});

describe('Agency Admin (VCA)', () => {
    it('manages its own agency only; another agency is denied everywhere', async () => {
        const api = (await signedIn(U.vcaAdmin)).api();
        expect((await api.agencies.list()).map((a) => a.slug)).toEqual(['vca']);
        expect((await api.agencies.clients(A.vca!, { status: 'active' })).map((c) => c.client.name)).toEqual(['CMS', 'HLDC', 'LIPSKY', 'LOOP19']);
        await expect(api.agencies.bySlug('adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.agencies.clients(A.adpost!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.agencies.overview(A.adpost!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.users.list({ agencyId: A.adpost })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.workspace.brandBySlug('pod', 'adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.websites.list(C.pod!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.agencies.platformOverview()).rejects.toBeInstanceOf(AccessDeniedError);
        const vcaUsers = await api.users.list({ agencyId: A.vca });
        expect(vcaUsers.users.map((u) => u.email).sort()).toEqual([U.vcaAdmin.email, U.lipskyUser.email]);
        expect(vcaUsers.users.every((u) => !u.isSuperAdmin)).toBe(true);
        expect(await api.users.home()).toEqual({ path: '/a/vca', reason: 'admin' });
    });

    it('a website id from another client cannot be smuggled through an allowed client', async () => {
        const api = (await signedIn(U.vcaAdmin)).api();
        const cmsSite = (await api.websites.list(C.cms!))[0]!;
        await expect(api.websites.get(C.lipsky!, cmsSite.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.websites.update(C.lipsky!, cmsSite.id, { name: 'moved' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.chat.createDirect(C.lipsky!, (await api.agents.list(C.lipsky!))[0]!.id, 'x', { websiteId: cmsSite.id })).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('Client User (LIPSKY)', () => {
    it('no agency administration: name only, no workspace, overview or client list', async () => {
        const api = (await signedIn(U.lipskyUser)).api();
        const vca = await api.agencies.bySlug('vca');
        expect(vca.access.workspace).toBe(false);
        expect(vca.counts).toBeNull();
        await expect(api.agencies.clients(A.vca!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.agencies.overview(A.vca!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.users.list({ agencyId: A.vca })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.users.agencyInvitations(A.vca!)).resolves.toEqual([]);
        await expect(api.members.list(C.lipsky!)).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await api.users.home()).toEqual({ path: '/a/vca/c/lipsky/dashboard', reason: 'client_user' });
    });

    it('cannot reach another managed client by slug, id or website', async () => {
        const api = (await signedIn(U.lipskyUser)).api();
        expect((await api.workspace.listBrands()).map((b) => [b.brand.slug, b.role])).toEqual([['lipsky', 'client']]);
        await expect(api.workspace.brandBySlug('cms', 'vca')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.websites.list(C.cms!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.chat.list(C.cms!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.work.projects(C.cms!)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('conversations: only client-shared ones, with client-facing agents; agents of other clients are refused', async () => {
        const api = (await signedIn(U.lipskyUser)).api();
        expect((await api.chat.list(C.lipsky!)).map((c) => [c.title, c.lastMessage?.body])).toEqual([['Shared with client', 'hello LIPSKY']]);
        await expect(api.chat.get(C.lipsky!, X.internal)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.chat.messages(C.lipsky!, X.internal)).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await api.chat.search(C.lipsky!, 'margin')).length).toBe(0);
        const agents = await api.agents.list(C.lipsky!);
        expect(agents.map((a) => [a.templateKey, a.clientFacing])).toEqual([['seo_manager', true]]);
        const conv = await api.chat.createDirect(C.lipsky!, agents[0]!.id, undefined, { visibility: 'agency_internal' });
        expect(conv.visibility).toBe('client_shared');
        const { message, replies } = await api.chat.send(C.lipsky!, conv.id, { body: 'How is our SEO?' });
        expect(message.author).toEqual({ type: 'user', userId: U.lipskyUser.id });
        expect(replies.map((r) => [r.author.type, r.mode, r.replyToId])).toEqual([['agent', 'simulated', message.id]]);
        const cmsAgent = (await db.query<{ id: string }>(`select id from public.agent_instances where brand_id = '${C.cms}' limit 1`)).rows[0]!.id;
        await expect(api.chat.createDirect(C.lipsky!, cmsAgent)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('integration listings carry no credential, config or secret fields', async () => {
        const staff = (await signedIn(U.vcaAdmin)).api();
        const list = await staff.integrations.list(C.lipsky!);
        expect(list).toEqual([expect.objectContaining({ provider: 'google_analytics', status: 'connected', websiteName: 'LIPSKY live' })]);
        expect(list.flatMap((i) => Object.keys(i)).filter((k) => /token|secret|credential|password|config|cipher/i.test(k))).toEqual([]);
        expect(JSON.stringify(list)).not.toContain('properties/123');
    });

    it('server-side areas say "not available" after the access check, never with data', async () => {
        const api = (await signedIn(U.lipskyUser)).api();
        const dashboard = api.analytics.dashboard as (brandId: string) => Promise<unknown>;
        await expect(dashboard(C.lipsky!)).rejects.toBeInstanceOf(NotAvailableError);
        await expect(dashboard(C.cms!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api.knowledge.list(C.lipsky!)).rejects.toBeInstanceOf(AccessDeniedError); // staff area
    });
});

describe('Google OAuth callback in live mode', () => {
    it('continues at the website of the server-confirmed integration; another client’s website is refused', async () => {
        const lipskySite = X.liveSite;
        const cmsSite = (await db.query<{ id: string }>(`select id from public.websites where brand_id = '${C.cms}' limit 1`)).rows[0]!.id;
        const forSite = (websiteId: string) => async () => ({ websiteId, provider: 'google_analytics' as const });
        const own = await pgBackend(db, PASSWORD, { completeGoogle: forSite(lipskySite) });
        await own.auth.signIn(U.vcaAdmin.email, PASSWORD);
        expect(await own.api().integrations.completeGoogleAuthorization({ state: 's', code: 'c', error: null }))
            .toEqual({ websiteId: lipskySite, provider: 'google_analytics', returnPath: `/a/vca/c/lipsky/websites/${lipskySite}` });
        const other = await pgBackend(db, PASSWORD, { completeGoogle: forSite(cmsSite) });
        await other.auth.signIn(U.lipskyUser.email, PASSWORD);
        await expect(other.api().integrations.completeGoogleAuthorization({ state: 's', code: 'c', error: null })).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('sessions and change notifications', () => {
    it('a user without membership lands on access pending and sees no client', async () => {
        const api = (await signedIn(U.stranger)).api();
        expect(await api.workspace.listBrands()).toEqual([]);
        expect(await api.users.home()).toEqual({ path: '/access-pending', reason: 'none' });
    });

    it('writes notify subscribers; reads do not', async () => {
        const backend = await signedIn(U.vcaAdmin);
        const topics: string[] = [];
        backend.subscribe((t) => topics.push(t));
        const api = backend.api();
        await api.websites.list(C.lipsky!);
        expect(topics).toEqual([]);
        await api.websites.create(C.lipsky!, { name: 'Notified site', websiteUrl: 'https://notify.lipsky-pilot.com' });
        expect(topics).toEqual(['websites.create']);
    });

    it('signed out: the API is unavailable', async () => {
        const backend = await signedIn(U.vcaAdmin);
        await backend.auth.signOut();
        expect(() => backend.api()).toThrow('Not signed in.');
    });
});
