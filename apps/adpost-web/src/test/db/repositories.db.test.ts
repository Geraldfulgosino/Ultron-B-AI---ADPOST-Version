// @vitest-environment node
/**
 * Phase 17F repositories against the real migrations with RLS on (PGlite), on the dev sample
 * hierarchy. Each repository is exercised as Super Admin, Admin, Client User and a user with no
 * membership, through the same `DbPort` interface the browser uses (here `pgPort`).
 * Local emulation only: these are not staging results.
 */
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccessDeniedError, ServiceError, ValidationError } from '@/data/errors';
import { createRepositories, MAX_PAGE_SIZE, resolveHome, type Repositories } from '@/data/supabase/repositories';
import type { DbPort } from '@/data/supabase/dbPort';
import { as, createDb, MIGRATIONS_DIR, type TestUser } from './pg';
import { pgPort } from './pgPort';
import { id } from './seed';

const SEED_SQL = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'dev', 'sample_hierarchy.sql'), 'utf8');
const user = (n: number, email: string): TestUser => ({ id: id(n), email });
const U = {
    superAdmin: user(4001, 'super@platform.example.test'),
    vcaAdmin: user(4002, 'admin@vca.example.test'),
    adpostAdmin: user(4003, 'admin@adpost.example.test'),
    lipskyUser: user(4004, 'user@lipsky.example.test'),
    stranger: user(4005, 'stranger@example.test'),
    invitee: user(4006, 'invited@lipsky.example.test'),
    temp: user(4007, 'temp@lipsky.example.test'),
};
const X = { internal: id(4100), shared: id(4101), visibleProject: id(4110), internalProject: id(4111), visibleTask: id(4120), internalTask: id(4121), integration: id(4130), liveSite: id(4140) };

let db: PGlite;
let A: Record<string, string>;
let C: Record<string, string>;
let lipskySite: string;
const repos = (u: TestUser, calls?: string[]): Repositories => createRepositories(pgPort(db, u, calls), u.id);

beforeAll(async () => {
    db = await createDb();
    await db.exec(`set app.allow_dev_seed = 'on';\n${SEED_SQL}\nreset app.allow_dev_seed;`);
    A = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.agencies')).rows.map((r) => [r.slug, r.id]));
    C = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.brands')).rows.map((r) => [r.slug, r.id]));
    lipskySite = (await db.query<{ id: string }>(`select id from public.websites where brand_id = '${C.lipsky}' and is_primary`)).rows[0]!.id;
    await db.exec(`
        set role supabase_auth_admin;
        insert into auth.users (id, email, email_confirmed_at) values
        ${Object.values(U).map((u) => `('${u.id}', '${u.email}', now())`).join(',\n')};
        reset role;
        insert into public.platform_admins (user_id) values ('${U.superAdmin.id}');
        insert into public.agency_memberships (agency_id, user_id, role) values
            ('${A.vca}', '${U.vcaAdmin.id}', 'agency_admin'), ('${A.adpost}', '${U.adpostAdmin.id}', 'agency_admin');
        insert into public.brand_memberships (brand_id, user_id, role, permissions) values
            ('${C.lipsky}', '${U.lipskyUser.id}', 'client', '{ai_chat,comment_tasks}');
        insert into public.conversations (id, brand_id, kind, title, created_by, visibility) values
            ('${X.internal}', '${C.lipsky}', 'direct', 'Internal strategy', '${U.vcaAdmin.id}', 'agency_internal'),
            ('${X.shared}', '${C.lipsky}', 'direct', 'Shared with client', '${U.vcaAdmin.id}', 'client_shared');
        insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body, created_at) values
            ('${C.lipsky}', '${X.internal}', 'user', '${U.vcaAdmin.id}', 'internal note', now() - interval '1 day'),
            ('${C.lipsky}', '${X.shared}', 'user', '${U.vcaAdmin.id}', 'hello LIPSKY', now() - interval '1 day');
        insert into public.projects (id, brand_id, name, client_visible) values
            ('${X.visibleProject}', '${C.lipsky}', 'Shared roadmap', true), ('${X.internalProject}', '${C.lipsky}', 'Internal pricing', false);
        insert into public.tasks (id, brand_id, project_id, title, created_by_type, created_by_id, due_date) values
            ('${X.visibleTask}', '${C.lipsky}', '${X.visibleProject}', 'Publish blog', 'user', '${U.vcaAdmin.id}', '2026-12-01'),
            ('${X.internalTask}', '${C.lipsky}', '${X.internalProject}', 'Margin review', 'user', '${U.vcaAdmin.id}', null);
        insert into public.websites (id, brand_id, name, website_url, platform) values
            ('${X.liveSite}', '${C.lipsky}', 'LIPSKY live', 'https://www.lipsky-pilot.com', 'wordpress');
        insert into public.integrations (id, brand_id, website_id, provider, status, label, auth_method, credential_configured, verified_at) values
            ('${X.integration}', '${C.lipsky}', '${X.liveSite}', 'google_analytics', 'connected', 'GA4', 'oauth2', true, now());
    `);
}, 120_000);
afterAll(async () => db?.close());

const names = <T extends { name: string }>(items: T[]) => items.map((i) => i.name);

describe('Super Admin', () => {
    it('reads every agency and client; lands on /platform', async () => {
        const r = repos(U.superAdmin);
        expect(names((await r.agencies.list()).items)).toEqual(['ADPOST', 'GoldStarATM', 'VCA']);
        const clients = await r.clients.list({ status: 'active' });
        expect(clients.total).toBe(12);
        expect(new Set(clients.items.map((c) => c.agencySlug))).toEqual(new Set(['adpost', 'vca', 'lugenix-digital-services']));
        expect(await resolveHome(r)).toEqual({ path: '/platform', reason: 'super_admin' });
    });
});

describe('Admin (VCA)', () => {
    it('sees only VCA; another agency is denied, not empty', async () => {
        const r = repos(U.vcaAdmin);
        expect(names((await r.agencies.list()).items)).toEqual(['VCA']);
        expect(names((await r.clients.list({ agencyId: A.vca, status: 'active' })).items)).toEqual(['CMS', 'HLDC', 'LIPSKY', 'LOOP19']);
        await expect(r.clients.list({ agencyId: A.adpost })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r.agencies.bySlug('adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r.websites.listByClient(C.pod!)).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await resolveHome(r)).toEqual({ path: '/a/vca', reason: 'admin' });
    });

    it('creates and edits websites in its clients only; the database derives the domain', async () => {
        const r = repos(U.vcaAdmin);
        const site = await r.websites.create(C.lipsky!, { name: 'LIPSKY blog', websiteUrl: 'https://Blog.Lipsky.example/' });
        expect(site).toMatchObject({ brandId: C.lipsky, domain: 'blog.lipsky.example', websiteUrl: 'https://blog.lipsky.example/', isDemo: false, isPrimary: false });
        expect((await r.websites.update(site.id, { description: 'Company blog' })).description).toBe('Company blog');
        await expect(r.websites.create(C.lipsky!, { name: 'Bad', websiteUrl: 'ftp://x.example' })).rejects.toBeInstanceOf(ValidationError);
        await expect(r.websites.create(C.pod!, { name: 'Smuggled', websiteUrl: 'https://pod.example' })).rejects.toBeInstanceOf(AccessDeniedError);
        const podSite = (await repos(U.adpostAdmin).websites.listByClient(C.pod!))[0]!;
        await expect(r.websites.update(podSite.id, { name: 'Renamed' })).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await repos(U.adpostAdmin).websites.byId(podSite.id)).name).toBe(podSite.name);
    });

    it('creates clients in its own agency; a duplicate slug is a field error', async () => {
        const r = repos(U.vcaAdmin);
        const created = await r.clients.create(A.vca!, { name: 'Repo Test Client' });
        expect(created).toMatchObject({ slug: 'repo-test-client', agencySlug: 'vca', status: 'active' });
        await expect(r.clients.create(A.vca!, { name: 'Again', slug: 'repo-test-client' })).rejects.toMatchObject({ fields: { slug: 'This value is already in use.' } });
        await expect(r.clients.create(A.adpost!, { name: 'Elsewhere' })).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await r.clients.update(created.id, { status: 'archived' })).archivedAt).not.toBeNull();
    });

    it('cannot edit another agency or change its own agency status', async () => {
        const r = repos(U.vcaAdmin);
        expect((await r.agencies.update(A.vca!, { description: 'VCA profile' })).description).toBe('VCA profile');
        await expect(r.agencies.update(A.adpost!, { name: 'Taken' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r.agencies.update(A.vca!, { status: 'suspended' })).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('Client User (LIPSKY)', () => {
    const r = () => repos(U.lipskyUser);

    it('reads its agency and client only; other clients are denied', async () => {
        expect(names((await r().agencies.list()).items)).toEqual(['VCA']);
        expect(names((await r().clients.list()).items)).toEqual(['LIPSKY']);
        expect((await r().clients.bySlug('vca', 'lipsky')).agencySlug).toBe('vca');
        await expect(r().clients.bySlug('vca', 'cms')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().clients.byId(C.pod!)).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await resolveHome(r())).toEqual({ path: '/a/vca/c/lipsky/dashboard', reason: 'client_user' });
    });

    it('websites: read-only, own client only', async () => {
        expect((await r().websites.listByClient(C.lipsky!)).map((w) => w.domain).sort()).toEqual(expect.arrayContaining(['lipsky.example']));
        await expect(r().websites.listByClient(C.cms!)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().websites.update(lipskySite, { name: 'Mine now' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().websites.create(C.lipsky!, { name: 'New', websiteUrl: 'https://new.lipsky.example' })).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('conversations and messages: client-shared only; cannot post into internal ones', async () => {
        const list = await r().conversations.listByClient(C.lipsky!);
        expect(list.items.map((c) => c.title)).toEqual(['Shared with client']);
        await expect(r().conversations.byId(X.internal)).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await r().messages.list(X.shared)).items.map((m) => m.body)).toEqual(['hello LIPSKY']);
        expect((await r().messages.list(X.internal)).items).toEqual([]);
        const sent = await r().messages.send({ brandId: C.lipsky!, conversationId: X.shared, body: 'question from client' });
        expect(sent.author).toEqual({ type: 'user', userId: U.lipskyUser.id });
        await expect(r().messages.send({ brandId: C.lipsky!, conversationId: X.internal, body: 'sneak' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().conversations.create({ brandId: C.lipsky!, title: 'Internal?', visibility: 'agency_internal' })).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await r().conversations.create({ brandId: C.lipsky!, title: 'Ask the team', visibility: 'client_shared' })).createdBy).toBe(U.lipskyUser.id);
    });

    it('projects and tasks: client-visible only, read-only', async () => {
        expect(names((await r().projects.listByClient(C.lipsky!)).items)).toEqual(['Shared roadmap']);
        const tasks = (await r().tasks.listByClient(C.lipsky!)).items;
        expect(tasks.map((t) => [t.title, t.dueDate])).toEqual([['Publish blog', '2026-12-01']]);
        await expect(r().tasks.byId(X.internalTask)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().tasks.update(X.visibleTask, { priority: 'urgent' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().projects.create(C.lipsky!, { name: 'Client project' })).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('memberships and profiles: only its own', async () => {
        const mine = await r().memberships.mine();
        expect(mine.platformAdmin).toBe(false);
        expect(mine.agency).toEqual([]);
        expect(mine.brand).toEqual([expect.objectContaining({ brandId: C.lipsky, role: 'client', permissions: ['ai_chat', 'comment_tasks'] })]);
        expect((await r().memberships.forClient(C.lipsky!)).map((m) => m.userId)).toEqual([U.lipskyUser.id]);
        expect(await r().memberships.forAgency(A.vca!)).toEqual([]);
        const profiles = await r().profiles.list();
        expect(profiles.items.map((p) => p.email)).toEqual([U.lipskyUser.email]);
        await expect(r().profiles.byId(U.vcaAdmin.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(r().memberships.setClientPermissions(mine.brand[0]!.id, ['ai_chat', 'comment_tasks', 'download_reports'])).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('integration connections never carry credentials', async () => {
        const staff = await repos(U.vcaAdmin).integrations.listByClient(C.lipsky!);
        expect(staff).toEqual([expect.objectContaining({ id: X.integration, provider: 'google_analytics', status: 'connected', credentialConfigured: true })]);
        const keys = Object.keys(staff[0]!).filter((k) => k !== 'credentialConfigured');
        expect(keys.filter((k) => /secret|token|password|config|credential|cipher/i.test(k))).toEqual([]);
        await expect(repos(U.adpostAdmin).integrations.listByClient(C.lipsky!)).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('no membership, revocation and suspension', () => {
    it('a user without membership sees nothing and lands on access pending', async () => {
        const r = repos(U.stranger);
        expect((await r.agencies.list()).items).toEqual([]);
        expect((await r.clients.list()).total).toBe(0);
        expect(await resolveHome(r)).toEqual({ path: '/access-pending', reason: 'none' });
        await expect(r.clients.byId(C.lipsky!)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('a revoked membership stops reads on the next query', async () => {
        await db.exec(`insert into public.brand_memberships (brand_id, user_id, role) values ('${C.lipsky}', '${U.temp.id}', 'client')`);
        const r = repos(U.temp);
        expect((await r.clients.byId(C.lipsky!)).slug).toBe('lipsky');
        await db.exec(`delete from public.brand_memberships where user_id = '${U.temp.id}'`);
        await expect(r.clients.byId(C.lipsky!)).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await resolveHome(r)).toEqual({ path: '/access-pending', reason: 'none' });
    });

    it('a suspended account loses every read with the same session', async () => {
        await db.exec(`insert into public.brand_memberships (brand_id, user_id, role) values ('${C.lipsky}', '${U.temp.id}', 'client')`);
        const r = repos(U.temp);
        expect((await r.websites.listByClient(C.lipsky!)).length).toBeGreaterThan(0);
        await db.exec(`update public.profiles set deactivated_at = now() where id = '${U.temp.id}'`);
        await expect(r.websites.listByClient(C.lipsky!)).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await r.memberships.mine()).brand).toEqual([]);
    });
});

describe('invitations through RPCs', () => {
    it('preview and accept run the server checks; the invitee becomes a Client User of that client', async () => {
        const token = (await as<{ token: string }>(db, U.vcaAdmin, `select token from public.create_invitation('${C.lipsky}', '${U.invitee.email}', 'client', null, '{ai_chat}')`))[0]!.token;
        const invitee = repos(U.invitee);
        expect(await invitee.memberships.previewInvitation(token)).toMatchObject({ brandSlug: 'lipsky', role: 'client', email: U.invitee.email, status: 'pending' });
        await expect(repos(U.stranger).memberships.acceptInvitation(token)).rejects.toBeInstanceOf(Error);
        expect(await invitee.memberships.acceptInvitation(token)).toEqual({ brandSlug: 'lipsky' });
        expect(await resolveHome(invitee)).toEqual({ path: '/a/vca/c/lipsky/dashboard', reason: 'client_user' });
        await expect(invitee.memberships.acceptInvitation(token)).rejects.toBeInstanceOf(Error);
    });
});

describe('pagination', () => {
    it('messages: keyset pages, oldest → newest inside a page, no gaps or repeats', async () => {
        const staff = repos(U.vcaAdmin);
        for (let i = 0; i < 23; i++) await staff.messages.send({ brandId: C.lipsky!, conversationId: X.internal, body: `note ${i}` });
        const seen: string[] = [];
        let before: string | undefined;
        let pages = 0;
        for (;;) {
            const page = await staff.messages.list(X.internal, { before, limit: 10 });
            seen.unshift(...page.items.map((m) => m.body));
            pages++;
            if (!page.hasMore) break;
            before = page.items[0]!.createdAt;
        }
        expect(pages).toBe(3);
        expect(seen).toHaveLength(24);
        expect(new Set(seen).size).toBe(24);
        expect(seen[0]).toBe('internal note');
    });

    it('tasks: page totals and bounds; page size is capped', async () => {
        await db.exec(`insert into public.tasks (brand_id, project_id, title, created_by_type) select '${C.lipsky}', '${X.internalProject}', 'bulk ' || g, 'system' from generate_series(1, 26) g`);
        const staff = repos(U.vcaAdmin);
        const p1 = await staff.tasks.listByClient(C.lipsky!, { page: 1, pageSize: 10 });
        const p3 = await staff.tasks.listByClient(C.lipsky!, { page: 3, pageSize: 10 });
        expect(p1.total).toBe(28);
        expect(p1.items).toHaveLength(10);
        expect(p3.items).toHaveLength(8);
        expect(new Set([...p1.items, ...p3.items].map((t) => t.id)).size).toBe(18);
        expect((await staff.tasks.listByClient(C.lipsky!, { pageSize: 10_000 })).pageSize).toBe(MAX_PAGE_SIZE);
        // The client still sees only the shared task, whatever the page.
        expect((await repos(U.lipskyUser).tasks.listByClient(C.lipsky!, { pageSize: 50 })).total).toBe(1);
    });

    it('search terms are literal: % and _ do not match everything', async () => {
        const r = repos(U.superAdmin);
        expect((await r.agencies.list({ query: '%' })).total).toBe(0);
        expect(names((await r.agencies.list({ query: 'vc' })).items)).toEqual(['VCA']);
    });
});

describe('failures are never silent', () => {
    const down: DbPort = {
        select: async () => ({ rows: [], count: null, error: { code: 'network', status: 0 } }),
        insert: async () => ({ row: null, error: { code: 'network', status: 0 } }),
        update: async () => ({ rows: [], error: { code: 'network', status: 0 } }),
        delete: async () => ({ count: 0, error: { code: 'network', status: 0 } }),
        rpc: async () => ({ data: null, error: { code: 'network', status: 0 } }),
    };

    it('a transport failure is a ServiceError, never an empty list or mock data', async () => {
        const r = createRepositories(down, U.vcaAdmin.id);
        await expect(r.agencies.list()).rejects.toBeInstanceOf(ServiceError);
        await expect(r.clients.list()).rejects.toBeInstanceOf(ServiceError);
        await expect(r.messages.list(X.shared)).rejects.toBeInstanceOf(ServiceError);
        await expect(resolveHome(r)).rejects.toBeInstanceOf(ServiceError);
        await expect(r.websites.create(C.lipsky!, { name: 'x' })).rejects.toBeInstanceOf(ServiceError);
        // Single-record reads must not turn an outage into "access denied" either.
        await expect(r.clients.byId(C.lipsky!)).rejects.toBeInstanceOf(ServiceError);
        await expect(r.memberships.mine()).rejects.toBeInstanceOf(ServiceError);
        await expect(r.websites.listByClient(C.lipsky!)).rejects.toBeInstanceOf(ServiceError);
    });

    it('every repository call reaches the database (no cached or local answers)', async () => {
        const calls: string[] = [];
        await repos(U.vcaAdmin, calls).clients.list({ agencyId: A.vca });
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });
});
