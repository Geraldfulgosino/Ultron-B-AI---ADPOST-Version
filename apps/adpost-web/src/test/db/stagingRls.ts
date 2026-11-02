/**
 * Builds a ROLLBACK-ONLY RLS verification script for the real staging database.
 *
 * The script seeds the synthetic fixture inside a transaction, impersonates each test user
 * the way PostgREST does (SET LOCAL ROLE authenticated + request.jwt.claims), records every
 * check, then RAISEs an exception carrying the results as JSON. The exception aborts the
 * transaction, so NOTHING persists. Proven on PGlite by stagingRls.db.test.ts before use.
 *
 * Run on staging:  npx supabase@2.121.0 db query --linked -f <generated file>
 */
import { B, C, SEED, U, W, X } from './seed';

interface Check {
    name: string;
    /** 'anon' or a seed user key. */
    who: keyof typeof U | 'anon';
    sql: string;
    /** Expected scalar result as text, or 'ERR' for any error / 'ERR:<sqlstate>'. */
    expect: string;
}

const BRAND_TABLES_SQL = `select array_agg(c.table_name::text order by c.table_name) from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'brand_id'`;

export const CHECKS: Check[] = [
    { name: 'podManager: no non-POD row in any brand table', who: 'podManager', sql: `__SUM_OTHER__${B.pod}`, expect: '0' },
    { name: 'podManager: sees POD clients', who: 'podManager', sql: `select count(*) from public.clients`, expect: '2' },
    { name: 'dmdManager: no POD row in any brand table', who: 'dmdManager', sql: `__SUM_BRAND__${B.pod}`, expect: '0' },
    { name: 'dmdManager: sees only DMD message', who: 'dmdManager', sql: `select string_agg(body, ',') from public.messages`, expect: 'dmd confidential plan' },
    { name: 'agencyOwner: both agency brands', who: 'agencyOwner', sql: `select count(*) from public.brands`, expect: '2' },
    { name: 'agencyOwner: nothing from other agency', who: 'agencyOwner', sql: `__SUM_BRAND__${B.zed}`, expect: '0' },
    { name: 'otherOwner: nothing from ADPOST agency', who: 'otherOwner', sql: `__SUM_OTHER__${B.zed}`, expect: '0' },
    { name: 'stranger: no brand rows', who: 'stranger', sql: `__SUM_ALL__`, expect: '0' },
    { name: 'deactivated: no brand rows', who: 'deactivated', sql: `__SUM_ALL__`, expect: '0' },
    { name: 'deactivated: no own membership', who: 'deactivated', sql: `select count(*) from public.brand_memberships`, expect: '0' },
    { name: 'anon: no table privilege', who: 'anon', sql: `select count(*) from public.clients`, expect: 'ERR:42501' },
    { name: 'anon: cannot call invitation RPC', who: 'anon', sql: `select public.accept_invitation('x')`, expect: 'ERR:42501' },
    { name: 'owner: secrets invisible', who: 'podOwner', sql: `select count(*) from public.integration_secrets`, expect: '0' },
    { name: 'agency: n8n secrets invisible', who: 'agencyOwner', sql: `select count(*) from public.n8n_connection_secrets`, expect: '0' },
    { name: 'client: only own client', who: 'podClient', sql: `select string_agg(id::text, ',') from public.clients`, expect: C.pod1 },
    { name: 'client: only own website', who: 'podClient', sql: `select string_agg(id::text, ',') from public.websites`, expect: W.pod1 },
    { name: 'client: no chat', who: 'podClient', sql: `select count(*) from public.messages`, expect: '0' },
    { name: 'client: cannot insert', who: 'podClient', sql: `insert into public.clients (brand_id, name, slug) values ('${B.pod}', 'x', 'x') returning 1`, expect: 'ERR:42501' },
    { name: 'viewer: cannot insert', who: 'podViewer', sql: `insert into public.clients (brand_id, name, slug) values ('${B.pod}', 'v', 'v') returning 1`, expect: 'ERR:42501' },
    { name: 'member: cannot write DMD', who: 'podMember', sql: `insert into public.clients (brand_id, name, slug) values ('${B.dmd}', 'i', 'i') returning 1`, expect: 'ERR:42501' },
    { name: 'smuggle DMD client into POD website', who: 'podManager', sql: `insert into public.websites (brand_id, client_id, name, domain) values ('${B.pod}', '${C.dmd1}', 'x', 's.example.test') returning 1`, expect: 'ERR:42501' },
    { name: 'brand_id immutable', who: 'agencyOwner', sql: `update public.clients set brand_id = '${B.dmd}' where id = '${C.pod2}' returning 1`, expect: 'ERR:42501' },
    { name: 'S1 admin cannot demote owner', who: 'podAdmin', sql: `with u as (update public.brand_memberships set role = 'viewer' where user_id = '${U.podOwner.id}' returning 1) select count(*) from u`, expect: '0' },
    { name: 'S1 admin cannot self-promote', who: 'podAdmin', sql: `update public.brand_memberships set role = 'owner' where user_id = '${U.podAdmin.id}' returning 1`, expect: 'ERR:42501' },
    { name: 'S2 admin cannot invite owner', who: 'podAdmin', sql: `select public.create_invitation('${B.pod}', 'x@example.test', 'owner')`, expect: 'ERR:42501' },
    { name: 'S2 no direct invitation insert', who: 'podAdmin', sql: `insert into public.invitations (brand_id, email, role, invited_by, token_hash, expires_at) values ('${B.pod}', 'x@example.test', 'owner', '${U.podAdmin.id}', 'h', now()) returning 1`, expect: 'ERR:42501' },
    { name: 'S4 email not self-editable', who: 'podMember', sql: `update public.profiles set email = 'x@example.test' where id = '${U.podMember.id}' returning 1`, expect: 'ERR:42501' },
    { name: 'S5 no forged proposals', who: 'podManager', sql: `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body, proposals) values ('${B.pod}', '${X.podConv}', 'user', '${U.podManager.id}', 'x', '[{"k":1}]') returning 1`, expect: 'ERR:42501' },
    { name: 'S5 cannot impersonate author', who: 'podManager', sql: `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${B.pod}', '${X.podConv}', 'user', '${U.podOwner.id}', 'x') returning 1`, expect: 'ERR:42501' },
    { name: 'own message allowed', who: 'podManager', sql: `insert into public.messages (brand_id, conversation_id, author_type, author_user_id, body) values ('${B.pod}', '${X.podConv}', 'user', '${U.podManager.id}', 'hello') returning 1`, expect: '1' },
    { name: 'approval: member cannot approve', who: 'podMember', sql: `update public.approval_requests set status = 'approved', decided_by = '${U.podMember.id}' where id = '${X.podApproval}' returning 1`, expect: 'ERR:42501' },
    { name: 'approval: admin approves', who: 'podAdmin', sql: `update public.approval_requests set status = 'approved', decided_by = '${U.podAdmin.id}' where id = '${X.podApproval}' returning 1`, expect: '1' },
    { name: 'storage: manager sees only POD folder', who: 'podManager', sql: `select string_agg(split_part(name, '/', 1), ',') from storage.objects where bucket_id = 'brand-knowledge'`, expect: B.pod },
    { name: 'storage: no upload into DMD folder', who: 'podManager', sql: `insert into storage.objects (bucket_id, name) values ('brand-knowledge', '${B.dmd}/x/evil.txt') returning 1`, expect: 'ERR:42501' },
    { name: 'storage: malformed path denied', who: 'podManager', sql: `insert into storage.objects (bucket_id, name) values ('brand-knowledge', 'not-a-uuid/x.txt') returning 1`, expect: 'ERR:42501' },
    { name: 'storage: client reads nothing', who: 'podClient', sql: `select count(*) from storage.objects where bucket_id = 'brand-knowledge'`, expect: '0' },
    { name: 'knowledge FTS stays in brand', who: 'podManager', sql: `select string_agg(brand_id::text, ',') from public.knowledge_chunks where to_tsvector('english', text) @@ plainto_tsquery('english', 'pricing strategy')`, expect: B.pod },
    { name: 'users cannot create executions', who: 'podOwner', sql: `insert into public.agent_executions (brand_id, agent_instance_id, status, mode, provider, model, instruction_version) values ('${B.pod}', '${X.podAgent}', 'succeeded', 'live', 'x', 'm', 1) returning 1`, expect: 'ERR:42501' },
];

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** @param seedSql the fixture; on staging the auth-admin role switch is stripped (postgres inserts directly). */
export function buildStagingRlsSql(seedSql: string = SEED): string {
    const checks = CHECKS.map((c) => {
        const user = c.who === 'anon' ? null : U[c.who];
        return `(${lit(c.name)}, ${user ? lit(user.id) : 'null'}, ${user ? lit(user.email) : 'null'}, ${lit(c.sql)}, ${lit(c.expect)})`;
    }).join(',\n    ');
    return `-- ROLLBACK-ONLY staging RLS verification (generated by src/test/db/stagingRls.ts). Persists nothing.
begin;
${seedSql}

create function pg_temp.run_as(p_uid uuid, p_email text, p_sql text) returns text language plpgsql as $f$
declare r text; tbls text[]; s text := p_sql; t text; total bigint := 0; n bigint;
begin
    if s like '\\_\\_SUM\\_%' then
        execute ${lit(BRAND_TABLES_SQL)} into tbls;
    end if;
    perform set_config('request.jwt.claims',
        case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'email', p_email, 'role', 'authenticated')::text end, true);
    execute case when p_uid is null then 'set local role anon' else 'set local role authenticated' end;
    begin
        if s like '\\_\\_SUM\\_%' then
            foreach t in array tbls loop
                execute format('select count(*) from public.%I where %s', t,
                    case when s = '__SUM_ALL__' then 'true'
                         when s like '__SUM_OTHER__%' then format('brand_id <> %L', substr(s, 14))
                         else format('brand_id = %L', substr(s, 14)) end) into n;
                total := total + n;
            end loop;
            r := total::text;
        else
            execute s into r;
        end if;
    exception when others then
        r := 'ERR:' || sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return coalesce(r, 'NULL');
end $f$;

do $v$
declare rec record; got text; results jsonb := '[]'::jsonb; failed int := 0;
begin
    for rec in select * from (values
    ${checks}
    ) as c(name, uid, email, sql, expect) loop
        got := pg_temp.run_as(rec.uid::uuid, rec.email, rec.sql);
        if not (got = rec.expect or (rec.expect = 'ERR' and got like 'ERR:%')) then
            failed := failed + 1;
        end if;
        results := results || jsonb_build_object('name', rec.name, 'expect', rec.expect, 'got', got);
    end loop;
    raise exception 'STAGING_RLS_RESULTS %', jsonb_build_object('total', jsonb_array_length(results), 'failed', failed, 'results', results)::text;
end $v$;
`;
}

export interface StagingRlsResult {
    total: number;
    failed: number;
    results: Array<{ name: string; expect: string; got: string }>;
}

export function parseStagingRlsResults(text: string): StagingRlsResult {
    const i = text.indexOf('STAGING_RLS_RESULTS ');
    if (i < 0) throw new Error('No STAGING_RLS_RESULTS marker in output');
    // The Management API returns the exception text JSON-escaped (sometimes twice): unescape quotes.
    const rest = text.slice(i + 'STAGING_RLS_RESULTS '.length).replace(/\\+"/g, '"');
    let depth = 0;
    for (let j = 0; j < rest.length; j++) {
        if (rest[j] === '{') depth++;
        if (rest[j] === '}' && --depth === 0) return JSON.parse(rest.slice(0, j + 1)) as StagingRlsResult;
    }
    throw new Error('Unterminated results JSON');
}
