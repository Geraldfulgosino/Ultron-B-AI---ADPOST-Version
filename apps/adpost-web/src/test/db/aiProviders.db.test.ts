// @vitest-environment node
/**
 * Migration 0007 (AI provider connection manager) on real Postgres (PGlite).
 * Synthetic fixture only. Secret slots are names; no credential value exists anywhere.
 */
import type { PGlite } from '@electric-sql/pglite';
import { as, attempt, type TestUser } from './pg';
import { AI, B, id, seededDb, U, X } from './seed';

const DENIED = '42501';
const CHECK = '23514';
const AGENCY = id(100);
const OTHER_AGENCY = id(101);
let db: PGlite;

const ids = async (u: TestUser, table: string, where = 'true') =>
    (await as<{ id: string }>(db, u, `select id from public.${table} where ${where} order by id`)).map((r) => r.id);
const svc = (sql: string, params: unknown[] = []) => as(db, 'service_role', sql, params);
const AI_TABLES = ['ai_providers', 'ai_provider_connections', 'ai_provider_models', 'ai_routing_policies',
    'ai_agent_model_assignments', 'ai_usage_events', 'ai_provider_health_checks', 'ai_audit_events'];

beforeAll(async () => {
    db = await seededDb();
}, 120_000);
afterAll(async () => db?.close());

describe('credential storage', () => {
    it('no AI table has a column that could hold a credential value', async () => {
        const cols = await db.query<{ c: string; t: string }>(`select table_name || '.' || column_name as c, data_type as t from information_schema.columns
            where table_schema = 'public' and table_name like 'ai\\_%' and column_name ~ '(key|secret|token|password|credential)'`);
        // Token columns are numeric counts/limits; the only text column is the logical slot name.
        const textual = cols.rows.filter((r) => !['integer', 'bigint'].includes(r.t)).map((r) => r.c);
        expect(textual).toEqual(['ai_provider_connections.credential_reference']);
        expect(cols.rows.length).toBeGreaterThan(1);
    });

    it('credential_reference accepts only allow-listed slot names matching the provider, never a key', async () => {
        const insert = (provider: string, ref: string) => attempt(db, U.agencyOwner,
            `insert into public.ai_provider_connections (agency_id, provider_code, display_name, authentication_method, credential_reference)
             values ($1, $2, $3, 'platform_secret', $4)`, [AGENCY, provider, `t-${ref.slice(0, 20)}-${provider}`, ref]);
        expect(await insert('anthropic', 'sk-ant-api03-synthetic')).toBe(CHECK);
        expect(await insert('openai', 'sk-proj-synthetic')).toBe(CHECK);
        expect(await insert('openai', 'ANTHROPIC_API_KEY')).toBe(CHECK); // slot of another provider
        expect(await insert('anthropic', 'SUPABASE_SERVICE_ROLE_KEY')).toBe(CHECK); // non-provider secret
        expect(await insert('anthropic', 'ANTHROPIC_API_KEY_MARKETING')).toBe('ok');
    });

    it('BYOK and custom endpoints are not enabled by the schema', async () => {
        expect(await attempt(db, U.agencyOwner, `insert into public.ai_provider_connections (agency_id, provider_code, display_name, authentication_method)
            values ($1, 'anthropic', 'byok', 'byok_vault')`, [AGENCY])).toBe(CHECK);
        const cols = await db.query(`select 1 from information_schema.columns where table_name = 'ai_provider_connections' and column_name ~ '(endpoint|base_url|url)'`);
        expect(cols.rows).toHaveLength(0);
    });
});

describe('who manages connections', () => {
    it('only agency staff create connections; brand owners/admins and lower roles cannot', async () => {
        const ins = (u: TestUser, brand: string | null) => attempt(db, u, `insert into public.ai_provider_connections
            (agency_id, brand_id, provider_code, display_name, authentication_method, credential_reference)
            values ($1, $2, 'openai', $3, 'platform_secret', 'OPENAI_API_KEY')`, [AGENCY, brand, `new-${u.id.slice(-3)}-${brand ?? 'org'}`]);
        for (const u of [U.podOwner, U.podAdmin, U.podManager, U.podMember, U.podViewer, U.podClient, U.stranger, U.deactivated, U.otherOwner]) {
            expect(await ins(u, null), u.email).toBe(DENIED);
            expect(await ins(u, B.pod), u.email).toBe(DENIED);
        }
        expect(await ins(U.agencyOwner, B.pod)).toBe('ok');
        // A brand-scoped connection must belong to the agency's own brand.
        expect(await attempt(db, U.otherOwner, `insert into public.ai_provider_connections
            (agency_id, brand_id, provider_code, display_name, authentication_method, credential_reference)
            values ($1, $2, 'openai', 'steal', 'platform_secret', 'OPENAI_API_KEY')`, [OTHER_AGENCY, B.pod])).toBe(DENIED);
    });

    it('status, verification and audit columns cannot be written by any user', async () => {
        for (const col of [`connection_status = 'connected'`, `last_tested_at = now()`, `verified_models = '{x}'`, `created_by = '${U.podOwner.id}'`, `agency_id = '${OTHER_AGENCY}'`]) {
            expect(await attempt(db, U.agencyOwner, `update public.ai_provider_connections set ${col} where id = '${AI.agencyAnthropic}'`), col).toBe(DENIED);
        }
        expect(await attempt(db, U.agencyOwner, `insert into public.ai_provider_connections (agency_id, provider_code, display_name, authentication_method, credential_reference, connection_status)
            values ($1, 'anthropic', 'forged', 'platform_secret', 'ANTHROPIC_API_KEY', 'connected')`, [AGENCY])).toBe(DENIED);
    });

    it('saving is never "connected": only a server test sets it; rotation and re-enabling require a new test', async () => {
        const status = async () => (await svc(`select connection_status as s, last_tested_at as t from public.ai_provider_connections where id = '${AI.podOpenai}'`))[0] as { s: string; t: unknown };
        expect((await status()).s).toBe('configured');
        await svc(`update public.ai_provider_connections set connection_status = 'connected', last_tested_at = now(), verified_models = '{m1}' where id = '${AI.podOpenai}'`);
        expect((await status()).s).toBe('connected');

        await as(db, U.agencyOwner, `update public.ai_provider_connections set credential_reference = 'OPENAI_API_KEY_ROTATED' where id = '${AI.podOpenai}'`);
        expect(await status()).toEqual({ s: 'configured', t: null });

        await svc(`update public.ai_provider_connections set connection_status = 'connected', last_tested_at = now() where id = '${AI.podOpenai}'`);
        await as(db, U.agencyOwner, `update public.ai_provider_connections set enabled = false where id = '${AI.podOpenai}'`);
        expect((await status()).s).toBe('disabled');
        await as(db, U.agencyOwner, `update public.ai_provider_connections set enabled = true where id = '${AI.podOpenai}'`);
        expect(await status()).toEqual({ s: 'configured', t: null });

        // Renaming or changing budgets does not discard a verification.
        await svc(`update public.ai_provider_connections set connection_status = 'connected', last_tested_at = now() where id = '${AI.podOpenai}'`);
        await as(db, U.agencyOwner, `update public.ai_provider_connections set display_name = 'POD OpenAI (renamed)', monthly_budget_usd = 10 where id = '${AI.podOpenai}'`);
        expect((await status()).s).toBe('connected');
    });

    it('brand admins, members and outsiders cannot edit, rotate or remove connections', async () => {
        for (const u of [U.podOwner, U.podAdmin, U.podManager, U.dmdManager, U.otherOwner]) {
            const rows = await as(db, u, `update public.ai_provider_connections set credential_reference = 'OPENAI_API_KEY_X' where id = '${AI.podOpenai}' returning 1`);
            expect(rows, u.email).toHaveLength(0);
            expect(await as(db, u, `delete from public.ai_provider_connections where id = '${AI.podOpenai}' returning 1`), u.email).toHaveLength(0);
        }
    });
});

describe('visibility and brand isolation', () => {
    it('brand admins see agency-wide and their brand connections only; staff below admin see none', async () => {
        const podAdminSees = await ids(U.podAdmin, 'ai_provider_connections', `display_name not like 'new-%' and display_name not like 't-%'`);
        expect(podAdminSees).toEqual([AI.agencyAnthropic, AI.podOpenai, AI.agencySim].sort());
        for (const u of [U.podManager, U.podMember, U.podViewer, U.podClient, U.dmdManager, U.stranger, U.deactivated]) {
            expect(await ids(u, 'ai_provider_connections'), u.email).toEqual([]);
        }
        expect(await ids(U.otherOwner, 'ai_provider_connections')).toEqual([AI.zedAnthropic]);
        expect(await ids(U.agencyOwner, 'ai_provider_connections', `id = '${AI.zedAnthropic}'`)).toEqual([]);
    });

    it('assignments: staff of the brand read them (with provider), clients and other brands do not', async () => {
        const rows = await as<{ provider_code: string }>(db, U.podMember, `select provider_code from public.ai_agent_model_assignments`);
        expect(rows).toEqual([{ provider_code: 'anthropic' }]);
        expect(await ids(U.podClient, 'ai_agent_model_assignments')).toEqual([]);
        expect(await ids(U.dmdManager, 'ai_agent_model_assignments')).toEqual([AI.dmdAssign]);
    });

    it('usage: admins see the brand, staff see only their own requests, other brands see nothing', async () => {
        expect(await ids(U.podAdmin, 'ai_usage_events')).toEqual([AI.podUsageMember, AI.podUsageManager].sort());
        expect(await ids(U.podMember, 'ai_usage_events')).toEqual([AI.podUsageMember]);
        expect(await ids(U.podViewer, 'ai_usage_events')).toEqual([]);
        expect(await ids(U.podClient, 'ai_usage_events')).toEqual([]);
        expect(await ids(U.dmdManager, 'ai_usage_events')).toEqual([AI.dmdUsage]);
        expect(await ids(U.agencyOwner, 'ai_usage_events', `brand_id = '${B.zed}'`)).toEqual([]);
    });

    it('usage, health checks and audit events are server-written and immutable for users', async () => {
        for (const u of [U.agencyOwner, U.podOwner, U.podMember]) {
            expect(await attempt(db, u, `insert into public.ai_usage_events (agency_id, brand_id, provider_code, model_id, execution_status)
                values ($1, $2, 'anthropic', 'm', 'succeeded')`, [AGENCY, B.pod]), u.email).toBe(DENIED);
            expect(await attempt(db, u, `update public.ai_usage_events set input_tokens = 0`), u.email).toBe(DENIED);
            expect(await attempt(db, u, `delete from public.ai_usage_events`), u.email).toBe(DENIED);
            expect(await attempt(db, u, `insert into public.ai_provider_health_checks (agency_id, connection_id, result) values ($1, $2, 'success')`, [AGENCY, AI.agencyAnthropic]), u.email).toBe(DENIED);
            expect(await attempt(db, u, `insert into public.ai_audit_events (agency_id, action, subject_type) values ($1, 'x', 'y')`, [AGENCY]), u.email).toBe(DENIED);
            expect(await attempt(db, u, `delete from public.ai_audit_events`), u.email).toBe(DENIED);
        }
    });

    it('anon has no access to any AI table', async () => {
        for (const t of AI_TABLES) expect(await attempt(db, 'anon', `select 1 from public.${t} limit 1`), t).toBe(DENIED);
    });
});

describe('agent model assignment (provider switching)', () => {
    const assign = (u: TestUser, conn: string, extra = '') => attempt(db, u,
        `update public.ai_agent_model_assignments set connection_id = '${conn}', model_id = 'synthetic-model-3' ${extra} where id = '${AI.podAssign}' returning 1`);

    it('a brand admin switches an agent between connections available to the brand, without touching history', async () => {
        const before = (await svc(`select count(*)::int as n from public.agent_executions where agent_instance_id = '${X.podAgent}'`))[0];
        expect(await assign(U.podAdmin, AI.podOpenai)).toBe('ok');
        const row = (await svc(`select provider_code, model_id from public.ai_agent_model_assignments where id = '${AI.podAssign}'`))[0];
        expect(row).toEqual({ provider_code: 'openai', model_id: 'synthetic-model-3' });
        expect((await svc(`select count(*)::int as n from public.agent_executions where agent_instance_id = '${X.podAgent}'`))[0]).toEqual(before);
        expect(await assign(U.podAdmin, AI.agencyAnthropic)).toBe('ok');
    });

    it('cannot assign another brand’s or another agency’s connection, or move the row to another agent/brand', async () => {
        expect(await assign(U.podAdmin, AI.dmdOpenai)).toBe(DENIED);
        expect(await assign(U.podAdmin, AI.zedAnthropic)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `update public.ai_agent_model_assignments set agent_instance_id = '${X.dmdAgent}' where id = '${AI.podAssign}'`)).toBe(DENIED);
        expect(await attempt(db, U.agencyOwner, `insert into public.ai_agent_model_assignments (brand_id, agent_instance_id, connection_id, model_id)
            values ($1, $2, $3, 'm')`, [B.pod, X.dmdAgent, AI.agencyAnthropic])).toBe(DENIED);
        // provider_code is derived, never user-supplied.
        expect(await attempt(db, U.podAdmin, `update public.ai_agent_model_assignments set provider_code = 'openai' where id = '${AI.podAssign}'`)).toBe(DENIED);
    });

    it('managers and below cannot change assignments', async () => {
        for (const u of [U.podManager, U.podMember, U.podViewer, U.podClient, U.dmdManager]) {
            expect(await as(db, u, `update public.ai_agent_model_assignments set model_id = 'x' where id = '${AI.podAssign}' returning 1`), u.email).toHaveLength(0);
        }
    });

    it('cross-provider fallback needs both organization and brand consent', async () => {
        const fallback = `, fallback_policy = 'secondary_provider', fallback_connection_id = '${AI.podOpenai}', fallback_model_id = 'synthetic-model-2'`;
        expect(await assign(U.podAdmin, AI.agencyAnthropic, fallback)).toBe(DENIED);
        await as(db, U.podAdmin, `update public.ai_routing_policies set allow_cross_provider_fallback = true where id = '${AI.podPolicy}'`);
        expect(await assign(U.podAdmin, AI.agencyAnthropic, fallback)).toBe(DENIED); // brand alone is not enough
        // Brand admins cannot grant organization consent.
        expect(await as(db, U.podAdmin, `update public.ai_routing_policies set allow_cross_provider_fallback = true where id = '${AI.orgPolicy}' returning 1`)).toHaveLength(0);
        await as(db, U.agencyOwner, `update public.ai_routing_policies set allow_cross_provider_fallback = true where id = '${AI.orgPolicy}'`);
        expect(await assign(U.podAdmin, AI.agencyAnthropic, fallback)).toBe('ok');
        // A secondary policy without a fallback model is rejected by the schema.
        expect(await assign(U.podAdmin, AI.agencyAnthropic, `, fallback_policy = 'secondary_model', fallback_model_id = null, fallback_connection_id = null`)).toBe(CHECK);
    });
});

describe('routing policies and model catalog', () => {
    it('organization default must be an agency-wide connection; brand defaults must be in scope', async () => {
        expect(await attempt(db, U.agencyOwner, `update public.ai_routing_policies set default_connection_id = '${AI.podOpenai}' where id = '${AI.orgPolicy}'`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `update public.ai_routing_policies set default_connection_id = '${AI.dmdOpenai}' where id = '${AI.podPolicy}'`)).toBe(DENIED);
        expect(await attempt(db, U.podAdmin, `update public.ai_routing_policies set default_connection_id = '${AI.agencyAnthropic}' where id = '${AI.podPolicy}'`)).toBe('ok');
    });

    it('prices are fully sourced or absent; brand staff read the catalog; only agency staff curate it', async () => {
        expect(await attempt(db, U.agencyOwner, `update public.ai_provider_models set input_usd_per_mtok = 1, output_usd_per_mtok = 2 where id = '${AI.model}'`)).toBe(CHECK);
        expect(await attempt(db, U.agencyOwner, `update public.ai_provider_models set input_usd_per_mtok = 1, output_usd_per_mtok = 2,
            pricing_source = 'owner-entered from provider price page', pricing_verified_at = now() where id = '${AI.model}'`)).toBe('ok');
        expect(await ids(U.podMember, 'ai_provider_models')).toEqual([AI.model]);
        expect(await ids(U.podClient, 'ai_provider_models')).toEqual([]);
        expect(await ids(U.otherOwner, 'ai_provider_models')).toEqual([]);
        expect(await attempt(db, U.podAdmin, `insert into public.ai_provider_models (agency_id, provider_code, provider_model_id, display_name, source)
            values ($1, 'openai', 'x', 'x', 'admin')`, [AGENCY])).toBe(DENIED);
    });
});

describe('audit trail', () => {
    it('records who changed which columns, never the values', async () => {
        const rows = await as<{ action: string; changed_columns: string[]; actor_id: string }>(db, U.agencyOwner,
            `select action, changed_columns, actor_id from public.ai_audit_events
             where subject_id = '${AI.podOpenai}' and action = 'update' and actor_id is not null order by created_at`);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((r) => r.changed_columns.includes('credential_reference'))).toBe(true);
        expect(rows.every((r) => r.actor_id === U.agencyOwner.id)).toBe(true);
        const text = JSON.stringify(await svc(`select * from public.ai_audit_events`));
        expect(text).not.toContain('OPENAI_API_KEY_ROTATED');
        // Brand admins see audit for their scope only.
        expect(await as(db, U.dmdManager, `select 1 from public.ai_audit_events`)).toHaveLength(0);
    });
});
