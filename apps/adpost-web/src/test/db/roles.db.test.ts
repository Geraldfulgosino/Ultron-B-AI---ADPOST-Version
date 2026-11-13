// @vitest-environment node
/**
 * Migration 0009: Super Admin / Admin / Client User on real Postgres (PGlite), using the dev seed.
 * Each case mirrors a prohibited scenario from the v6.0 master prompt. Synthetic users only.
 */
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { as, attempt, createDb, MIGRATIONS_DIR, type TestUser } from './pg';
import { id } from './seed';

const DENIED = '42501';
const SEED_SQL = readFileSync(join(MIGRATIONS_DIR, '..', 'seeds', 'dev', 'sample_hierarchy.sql'), 'utf8');
const user = (n: number, email: string): TestUser => ({ id: id(n), email });
const U = {
    superAdmin: user(3001, 'super@platform.example.test'),
    adpostAdmin: user(3002, 'admin@adpost.example.test'),
    vcaAdmin: user(3003, 'admin@vca.example.test'),
    lugenixAdmin: user(3004, 'admin@goldstaratm.example.test'),
    podStaff: user(3005, 'staff@pod.example.test'),
    podStaff2: user(3006, 'staff2@pod.example.test'),
    lipskyUser: user(3007, 'user@lipsky.example.test'),
    lipskyReader: user(3008, 'reader@lipsky.example.test'),
    cmsUser: user(3009, 'user@cms.example.test'),
    podClient: user(3010, 'client@pod.example.test'),
    invitee: user(3011, 'new.user@lipsky.example.test'),
    agencyInvitee: user(3012, 'new.admin@vca.example.test'),
    stranger: user(3013, 'stranger@example.test'),
};
let db: PGlite;
let A: Record<string, string>;
let C: Record<string, string>;
const count = async (who: TestUser, table: string, where = 'true') =>
    (await as<{ n: number }>(db, who, `select count(*)::int as n from ${table.includes('.') ? table : `public.${table}`} where ${where}`))[0]!.n;
const rows = (who: TestUser, sql: string) => as(db, who, `${sql} returning 1`).then((r) => r.length);
const X = { internal: id(3100), shared: id(3101), private: id(3102), cmsShared: id(3103), visibleProject: id(3110), internalProject: id(3111), visibleTask: id(3120), internalTask: id(3121) };

beforeAll(async () => {
    db = await createDb();
    await db.exec(`set app.allow_dev_seed = 'on';\n${SEED_SQL}\nreset app.allow_dev_seed;`);
    A = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.agencies')).rows.map((r) => [r.slug, r.id]));
    C = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.brands')).rows.map((r) => [r.slug, r.id]));
    await db.exec(`
        set role supabase_auth_admin;
        insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
        ${Object.values(U).map((u) => `('${u.id}', '${u.email}', now(), '{"role": "super_admin"}')`).join(',\n')};
        reset role;
        insert into public.platform_admins (user_id) values ('${U.superAdmin.id}');
        insert into public.agency_memberships (agency_id, user_id, role) values
            ('${A.adpost}', '${U.adpostAdmin.id}', 'agency_admin'), ('${A.vca}', '${U.vcaAdmin.id}', 'agency_admin'),
            ('${A['lugenix-digital-services']}', '${U.lugenixAdmin.id}', 'agency_owner');
        insert into public.brand_memberships (brand_id, user_id, role, permissions) values
            ('${C.pod}', '${U.podStaff.id}', 'member', '{}'), ('${C.pod}', '${U.podStaff2.id}', 'member', '{}'),
            ('${C.lipsky}', '${U.lipskyUser.id}', 'client', '{ai_chat,comment_tasks}'), ('${C.lipsky}', '${U.lipskyReader.id}', 'client', '{}'),
            ('${C.cms}', '${U.cmsUser.id}', 'client', '{ai_chat}'), ('${C.pod}', '${U.podClient.id}', 'client', '{}');
        insert into public.conversations (id, brand_id, kind, title, created_by, visibility) values
            ('${X.internal}', '${C.lipsky}', 'direct', 'Internal strategy', '${U.vcaAdmin.id}', 'agency_internal'),
            ('${X.shared}', '${C.lipsky}', 'direct', 'Shared with client', '${U.vcaAdmin.id}', 'client_shared'),
            ('${X.private}', '${C.pod}', 'direct', 'My notes', '${U.podStaff.id}', 'user_private'),
            ('${X.cmsShared}', '${C.cms}', 'direct', 'CMS shared', '${U.vcaAdmin.id}', 'client_shared');
        insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values
            ('${C.lipsky}', '${X.internal}', 'user', '${U.vcaAdmin.id}', 'internal note'),
            ('${C.lipsky}', '${X.shared}', 'user', '${U.vcaAdmin.id}', 'hello LIPSKY'),
            ('${C.pod}', '${X.private}', 'user', '${U.podStaff.id}', 'private thought');
        update public.agent_instances set client_facing = true where brand_id = '${C.lipsky}' and template_key = 'seo_manager';
        insert into public.projects (id, brand_id, name, client_visible) values
            ('${X.visibleProject}', '${C.lipsky}', 'Shared roadmap', true), ('${X.internalProject}', '${C.lipsky}', 'Internal pricing', false);
        insert into public.tasks (id, brand_id, project_id, title, created_by_type, created_by_id) values
            ('${X.visibleTask}', '${C.lipsky}', '${X.visibleProject}', 'Publish blog', 'user', '${U.vcaAdmin.id}'),
            ('${X.internalTask}', '${C.lipsky}', '${X.internalProject}', 'Margin review', 'user', '${U.vcaAdmin.id}');
        insert into public.knowledge_documents (brand_id, title, kind, content) values ('${C.cms}', 'CMS confidential', 'brand_guide', 'secret');
        insert into storage.objects (bucket_id, name) values ('brand-knowledge', '${C.cms}/doc/guide.txt');
    `);
}, 120_000);
afterAll(async () => db?.close());

describe('cross-agency and cross-client isolation', () => {
    it('VCA Admin cannot read ADPOST records', async () => {
        for (const t of ['brands', 'websites', 'agent_instances', 'conversations', 'projects']) {
            expect(await count(U.vcaAdmin, t, `${t === 'brands' ? 'agency_id' : 'brand_id'} ${t === 'brands' ? `= '${A.adpost}'` : `in (select id from public.brands where agency_id = '${A.adpost}')`}`), t).toBe(0);
        }
        expect(await count(U.vcaAdmin, 'brands', `agency_id = '${A.vca}'`)).toBe(4);
    });

    it('ADPOST Admin cannot manage another agency’s users', async () => {
        expect(await attempt(db, U.adpostAdmin, `select public.assign_agency_role('${A['lugenix-digital-services']}', '${U.adpostAdmin.id}', 'agency_admin')`)).toBe(DENIED);
        expect(await attempt(db, U.adpostAdmin, `select public.set_user_suspended('${U.lugenixAdmin.id}', true)`)).toBe(DENIED);
        expect(await rows(U.adpostAdmin, `delete from public.agency_memberships where user_id = '${U.lugenixAdmin.id}'`).catch(() => 0)).toBe(0);
        expect(await rows(U.adpostAdmin, `update public.brand_memberships set permissions = '{ai_chat}' where brand_id = '${C.lipsky}'`)).toBe(0);
    });

    it('a LIPSKY user cannot read CMS documents, files or conversations; sees LIPSKY websites', async () => {
        expect(await count(U.lipskyUser, 'knowledge_documents', `brand_id = '${C.cms}'`)).toBe(0);
        expect(await count(U.lipskyUser, 'storage.objects', `name like '${C.cms}/%'`)).toBe(0);
        expect(await count(U.lipskyUser, 'conversations', `brand_id = '${C.cms}'`)).toBe(0);
        expect(await count(U.lipskyUser, 'websites', `brand_id = '${C.cms}'`)).toBe(0);
        expect(await count(U.lipskyUser, 'websites', `brand_id = '${C.lipsky}'`)).toBe(2);
    });

    it('a POD client user who changes the URL to FMF gets nothing', async () => {
        for (const t of ['brands', 'websites', 'conversations', 'projects']) {
            expect(await count(U.podClient, t, `${t === 'brands' ? 'id' : 'brand_id'} = '${C.fmf}'`), t).toBe(0);
        }
        expect(await count(U.podClient, 'brands', `id = '${C.pod}'`)).toBe(1);
    });

    it('ids from another client cannot be smuggled into updates or inserts', async () => {
        expect(await attempt(db, U.vcaAdmin, `update public.conversations set brand_id = '${C.cms}' where id = '${X.shared}'`)).toBe(DENIED);
        expect(await attempt(db, U.cmsUser, `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${C.cms}', '${X.shared}', 'user', '${U.cmsUser.id}', 'x')`)).toBe(DENIED);
        expect(await attempt(db, U.podStaff, `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${C.pod}', '${X.shared}', 'user', '${U.podStaff.id}', 'x')`)).toBe(DENIED);
    });
});

describe('privilege escalation', () => {
    it('a Client User cannot create an Admin, invite users or grant roles', async () => {
        expect(await attempt(db, U.lipskyUser, `insert into public.brand_memberships (brand_id, user_id, role) values ('${C.lipsky}', '${U.stranger.id}', 'admin')`)).toBe(DENIED);
        expect(await attempt(db, U.lipskyUser, `select * from public.create_invitation('${C.lipsky}', 'x@example.test', 'client')`)).toBe(DENIED);
        expect(await rows(U.lipskyUser, `update public.brand_memberships set role = 'admin', permissions = '{}' where user_id = '${U.lipskyUser.id}'`)).toBe(0);
        expect(await attempt(db, U.lipskyUser, `select public.assign_agency_role('${A.vca}', '${U.lipskyUser.id}', 'agency_admin')`)).toBe(DENIED);
    });

    it('an Admin cannot create a Super Admin, invite agency admins, or grant themselves global privileges', async () => {
        expect(await attempt(db, U.vcaAdmin, `select public.grant_super_admin('${U.vcaAdmin.id}')`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `insert into public.platform_admins (user_id) values ('${U.vcaAdmin.id}')`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `select * from public.create_agency_invitation('${A.vca}', 'x@example.test', 'agency_admin')`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `select public.assign_agency_role('${A.adpost}', '${U.vcaAdmin.id}', 'agency_owner')`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `update public.agency_memberships set role = 'agency_owner' where user_id = '${U.vcaAdmin.id}'`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `select app.bootstrap_super_admin('${U.vcaAdmin.email}')`)).toBe(DENIED);
        expect(await count(U.vcaAdmin, 'agencies')).toBe(1);
    });

    it('sign-up metadata never grants roles (every test user signed up with role=super_admin metadata)', async () => {
        expect((await db.query<{ n: number }>('select count(*)::int as n from public.platform_admins')).rows[0]!.n).toBe(1);
        expect(await count(U.stranger, 'brands')).toBe(0);
    });

    it('Admins invite Client Users into their own clients only; client scope/permissions only for client users', async () => {
        expect(await attempt(db, U.vcaAdmin, `select * from public.create_invitation('${C.lipsky}', 'new.user@lipsky.example.test', 'client', null, '{ai_chat}')`)).toBe('ok');
        expect(await attempt(db, U.vcaAdmin, `select * from public.create_invitation('${C.pod}', 'x@example.test', 'client')`)).toBe(DENIED);
        expect(await attempt(db, U.vcaAdmin, `select * from public.create_invitation('${C.lipsky}', 'y@example.test', 'member', null, '{ai_chat}')`)).toBe('22023');
    });
});

describe('Super Admin', () => {
    it('reads every agency and client, and creates clients anywhere', async () => {
        expect(await count(U.superAdmin, 'agencies')).toBe(3);
        expect(await count(U.superAdmin, 'brands')).toBe(15);
        expect(await count(U.superAdmin, 'websites')).toBe(30);
    });

    it('does not see other users’ private conversations', async () => {
        expect(await count(U.superAdmin, 'conversations', `id = '${X.private}'`)).toBe(0);
        expect(await count(U.superAdmin, 'messages', `conversation_id = '${X.private}'`)).toBe(0);
        expect(await count(U.superAdmin, 'conversations', `id = '${X.internal}'`)).toBe(1);
    });

    it('grants and revokes super admin (never the last), invites agency admins, and every action is audited', async () => {
        await as(db, U.superAdmin, `select public.grant_super_admin('${U.lugenixAdmin.id}')`);
        await as(db, U.superAdmin, `select public.revoke_super_admin('${U.lugenixAdmin.id}')`);
        expect(await attempt(db, U.superAdmin, `select public.revoke_super_admin('${U.superAdmin.id}')`)).toBe(DENIED);
        const token = (await as<{ token: string }>(db, U.superAdmin, `select token from public.create_agency_invitation('${A.vca}', '${U.agencyInvitee.email}', 'agency_admin')`))[0]!.token;
        expect(await attempt(db, U.stranger, `select public.accept_agency_invitation('${token}')`)).toBe(DENIED);
        expect((await as<{ s: string }>(db, U.agencyInvitee, `select public.accept_agency_invitation('${token}') as s`))[0]!.s).toBe('vca');
        expect(await count(U.agencyInvitee, 'brands', `agency_id = '${A.vca}'`)).toBe(4);
        expect(await attempt(db, U.agencyInvitee, `select public.accept_agency_invitation('${token}')`)).toBe('22023');
        const actions = (await as<{ action: string }>(db, U.superAdmin, 'select action from public.platform_audit_events order by created_at')).map((r) => r.action);
        expect(actions).toEqual(expect.arrayContaining(['super_admin.granted', 'super_admin.revoked', 'agency_invitation.created', 'agency_invitation.accepted']));
        expect(await count(U.vcaAdmin, 'platform_audit_events', `agency_id is null`)).toBe(0);
    });

    it('agency suspension locks out its admins and client users immediately; super admins keep access to restore', async () => {
        await as(db, U.superAdmin, `update public.agencies set status = 'suspended' where id = '${A.adpost}'`);
        expect(await count(U.adpostAdmin, 'brands')).toBe(0);
        expect(await count(U.podClient, 'websites')).toBe(0);
        expect(await count(U.podStaff, 'conversations')).toBe(0);
        expect(await count(U.superAdmin, 'brands', `agency_id = '${A.adpost}'`)).toBe(6);
        await as(db, U.superAdmin, `update public.agencies set status = 'active' where id = '${A.adpost}'`);
        expect(await count(U.adpostAdmin, 'brands')).toBe(6);
    });
});

describe('suspension, revocation and stale tokens', () => {
    it('a suspended account loses access on the next query, with the same JWT', async () => {
        expect(await count(U.cmsUser, 'websites')).toBe(2);
        await as(db, U.superAdmin, `select public.set_user_suspended('${U.cmsUser.id}', true)`);
        expect(await count(U.cmsUser, 'websites')).toBe(0);
        expect(await count(U.cmsUser, 'conversations')).toBe(0);
        expect(await attempt(db, U.superAdmin, `select public.set_user_suspended('${U.superAdmin.id}', true)`)).toBe(DENIED);
        await as(db, U.superAdmin, `select public.set_user_suspended('${U.cmsUser.id}', false)`);
        expect(await count(U.cmsUser, 'websites')).toBe(2);
    });

    it('a revoked membership stops reads immediately', async () => {
        expect(await count(U.podStaff2, 'websites')).toBe(2);
        await as(db, U.adpostAdmin, `delete from public.brand_memberships where user_id = '${U.podStaff2.id}' returning 1`);
        expect(await count(U.podStaff2, 'websites')).toBe(0);
        expect(await count(U.podStaff2, 'brands')).toBe(0);
    });
});

describe('Client User portal scope', () => {
    it('is read-only by default', async () => {
        expect(await rows(U.lipskyReader, `update public.websites set name = 'x' where brand_id = '${C.lipsky}'`)).toBe(0);
        expect(await attempt(db, U.lipskyReader, `insert into public.websites (brand_id, name) values ('${C.lipsky}', 'x')`)).toBe(DENIED);
        expect(await attempt(db, U.lipskyReader, `insert into public.conversations (brand_id, kind, title, created_by, visibility) values ('${C.lipsky}', 'direct', 't', '${U.lipskyReader.id}', 'client_shared')`)).toBe(DENIED);
        expect(await attempt(db, U.lipskyReader, `insert into public.task_comments (brand_id, task_id, author_id, body) values ('${C.lipsky}', '${X.visibleTask}', '${U.lipskyReader.id}', 'hi')`)).toBe(DENIED);
    });

    it('sees only client-shared conversations, and only with the ai_chat permission; never internal or private ones', async () => {
        expect((await as<{ id: string }>(db, U.lipskyUser, 'select id from public.conversations')).map((r) => r.id)).toEqual([X.shared]);
        expect((await as<{ body: string }>(db, U.lipskyUser, 'select body from public.messages')).map((r) => r.body)).toEqual(['hello LIPSKY']);
        expect(await count(U.lipskyReader, 'conversations')).toBe(0);
        expect(await attempt(db, U.lipskyUser, `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${C.lipsky}', '${X.shared}', 'user', '${U.lipskyUser.id}', 'question')`)).toBe('ok');
        expect(await attempt(db, U.lipskyUser, `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${C.lipsky}', '${X.internal}', 'user', '${U.lipskyUser.id}', 'sneak')`)).toBe(DENIED);
        expect(await attempt(db, U.lipskyUser, `insert into public.conversations (brand_id, kind, title, created_by, visibility) values ('${C.lipsky}', 'direct', 'mine', '${U.lipskyUser.id}', 'agency_internal')`)).toBe(DENIED);
        expect(await attempt(db, U.lipskyUser, `insert into public.conversations (brand_id, kind, title, created_by, visibility) values ('${C.lipsky}', 'direct', 'mine', '${U.lipskyUser.id}', 'client_shared')`)).toBe('ok');
        expect(await count(U.lipskyUser, 'agent_executions')).toBe(0);
    });

    it('sees only client-facing agents and never their instructions', async () => {
        expect((await as<{ template_key: string }>(db, U.lipskyUser, 'select template_key from public.agent_instances')).map((r) => r.template_key)).toEqual(['seo_manager']);
        expect(await count(U.lipskyUser, 'agent_instruction_versions')).toBe(0);
        expect(await count(U.lipskyReader, 'agent_instances')).toBe(0);
    });

    it('private conversations: only the creator, not other staff or the agency admin', async () => {
        expect(await count(U.podStaff, 'conversations', `id = '${X.private}'`)).toBe(1);
        expect(await count(U.adpostAdmin, 'conversations', `id = '${X.private}'`)).toBe(0);
        expect(await count(U.adpostAdmin, 'messages', `conversation_id = '${X.private}'`)).toBe(0);
    });

    it('projects and tasks: only client-visible ones; comments need the comment_tasks permission', async () => {
        expect((await as<{ name: string }>(db, U.lipskyUser, 'select name from public.projects')).map((r) => r.name)).toEqual(['Shared roadmap']);
        expect((await as<{ title: string }>(db, U.lipskyUser, 'select title from public.tasks')).map((r) => r.title)).toEqual(['Publish blog']);
        expect(await attempt(db, U.lipskyUser, `insert into public.task_comments (brand_id, task_id, author_id, body) values ('${C.lipsky}', '${X.visibleTask}', '${U.lipskyUser.id}', 'Looks good')`)).toBe('ok');
        expect(await attempt(db, U.lipskyUser, `insert into public.task_comments (brand_id, task_id, author_id, body) values ('${C.lipsky}', '${X.internalTask}', '${U.lipskyUser.id}', 'peek')`)).toBe(DENIED);
        expect(await rows(U.lipskyUser, `update public.tasks set priority = 'urgent' where id = '${X.visibleTask}'`)).toBe(0);
        expect(await count(U.cmsUser, 'task_comments')).toBe(0);
    });

    it('invitation acceptance: verified email only, existing identity gains the client membership once', async () => {
        const token = (await as<{ token: string }>(db, U.vcaAdmin, `select token from public.create_invitation('${C.lipsky}', '${U.invitee.email}', 'client', null, '{download_reports}')`))[0]!.token;
        expect(await attempt(db, U.stranger, `select public.accept_invitation('${token}')`)).toBe(DENIED);
        await as(db, U.invitee, `select public.accept_invitation('${token}')`);
        expect(await attempt(db, U.invitee, `select public.accept_invitation('${token}')`)).toBe('22023');
        const m = (await db.query<{ role: string; permissions: string[] }>(`select role, permissions from public.brand_memberships where user_id = '${U.invitee.id}'`)).rows;
        expect(m).toEqual([{ role: 'client', permissions: ['download_reports'] }]);
    });
});

describe('Super Admin bootstrap (fresh database)', () => {
    it('promotes one confirmed user once, then closes; not callable by app users', async () => {
        const fresh = await createDb();
        await fresh.exec(`set role supabase_auth_admin;
            insert into auth.users (id, email, email_confirmed_at) values ('${id(3901)}', 'owner@example.test', now()), ('${id(3902)}', 'later@example.test', now()), ('${id(3903)}', 'unconfirmed@example.test', null);
            reset role;`);
        expect(await attempt(fresh, { id: id(3901), email: 'owner@example.test' }, `select app.bootstrap_super_admin('owner@example.test')`)).toBe(DENIED);
        await expect(fresh.query(`select app.bootstrap_super_admin('unconfirmed@example.test')`)).rejects.toThrow(/no confirmed auth user/);
        await fresh.query(`select app.bootstrap_super_admin('Owner@Example.test')`);
        await expect(fresh.query(`select app.bootstrap_super_admin('later@example.test')`)).rejects.toThrow(/bootstrap is closed/);
        expect((await fresh.query<{ user_id: string }>('select user_id from public.platform_admins')).rows).toEqual([{ user_id: id(3901) }]);
        expect((await fresh.query<{ action: string }>('select action from public.platform_audit_events')).rows).toEqual([{ action: 'super_admin.bootstrap' }]);
        await fresh.close();
    }, 60_000);
});
