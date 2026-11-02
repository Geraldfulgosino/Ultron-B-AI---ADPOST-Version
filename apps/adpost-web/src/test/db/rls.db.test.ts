// @vitest-environment node
/**
 * RLS security matrix on REAL Postgres (PGlite) with the Supabase platform emulation in ./pg.ts.
 * Users act exactly as PostgREST would: role `authenticated` + JWT claims in request.jwt.claims.
 * Scope: SQL/RLS semantics only. PostgREST, Storage API and Realtime servers are verified on staging.
 */
import type { PGlite } from '@electric-sql/pglite';
import { as, attempt, type TestUser } from './pg';
import { B, brandTables, C, id, seededDb, U, W, X } from './seed';

const DENIED = '42501';
let db: PGlite;
let tables: string[];

const count = async (u: TestUser, table: string, where = 'true') =>
    (await as<{ n: number }>(db, u, `select count(*)::int as n from public.${table} where ${where}`))[0]!.n;
/** Rows affected by an UPDATE/DELETE (RLS hides rows instead of raising). */
const affected = async (u: TestUser, sql: string) => (await as(db, u, `${sql} returning 1`)).length;

beforeAll(async () => {
    db = await seededDb();
    tables = await brandTables(db);
}, 120_000);
afterAll(async () => db?.close());

describe('brand isolation (SELECT) across every brand-owned table', () => {
    it('covers the full tenant-owned table set', () => {
        expect(tables.length).toBe(25);
        expect(tables).toEqual(expect.arrayContaining(['clients', 'messages', 'tasks', 'knowledge_chunks', 'integration_secrets', 'audit_logs']));
    });

    it('a POD-only manager never sees DMD or other-agency rows in any table', async () => {
        for (const t of tables) expect(await count(U.podManager, t, `brand_id <> '${B.pod}'`), t).toBe(0);
        expect(await count(U.podManager, 'messages', `brand_id = '${B.pod}'`)).toBe(2);
        expect(await count(U.podManager, 'clients')).toBe(2);
    });

    it('a DMD manager cannot read POD confidential data', async () => {
        for (const t of tables) expect(await count(U.dmdManager, t, `brand_id = '${B.pod}'`), t).toBe(0);
        expect(await as(db, U.dmdManager, `select body from public.messages`)).toEqual([{ body: 'dmd confidential plan' }]);
    });

    it('agency staff read every brand of their agency, none of another agency', async () => {
        expect(await count(U.agencyOwner, 'brands')).toBe(2);
        expect(await count(U.agencyOwner, 'clients', `brand_id in ('${B.pod}', '${B.dmd}')`)).toBe(3);
        for (const t of tables) expect(await count(U.agencyOwner, t, `brand_id = '${B.zed}'`), t).toBe(0);
        for (const t of tables) expect(await count(U.otherOwner, t, `brand_id <> '${B.zed}'`), t).toBe(0);
    });

    it('a signed-up user with no membership, a deactivated user and anon see nothing', async () => {
        for (const who of [U.stranger, U.deactivated]) {
            expect(await count(who, 'brands')).toBe(0);
            for (const t of tables) expect(await count(who, t), `${who.email} ${t}`).toBe(0);
        }
        // anon has no table privileges at all (defence in depth over RLS).
        for (const t of ['brands', 'clients', 'messages', 'profiles', ...tables]) {
            expect(await attempt(db, 'anon', `select 1 from public.${t} limit 1`), t).toBe(DENIED);
        }
    });

    it('secret tables are invisible to every signed-in role, even owners and agency staff', async () => {
        for (const who of [U.podOwner, U.agencyOwner]) {
            expect(await count(who, 'integration_secrets')).toBe(0);
            expect(await count(who, 'n8n_connection_secrets')).toBe(0);
        }
        expect((await as<{ n: number }>(db, 'service_role', 'select count(*)::int as n from public.integration_secrets'))[0]!.n).toBe(4);
    });

    it('profiles: you see yourself and colleagues of brands where you are staff, nobody else', async () => {
        const seen = (await as<{ id: string }>(db, U.podManager, 'select id from public.profiles')).map((r) => r.id);
        expect(seen).toContain(U.podOwner.id);
        expect(seen).not.toContain(U.dmdManager.id);
        expect(await as(db, U.stranger, 'select id from public.profiles')).toEqual([{ id: U.stranger.id }]);
    });
});

describe('client portal scope', () => {
    it('sees only its own client rows', async () => {
        expect(await as(db, U.podClient, 'select id from public.clients')).toEqual([{ id: C.pod1 }]);
        expect(await as(db, U.podClient, 'select id from public.websites')).toEqual([{ id: W.pod1 }]);
        for (const t of ['analytics_daily_metrics', 'analytics_search_queries', 'analytics_landing_pages', 'seo_insights', 'integrations']) {
            expect(await count(U.podClient, t, `client_id <> '${C.pod1}'`), t).toBe(0);
            expect(await count(U.podClient, t), t).toBe(1);
        }
    });

    it('sees no staff-only tables (AI, chat, work, knowledge, automation, audit)', async () => {
        for (const t of ['agent_instances', 'agent_instruction_versions', 'conversations', 'messages', 'agent_executions', 'projects', 'tasks', 'approval_requests', 'knowledge_documents', 'knowledge_chunks', 'n8n_connections', 'n8n_deliveries', 'audit_logs', 'web_changes']) {
            expect(await count(U.podClient, t), t).toBe(0);
        }
    });

    it('cannot write', async () => {
        expect(await attempt(db, U.podClient, `insert into public.clients (brand_id, name, slug) values ('${B.pod}', 'x', 'x')`)).toBe(DENIED);
        expect(await affected(U.podClient, `update public.clients set name = 'x' where id = '${C.pod1}'`)).toBe(0);
    });
});

describe('role-based writes', () => {
    it('viewer reads but cannot insert, update or delete', async () => {
        expect(await count(U.podViewer, 'clients')).toBe(2);
        expect(await attempt(db, U.podViewer, `insert into public.clients (brand_id, name, slug) values ('${B.pod}', 'v', 'v')`)).toBe(DENIED);
        expect(await affected(U.podViewer, `update public.clients set name = 'v' where brand_id = '${B.pod}'`)).toBe(0);
        expect(await affected(U.podViewer, `delete from public.tasks where id = '${X.podTask}'`)).toBe(0);
    });

    it('member writes in its brand, cannot delete admin-only rows, cannot write elsewhere', async () => {
        expect(await attempt(db, U.podMember, `insert into public.clients (brand_id, name, slug) values ('${B.pod}', 'Member Co', 'member-co')`)).toBe('ok');
        expect(await affected(U.podMember, `delete from public.clients where slug = 'member-co'`)).toBe(0);
        expect(await attempt(db, U.podMember, `insert into public.clients (brand_id, name, slug) values ('${B.dmd}', 'Injected', 'inj')`)).toBe(DENIED);
        expect(await count(U.dmdManager, 'clients', `slug = 'inj'`)).toBe(0);
    });

    it('ids from another brand cannot be smuggled through an allowed brand', async () => {
        expect(await attempt(db, U.podManager, `insert into public.websites (brand_id, client_id, name, domain) values ('${B.pod}', '${C.dmd1}', 'x', 'smuggle.example.test')`)).toBe(DENIED);
        expect(await attempt(db, U.podManager, `insert into public.tasks (brand_id, project_id, title, created_by_type, created_by_id) values ('${B.pod}', '${X.dmdProject}', 'x', 'user', '${U.podManager.id}')`)).toBe(DENIED);
        expect(await attempt(db, U.podManager, `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${B.pod}', '${X.dmdConv}', 'user', '${U.podManager.id}', 'x')`)).toBe(DENIED);
    });

    it('brand_id is immutable, even for agency staff who can write both brands', async () => {
        expect(await attempt(db, U.agencyOwner, `update public.clients set brand_id = '${B.dmd}' where id = '${C.pod2}'`)).toBe(DENIED);
        expect(await count(U.agencyOwner, 'clients', `id = '${C.pod2}' and brand_id = '${B.pod}'`)).toBe(1);
    });

    it('brand settings: admins edit allowed columns only; agency_id and slug are not user-editable', async () => {
        expect(await affected(U.podAdmin, `update public.brands set description = 'edited' where id = '${B.pod}'`)).toBe(1);
        expect(await attempt(db, U.podAdmin, `update public.brands set agency_id = '${id(101)}' where id = '${B.pod}'`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `update public.brands set slug = 'hijack' where id = '${B.pod}'`)).toBe(DENIED);
        expect(await affected(U.podManager, `update public.brands set description = 'nope' where id = '${B.pod}'`)).toBe(0);
    });

    it('users cannot create agent executions, templates or agencies directly', async () => {
        expect(await attempt(db, U.podOwner, `insert into public.agent_executions (brand_id, agent_instance_id, status, mode, provider, model, instruction_version) values ('${B.pod}', '${X.podAgent}', 'succeeded', 'live', 'anthropic', 'm', 1)`)).toBe(DENIED);
        expect(await attempt(db, U.agencyOwner, `insert into public.agent_templates (key, name, handle, team, description, default_instructions, default_tools) values ('seo_manager', 'x', 'x2', 'seo', 'd', 'i', '{}')`)).toBe(DENIED);
        expect(await attempt(db, U.agencyOwner, `insert into public.agencies (name, slug) values ('x', 'x')`)).toBe(DENIED);
        expect(await attempt(db, U.podOwner, `insert into public.subscriptions (agency_id, provider, provider_customer_id, provider_subscription_id, plan_key, status, current_period_end) values ('${id(100)}', 'x', 'x', 'x', 'agency', 'active', now())`)).toBe(DENIED);
    });
});

describe('privilege escalation attempts', () => {
    it('S1: an admin cannot demote, remove or become the owner; an owner can promote', async () => {
        expect(await affected(U.podAdmin, `update public.brand_memberships set role = 'viewer' where user_id = '${U.podOwner.id}' and brand_id = '${B.pod}'`)).toBe(0);
        expect(await affected(U.podAdmin, `delete from public.brand_memberships where user_id = '${U.podOwner.id}' and brand_id = '${B.pod}'`)).toBe(0);
        expect(await attempt(db, U.podAdmin, `update public.brand_memberships set role = 'owner' where user_id = '${U.podAdmin.id}' and brand_id = '${B.pod}'`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `insert into public.brand_memberships (brand_id, user_id, role) values ('${B.pod}', '${U.stranger.id}', 'owner')`)).toBe(DENIED);
        expect(await attempt(db, U.podManager, `insert into public.brand_memberships (brand_id, user_id, role) values ('${B.pod}', '${U.stranger.id}', 'member')`)).toBe(DENIED);
        expect(await count(U.podOwner, 'brand_memberships', `user_id = '${U.podOwner.id}' and role = 'owner'`)).toBe(1);
    });

    it('a client membership must point at a client of the same brand', async () => {
        expect(await attempt(db, U.podAdmin, `insert into public.brand_memberships (brand_id, user_id, role, client_id) values ('${B.pod}', '${U.stranger.id}', 'client', '${C.dmd1}')`)).toBe(DENIED);
    });

    it('S4: users cannot change their own email or deactivation flag; name is editable', async () => {
        expect(await attempt(db, U.podMember, `update public.profiles set email = 'pod.owner@pod.example.test' where id = '${U.podMember.id}'`)).toBe(DENIED);
        expect(await attempt(db, U.deactivated, `update public.profiles set deactivated_at = null where id = '${U.deactivated.id}'`)).toBe(DENIED);
        expect(await affected(U.podMember, `update public.profiles set name = 'Renamed' where id = '${U.podMember.id}'`)).toBe(1);
        expect(await affected(U.podMember, `update public.profiles set name = 'Hacked' where id = '${U.podOwner.id}'`)).toBe(0);
    });

    it('S5: users cannot forge agent messages, proposals or another author', async () => {
        const ins = (cols: string, vals: string) => attempt(db, U.podManager, `insert into public.messages (brand_id, conversation_id, ${cols}, body) values ('${B.pod}', '${X.podConv}', ${vals}, 'x')`);
        expect(await ins('author_type, author_agent_id', `'agent', '${X.podAgent}'`)).not.toBe('ok');
        expect(await ins('author_type, author_user_id, proposals', `'user', '${U.podManager.id}', '[{"kind":"task"}]'`)).toBe(DENIED);
        expect(await ins('author_type, author_user_id, execution_id', `'user', '${U.podManager.id}', '${X.podExec}'`)).toBe(DENIED);
        expect(await ins('author_type, author_user_id', `'user', '${U.podOwner.id}'`)).toBe(DENIED);
        expect(await ins('author_type, author_user_id', `'user', '${U.podManager.id}'`)).toBe('ok');
        expect(await attempt(db, U.podManager, `update public.messages set body = 'edited' where id = '${X.podAgentMsg}'`)).toBe(DENIED);
    });

    it('tasks attributed to an agent must come from an agent message in the same brand', async () => {
        const task = (by: string, extra = 'null') => attempt(db, U.podManager, `insert into public.tasks (brand_id, project_id, title, created_by_type, created_by_id, source_message_id) values ('${B.pod}', '${X.podProject}', 't', ${by}, ${extra})`);
        expect(await task(`'agent', '${X.podAgent}'`)).toBe(DENIED);
        expect(await task(`'agent', '${X.podAgent}'`.replace(/$/, ''), `'${X.podUserMsg}'`)).toBe(DENIED);
        expect(await task(`'agent', '${X.podAgent}'`, `'${X.podAgentMsg}'`)).toBe('ok');
        expect(await task(`'user', '${U.podOwner.id}'`)).toBe(DENIED);
        expect(await attempt(db, U.podManager, `update public.tasks set created_by_type = 'system' where id = '${X.podTask}'`)).toBe(DENIED);
        expect(await affected(U.podManager, `update public.tasks set status = 'done' where id = '${X.podTask}'`)).toBe(1);
    });

    it('app.* helpers and the auth trigger function are not callable by anon / directly', async () => {
        expect(await attempt(db, 'anon', `select app.can_read_brand('${B.pod}')`)).toBe(DENIED);
        expect(await attempt(db, U.podOwner, `select app.handle_new_user()`)).toBe(DENIED);
        expect(await attempt(db, 'anon', `select public.accept_invitation('x')`)).toBe(DENIED);
    });
});

describe('approvals (mirror of local work.ts rules)', () => {
    it('only admins decide, never their own request, only while pending, recording themselves', async () => {
        // The requester passes USING (they may cancel) but fails WITH CHECK (only admins approve).
        expect(await attempt(db, U.podMember, `update public.approval_requests set status = 'approved', decided_by = '${U.podMember.id}' where id = '${X.podApproval}'`)).toBe(DENIED);
        expect(await affected(U.podViewer, `update public.approval_requests set status = 'approved', decided_by = '${U.podViewer.id}' where id = '${X.podApproval}'`)).toBe(0);
        expect(await attempt(db, U.podAdmin, `update public.approval_requests set status = 'approved', decided_by = '${U.podOwner.id}' where id = '${X.podApproval}'`)).toBe(DENIED);
        expect(await affected(U.podAdmin, `update public.approval_requests set status = 'approved', decided_by = '${U.podAdmin.id}', decided_at = now() where id = '${X.podApproval}'`)).toBe(1);
        expect(await affected(U.podOwner, `update public.approval_requests set status = 'rejected', decided_by = '${U.podOwner.id}' where id = '${X.podApproval}'`)).toBe(0);
        expect(await affected(U.podAdmin, `update public.approval_requests set status = 'approved', decided_by = '${U.podAdmin.id}' where id = '${X.dmdApproval}'`)).toBe(0);
    });

    it('a request is raised pending, as yourself; an admin cannot approve a request they raised; the requester can cancel', async () => {
        expect(await attempt(db, U.podAdmin, `insert into public.approval_requests (brand_id, kind, title, summary, requested_by_type, requested_by_id, status) values ('${B.pod}', 'deploy_change', 't', 's', 'user', '${U.podAdmin.id}', 'approved')`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `insert into public.approval_requests (brand_id, kind, title, summary, requested_by_type, requested_by_id) values ('${B.pod}', 'deploy_change', 't', 's', 'user', '${U.podOwner.id}')`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `insert into public.approval_requests (id, brand_id, kind, title, summary, requested_by_type, requested_by_id) values ('${id(990)}', '${B.pod}', 'deploy_change', 'Own', 's', 'user', '${U.podAdmin.id}')`)).toBe('ok');
        expect(await attempt(db, U.podAdmin, `update public.approval_requests set status = 'approved', decided_by = '${U.podAdmin.id}' where id = '${id(990)}'`)).toBe(DENIED);
        expect(await affected(U.podAdmin, `update public.approval_requests set status = 'cancelled', decided_by = '${U.podAdmin.id}' where id = '${id(990)}'`)).toBe(1);
        expect(await attempt(db, U.podAdmin, `update public.approval_requests set requested_by_id = '${U.podOwner.id}' where id = '${id(990)}'`)).toBe(DENIED);
    });
});

describe('invitations (S2): RPC-only, hashed tokens, verified email', () => {
    const create = (u: TestUser, role: string, client = 'null', email = U.stranger.email) =>
        as<{ token: string }>(db, u, `select token from public.create_invitation('${B.pod}', '${email}', '${role}', ${client})`);

    it('only admins create; only owners/agency staff may invite owners; direct table writes are refused', async () => {
        expect(await attempt(db, U.podManager, `select public.create_invitation('${B.pod}', 'x@example.test', 'member')`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `select public.create_invitation('${B.pod}', 'x@example.test', 'owner')`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `insert into public.invitations (brand_id, email, role, invited_by, token_hash, expires_at) values ('${B.pod}', 'x@example.test', 'owner', '${U.podAdmin.id}', 'h', now() + interval '1 day')`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `select public.create_invitation('${B.pod}', 'y@example.test', 'client', '${C.dmd1}')`)).not.toBe('ok');
        expect(await attempt(db, U.podAdmin, `select public.create_invitation('${B.pod}', '${U.podMember.email}', 'viewer')`)).not.toBe('ok');
    });

    it('stores only the token hash, previews for signed-in users, accepts only for the verified invited email', async () => {
        const [{ token }] = (await create(U.podAdmin, 'manager')) as [{ token: string }];
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(await count(U.podAdmin, 'invitations', `token_hash = '${token}'`)).toBe(0);

        expect(await as(db, U.stranger, `select brand_slug, role, status from public.preview_invitation($1)`, [token])).toEqual([{ brand_slug: 'pod', role: 'manager', status: 'pending' }]);
        expect(await attempt(db, U.dmdManager, `select public.accept_invitation($1)`, [token])).toBe(DENIED);
        expect(await count(U.stranger, 'clients')).toBe(0);
        expect(await as(db, U.stranger, `select public.accept_invitation($1) as slug`, [token])).toEqual([{ slug: 'pod' }]);
        expect(await count(U.stranger, 'clients')).toBe(await count(U.podManager, 'clients'));
        expect(await count(U.stranger, 'clients', `brand_id <> '${B.pod}'`)).toBe(0);
        expect(await count(U.stranger, 'brand_memberships', `user_id = '${U.stranger.id}' and role = 'manager'`)).toBe(1);
        expect(await attempt(db, U.stranger, `select public.accept_invitation($1)`, [token])).not.toBe('ok');
    });

    it('rejects unconfirmed emails and expired invitations; admins can cancel', async () => {
        const [{ token }] = (await create(U.podAdmin, 'viewer', 'null', U.unconfirmed.email)) as [{ token: string }];
        expect(await attempt(db, U.unconfirmed, `select public.accept_invitation($1)`, [token])).toBe(DENIED);
        await db.exec(`update public.invitations set expires_at = now() - interval '1 minute' where email = '${U.unconfirmed.email}'`);
        await db.exec(`update auth.users set email_confirmed_at = now() where id = '${U.unconfirmed.id}'`);
        expect(await attempt(db, U.unconfirmed, `select public.accept_invitation($1)`, [token])).toBe('22023');
        expect(await as(db, U.unconfirmed, `select status from public.preview_invitation($1)`, [token])).toEqual([{ status: 'expired' }]);

        const [{ token: t2 }] = (await create(U.podAdmin, 'viewer', 'null', 'later@example.test')) as [{ token: string }];
        expect(t2).toBeTruthy();
        expect(await affected(U.podAdmin, `update public.invitations set status = 'cancelled' where email = 'later@example.test'`)).toBe(1);
        expect(await attempt(db, U.podAdmin, `update public.invitations set role = 'owner' where email = 'later@example.test'`)).toBe(DENIED);
    });
});

describe('revocation and deactivation', () => {
    it('removing a membership revokes access immediately', async () => {
        expect(await count(U.podViewer, 'clients')).toBeGreaterThan(0);
        expect(await affected(U.podAdmin, `delete from public.brand_memberships where user_id = '${U.podViewer.id}' and brand_id = '${B.pod}'`)).toBe(1);
        for (const t of tables) expect(await count(U.podViewer, t), t).toBe(0);
    });

    it('deactivating a profile revokes access even though memberships remain', async () => {
        expect(await count(U.podMember, 'clients')).toBeGreaterThan(0);
        await db.exec(`update public.profiles set deactivated_at = now() where id = '${U.podMember.id}'`);
        expect(await count(U.podMember, 'clients')).toBe(0);
        expect(await count(U.podMember, 'brands')).toBe(0);
        expect(await attempt(db, U.podMember, `insert into public.clients (brand_id, name, slug) values ('${B.pod}', 'z', 'z')`)).toBe(DENIED);
    });
});

describe('storage (brand-knowledge bucket)', () => {
    const objects = (u: TestUser) => as<{ name: string }>(db, u, `select name from storage.objects where bucket_id = 'brand-knowledge' order by name`);

    it('staff read only their brand folder; clients and outsiders read nothing', async () => {
        expect((await objects(U.podManager)).map((o) => o.name.split('/')[0])).toEqual([B.pod]);
        expect((await objects(U.dmdManager)).map((o) => o.name.split('/')[0])).toEqual([B.dmd]);
        expect(await objects(U.podClient)).toEqual([]);
        expect(await objects(U.otherOwner)).toEqual([]);
    });

    it('uploads are allowed only into a writable brand folder; malformed paths are denied cleanly', async () => {
        const put = (u: TestUser, name: string) => attempt(db, u, `insert into storage.objects (bucket_id, name) values ('brand-knowledge', '${name}')`);
        expect(await put(U.podManager, `${B.pod}/${X.podDoc}/new.txt`)).toBe('ok');
        expect(await put(U.podManager, `${B.dmd}/${X.dmdDoc}/evil.txt`)).toBe(DENIED);
        expect(await put(U.podClient, `${B.pod}/${X.podDoc}/client.txt`)).toBe(DENIED);
        expect(await put(U.podManager, `not-a-uuid/x.txt`)).toBe(DENIED);
        expect(await affected(U.podManager, `delete from storage.objects where name like '${B.dmd}/%'`)).toBe(0);
    });

    it('report-exports has no direct user access (signed URLs only); buckets are private with limits', async () => {
        expect(await attempt(db, U.podOwner, `insert into storage.objects (bucket_id, name) values ('report-exports', '${B.pod}/r.csv')`)).toBe(DENIED);
        const buckets = await db.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`);
        expect(buckets.rows).toEqual([
            { id: 'brand-knowledge', public: false, file_size_limit: 1048576, allowed_mime_types: ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf'] },
            { id: 'report-exports', public: false, file_size_limit: 20971520, allowed_mime_types: ['text/csv', 'application/pdf'] },
        ]);
    });
});

describe('knowledge retrieval and realtime', () => {
    it('full-text retrieval only returns chunks from the caller’s brand', async () => {
        const q = `select brand_id from public.knowledge_chunks where to_tsvector('english', text) @@ plainto_tsquery('english', 'pricing strategy')`;
        expect(await as(db, U.podManager, q)).toEqual([{ brand_id: B.pod }]);
        expect(await as(db, U.agencyOwner, q)).toHaveLength(2);
        expect(await as(db, U.podClient, q)).toEqual([]);
    });

    it('realtime publication carries exactly the chat, execution and approval tables (delivery filtered by these SELECT policies)', async () => {
        const r = await db.query<{ t: string }>(`select tablename as t from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
        expect(r.rows.map((x) => x.t)).toEqual(['agent_executions', 'approval_requests', 'messages']);
    });
});
