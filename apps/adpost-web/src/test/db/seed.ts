/** Synthetic RLS fixture: 2 agencies, 3 brands, one user per role. Never real data. */
import type { PGlite } from '@electric-sql/pglite';
import { createDb, type TestUser } from './pg';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const user = (n: number, email: string): TestUser => ({ id: id(n), email });
export const U = {
    agencyOwner: user(1, 'agency.owner@adpost.example.test'),
    podOwner: user(2, 'pod.owner@pod.example.test'),
    podAdmin: user(3, 'pod.admin@pod.example.test'),
    podManager: user(4, 'pod.manager@pod.example.test'),
    podMember: user(5, 'pod.member@pod.example.test'),
    podViewer: user(6, 'pod.viewer@pod.example.test'),
    podClient: user(7, 'pod.client@client.example.test'),
    dmdManager: user(8, 'dmd.manager@dmd.example.test'),
    otherOwner: user(9, 'owner@other-agency.example.test'),
    stranger: user(10, 'stranger@example.test'),
    deactivated: user(11, 'gone@pod.example.test'),
    unconfirmed: user(12, 'unconfirmed@example.test'),
};

export const B = { pod: id(200), dmd: id(201), zed: id(202) };
export const C = { pod1: id(300), pod2: id(301), dmd1: id(302), zed1: id(303) };
export const W = { pod1: id(400), pod2: id(401), dmd1: id(402), zed1: id(403) };
export const X = {
    podAgent: id(500), dmdAgent: id(501),
    podConv: id(600), dmdConv: id(601),
    podUserMsg: id(700), podAgentMsg: id(701), dmdMsg: id(702),
    podExec: id(800), dmdExec: id(801),
    podProject: id(900), dmdProject: id(901), podTask: id(910), dmdTask: id(911),
    podApproval: id(950), dmdApproval: id(951),
    podDoc: id(960), dmdDoc: id(961),
    podN8n: id(970),
};

const SEED = /* sql */ `
set role supabase_auth_admin;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
${Object.values(U)
    .map((u) => `('${u.id}', '${u.email}', ${u === U.unconfirmed ? 'null' : 'now()'}, '{"name": "${u.email.split('@')[0]}"}')`)
    .join(',\n')};
reset role;
do $$ begin
    -- Conditional only so the PG_MIGRATION_SKIP mutation check can seed without the hardening migration.
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'deactivated_at') then
        execute $q$update public.profiles set deactivated_at = now() where id = '${U.deactivated.id}'$q$;
    end if;
end $$;

insert into public.agencies (id, name, slug) values ('${id(100)}', 'ADPOST', 'adpost'), ('${id(101)}', 'Other Agency', 'other');
insert into public.agency_memberships (agency_id, user_id, role) values ('${id(100)}', '${U.agencyOwner.id}', 'agency_owner');
insert into public.brands (id, agency_id, name, slug) values
    ('${B.pod}', '${id(100)}', 'POD', 'pod'), ('${B.dmd}', '${id(100)}', 'DMD', 'dmd'), ('${B.zed}', '${id(101)}', 'ZED', 'zed');
insert into public.clients (id, brand_id, name, slug) values
    ('${C.pod1}', '${B.pod}', 'POD Client 1', 'c1'), ('${C.pod2}', '${B.pod}', 'POD Client 2', 'c2'),
    ('${C.dmd1}', '${B.dmd}', 'DMD Client', 'c1'), ('${C.zed1}', '${B.zed}', 'ZED Client', 'c1');
insert into public.brand_memberships (brand_id, user_id, role, client_id) values
    ('${B.pod}', '${U.podOwner.id}', 'owner', null), ('${B.pod}', '${U.podAdmin.id}', 'admin', null),
    ('${B.pod}', '${U.podManager.id}', 'manager', null), ('${B.pod}', '${U.podMember.id}', 'member', null),
    ('${B.pod}', '${U.podViewer.id}', 'viewer', null), ('${B.pod}', '${U.podClient.id}', 'client', '${C.pod1}'),
    ('${B.pod}', '${U.deactivated.id}', 'manager', null),
    ('${B.dmd}', '${U.dmdManager.id}', 'manager', null), ('${B.zed}', '${U.otherOwner.id}', 'owner', null);

insert into public.websites (id, brand_id, client_id, name, domain) values
    ('${W.pod1}', '${B.pod}', '${C.pod1}', 'POD 1', 'pod1.example.test'), ('${W.pod2}', '${B.pod}', '${C.pod2}', 'POD 2', 'pod2.example.test'),
    ('${W.dmd1}', '${B.dmd}', '${C.dmd1}', 'DMD', 'dmd.example.test'), ('${W.zed1}', '${B.zed}', '${C.zed1}', 'ZED', 'zed.example.test');
insert into public.integrations (id, brand_id, client_id, website_id, provider)
    select gen_random_uuid(), brand_id, client_id, id, 'google_analytics' from public.websites;
insert into public.integration_secrets (integration_id, brand_id, encrypted_credentials)
    select id, brand_id, 'synthetic-ciphertext' from public.integrations;
insert into public.analytics_daily_metrics (brand_id, client_id, website_id, date, sessions)
    select brand_id, client_id, id, date '2026-10-01', 10 from public.websites;
insert into public.analytics_search_queries (brand_id, client_id, website_id, metric_date, query)
    select brand_id, client_id, id, date '2026-10-01', 'q' from public.websites;
insert into public.analytics_landing_pages (brand_id, client_id, website_id, metric_date, path)
    select brand_id, client_id, id, date '2026-10-01', '/' from public.websites;
insert into public.seo_insights (brand_id, client_id, website_id, type, severity, subject, title, summary, recommendation)
    select brand_id, client_id, id, 'ctr_opportunity', 'high', 's', 't', 'x', 'r' from public.websites;

insert into public.agent_instances (id, brand_id, template_key, display_name, handle, model) values
    ('${X.podAgent}', '${B.pod}', 'seo_manager', 'SEO Manager', 'seo-manager', 'simulated'),
    ('${X.dmdAgent}', '${B.dmd}', 'seo_manager', 'SEO Manager', 'seo-manager', 'simulated');
insert into public.agent_instruction_versions (brand_id, agent_instance_id, version, instructions) values
    ('${B.pod}', '${X.podAgent}', 1, 'pod'), ('${B.dmd}', '${X.dmdAgent}', 1, 'dmd');
insert into public.conversations (id, brand_id, kind, title, created_by) values
    ('${X.podConv}', '${B.pod}', 'direct', 'POD chat', '${U.podManager.id}'), ('${X.dmdConv}', '${B.dmd}', 'direct', 'DMD chat', '${U.dmdManager.id}');
insert into public.agent_executions (id, brand_id, agent_instance_id, conversation_id, status, mode, provider, model, instruction_version) values
    ('${X.podExec}', '${B.pod}', '${X.podAgent}', '${X.podConv}', 'succeeded', 'simulated', 'simulated', 'simulated', 1),
    ('${X.dmdExec}', '${B.dmd}', '${X.dmdAgent}', '${X.dmdConv}', 'succeeded', 'simulated', 'simulated', 'simulated', 1);
insert into public.messages (id, brand_id, conversation_id, author_type, author_user_id, author_agent_id, body) values
    ('${X.podUserMsg}', '${B.pod}', '${X.podConv}', 'user', '${U.podManager.id}', null, 'pod confidential plan'),
    ('${X.podAgentMsg}', '${B.pod}', '${X.podConv}', 'agent', null, '${X.podAgent}', 'pod agent reply'),
    ('${X.dmdMsg}', '${B.dmd}', '${X.dmdConv}', 'user', '${U.dmdManager.id}', null, 'dmd confidential plan');
insert into public.projects (id, brand_id, name) values ('${X.podProject}', '${B.pod}', 'POD project'), ('${X.dmdProject}', '${B.dmd}', 'DMD project');
insert into public.tasks (id, brand_id, project_id, title, created_by_type, created_by_id) values
    ('${X.podTask}', '${B.pod}', '${X.podProject}', 'POD task', 'user', '${U.podManager.id}'),
    ('${X.dmdTask}', '${B.dmd}', '${X.dmdProject}', 'DMD task', 'user', '${U.dmdManager.id}');
insert into public.approval_requests (id, brand_id, kind, title, summary, requested_by_type, requested_by_id) values
    ('${X.podApproval}', '${B.pod}', 'publish_content', 'Publish', 's', 'user', '${U.podMember.id}'),
    ('${X.dmdApproval}', '${B.dmd}', 'publish_content', 'Publish', 's', 'user', '${U.dmdManager.id}');
insert into public.knowledge_documents (id, brand_id, title, kind, content) values
    ('${X.podDoc}', '${B.pod}', 'POD guide', 'brand_guide', 'pod voice'), ('${X.dmdDoc}', '${B.dmd}', 'DMD guide', 'brand_guide', 'dmd voice');
insert into public.knowledge_chunks (brand_id, document_id, index, text) values
    ('${B.pod}', '${X.podDoc}', 0, 'pricing strategy for pod'), ('${B.dmd}', '${X.dmdDoc}', 0, 'pricing strategy for dmd');
insert into public.n8n_connections (id, brand_id, name, webhook_host) values ('${X.podN8n}', '${B.pod}', 'n8n', 'n8n.example.test');
insert into public.n8n_connection_secrets (connection_id, brand_id, webhook_url, signing_secret)
    values ('${X.podN8n}', '${B.pod}', 'https://n8n.example.test/hook', 'synthetic-secret');
insert into public.n8n_deliveries (brand_id, connection_id, event, status) values ('${B.pod}', '${X.podN8n}', 'test', 'simulated');
insert into public.audit_logs (brand_id, actor_id, action, subject_type) values
    ('${B.pod}', '${U.podOwner.id}', 'seed', 'brand'), ('${B.dmd}', '${U.dmdManager.id}', 'seed', 'brand');
insert into public.web_changes (brand_id, website_id, title, brief) values
    ('${B.pod}', '${W.pod1}', 'POD change', 'b'), ('${B.dmd}', '${W.dmd1}', 'DMD change', 'b');
insert into storage.objects (bucket_id, name) values
    ('brand-knowledge', '${B.pod}/${X.podDoc}/guide.txt'), ('brand-knowledge', '${B.dmd}/${X.dmdDoc}/guide.txt');
`;

export async function seededDb(): Promise<PGlite> {
    const db = await createDb();
    await db.exec(SEED);
    return db;
}

/** Every public table that carries brand_id (the tenant-owned set). */
export async function brandTables(db: PGlite): Promise<string[]> {
    const r = await db.query<{ t: string }>(`select c.table_name as t from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
        where c.table_schema = 'public' and c.column_name = 'brand_id' order by 1`);
    return r.rows.map((x) => x.t);
}
