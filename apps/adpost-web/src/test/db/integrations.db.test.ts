// @vitest-environment node
/**
 * Migration 0010 (website integrations) on real Postgres (PGlite) with the dev seed.
 * Synthetic users; the "live" websites use reserved-looking but non-.example test hosts and are
 * never contacted (these are database tests only).
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
    superAdmin: user(4001, 'super@platform.example.test'),
    vcaAdmin: user(4002, 'admin@vca.example.test'),
    adpostAdmin: user(4003, 'admin@adpost.example.test'),
    lipskyClient: user(4004, 'client@lipsky.example.test'),
    lipskyStaff: user(4005, 'staff@lipsky.example.test'),
    cmsClient: user(4006, 'client@cms.example.test'),
};
const W = { lipsky: id(4100), cms: id(4101) };
const I = { lipskyWp: id(4200), cmsWp: id(4201) };
let db: PGlite;
let C: Record<string, string>;
let lipskyDemo: string;
const count = async (who: TestUser, table: string) => (await as<{ n: number }>(db, who, `select count(*)::int as n from public.${table}`))[0]!.n;

beforeAll(async () => {
    db = await createDb();
    await db.exec(`set app.allow_dev_seed = 'on';\n${SEED_SQL}\nreset app.allow_dev_seed;`);
    const A = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.agencies')).rows.map((r) => [r.slug, r.id]));
    C = Object.fromEntries((await db.query<{ slug: string; id: string }>('select slug, id from public.brands')).rows.map((r) => [r.slug, r.id]));
    lipskyDemo = (await db.query<{ id: string }>(`select id from public.websites where brand_id = '${C.lipsky}' and is_demo limit 1`)).rows[0]!.id;
    await db.exec(`
        set role supabase_auth_admin;
        insert into auth.users (id, email, email_confirmed_at) values ${Object.values(U).map((u) => `('${u.id}', '${u.email}', now())`).join(', ')};
        reset role;
        insert into public.platform_admins (user_id) values ('${U.superAdmin.id}');
        insert into public.agency_memberships (agency_id, user_id, role) values ('${A.vca}', '${U.vcaAdmin.id}', 'agency_admin'), ('${A.adpost}', '${U.adpostAdmin.id}', 'agency_admin');
        insert into public.brand_memberships (brand_id, user_id, role, permissions) values
            ('${C.lipsky}', '${U.lipskyClient.id}', 'client', '{}'), ('${C.lipsky}', '${U.lipskyStaff.id}', 'member', '{}'), ('${C.cms}', '${U.cmsClient.id}', 'client', '{}');
        insert into public.websites (id, brand_id, name, website_url, environment, platform, status, is_primary, is_demo) values
            ('${W.lipsky}', '${C.lipsky}', 'LIPSKY live', 'https://lipsky-live-site.com', 'production', 'wordpress', 'active', false, false),
            ('${W.cms}', '${C.cms}', 'CMS live', 'https://cms-live-site.com', 'production', 'wordpress', 'active', false, false);
        -- brand_id deliberately wrong for the LIPSKY row: the scope trigger must correct it from the website.
        insert into public.integrations (id, brand_id, website_id, provider, status, auth_method, label) values
            ('${I.lipskyWp}', '${C.pod}', '${W.lipsky}', 'wordpress', 'not_connected', 'application_password', 'LIPSKY WordPress'),
            ('${I.cmsWp}', '${C.cms}', '${W.cms}', 'wordpress', 'not_connected', 'none', 'CMS WordPress');
        insert into public.integration_secrets (integration_id, brand_id, encrypted_credentials) values ('${I.lipskyWp}', '${C.lipsky}', 'v1.iv.ciphertext');
        insert into public.wp_content_items (integration_id, brand_id, website_id, content_type, external_id, url, title, fingerprint) values
            ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'page', 10, 'https://lipsky-live-site.com/about/', 'About', 'f1'),
            ('${I.cmsWp}', '${C.cms}', '${W.cms}', 'page', 10, 'https://cms-live-site.com/about/', 'About CMS', 'f2');
        insert into public.seo_findings (brand_id, website_id, source, check_id, kind, severity, confidence, title, evidence, recommendation, observed_at, fingerprint) values
            ('${C.lipsky}', '${W.lipsky}', 'crawler', 'title_missing', 'observed', 'high', 1, 'Missing title', '{"url":"https://lipsky-live-site.com/x"}', 'Add a title.', now(), 'fp1'),
            ('${C.cms}', '${W.cms}', 'crawler', 'title_missing', 'observed', 'high', 1, 'Missing title', '{}', 'Add a title.', now(), 'fp2');
    `);
}, 120_000);
afterAll(async () => db?.close());

describe('migration 0010: website integrations', () => {
    it('derives brand and client from the website (scope cannot be supplied independently)', async () => {
        const r = await db.query<{ brand_id: string }>(`select brand_id from public.integrations where id = '${I.lipskyWp}'`);
        expect(r.rows[0]!.brand_id).toBe(C.lipsky);
    });

    it('cross-agency and cross-client: each user sees only their own clients’ integration data', async () => {
        expect(await count(U.vcaAdmin, 'wp_content_items')).toBe(2); // VCA owns LIPSKY and CMS
        expect(await count(U.adpostAdmin, 'wp_content_items')).toBe(0);
        expect(await count(U.adpostAdmin, 'integrations')).toBe(0);
        expect(await count(U.lipskyClient, 'wp_content_items')).toBe(1);
        expect(await count(U.lipskyClient, 'seo_findings')).toBe(1);
        expect(await count(U.cmsClient, 'seo_findings')).toBe(1);
        expect((await as<{ title: string }>(db, U.cmsClient, 'select title from public.wp_content_items'))[0]!.title).toBe('About CMS');
        expect(await count(U.superAdmin, 'wp_content_items')).toBe(2);
    });

    it('nobody reads credentials or OAuth state through the API — not Client Users, Admins or Super Admins', async () => {
        for (const u of [U.lipskyClient, U.vcaAdmin, U.superAdmin]) {
            expect(await attempt(db, u, 'select * from public.integration_secrets'), u.email).toBe(DENIED);
            expect(await attempt(db, u, 'select * from public.integration_oauth_states'), u.email).toBe(DENIED);
        }
        expect(await as(db, 'service_role', 'select integration_id from public.integration_secrets')).toHaveLength(1);
    });

    it('app users cannot write integration data directly, whatever ids they send', async () => {
        for (const u of [U.lipskyClient, U.vcaAdmin, U.superAdmin]) {
            expect(await attempt(db, u, `insert into public.wp_content_items (integration_id, brand_id, website_id, content_type, external_id, url, fingerprint) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'post', 99, 'https://x.com/', 'z')`), u.email).toBe(DENIED);
            expect(await attempt(db, u, `update public.integrations set status = 'connected', verified_at = now() where id = '${I.lipskyWp}'`), u.email).toBe(DENIED);
            expect(await attempt(db, u, `insert into public.seo_findings (brand_id, website_id, source, check_id, kind, severity, confidence, title, evidence, recommendation, observed_at, fingerprint) values ('${C.lipsky}', '${W.lipsky}', 'gsc', 'x', 'observed', 'low', 1, 't', '{}', 'r', now(), 'fp9')`), u.email).toBe(DENIED);
            expect(await attempt(db, u, `insert into public.ga4_metric_rows (integration_id, brand_id, website_id, property_id, metric_date, dimension, sessions) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'properties/1', current_date, 'total', 5)`), u.email).toBe(DENIED);
        }
    });

    it('integration_permissions: view/sync/manage by role', async () => {
        const perms = async (u: TestUser, w = W.lipsky) => (await as<{ p: Record<string, boolean> }>(db, u, `select public.integration_permissions('${w}') as p`))[0]!.p;
        expect(await perms(U.lipskyClient)).toEqual({ can_view: true, can_sync: false, can_manage: false });
        expect(await perms(U.lipskyStaff)).toMatchObject({ can_view: true, can_manage: false });
        expect(await perms(U.vcaAdmin)).toEqual({ can_view: true, can_sync: true, can_manage: true });
        expect(await perms(U.superAdmin)).toEqual({ can_view: true, can_sync: true, can_manage: true });
        expect(await perms(U.adpostAdmin)).toEqual({ can_view: false, can_sync: false, can_manage: false });
        expect(await perms(U.lipskyClient, W.cms)).toEqual({ can_view: false, can_sync: false, can_manage: false });
    });

    it('demo websites never get live integrations; "connected" needs a verification time', async () => {
        await expect(db.exec(`insert into public.integrations (brand_id, website_id, provider) values ('${C.lipsky}', '${lipskyDemo}', 'wordpress')`)).rejects.toMatchObject({ code: '23514' });
        await expect(db.exec(`update public.integrations set status = 'connected' where id = '${I.cmsWp}'`)).rejects.toMatchObject({ code: '23514' });
        await db.exec(`update public.integrations set status = 'connected', verified_at = now() where id = '${I.cmsWp}'`);
    });

    it('duplicate prevention: one row per WordPress id, metric key and running sync', async () => {
        await expect(db.exec(`insert into public.wp_content_items (integration_id, brand_id, website_id, content_type, external_id, url, fingerprint) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'page', 10, 'https://lipsky-live-site.com/about/', 'f1')`)).rejects.toMatchObject({ code: '23505' });
        await db.exec(`insert into public.gsc_metric_rows (integration_id, brand_id, website_id, site_url, metric_date, dimension, dimension_value, clicks, impressions, ctr, position) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'sc-domain:lipsky-live-site.com', '2026-11-01', 'query', 'lipsky law', 3, 100, 0.03, 8.2)`);
        await expect(db.exec(`insert into public.gsc_metric_rows (integration_id, brand_id, website_id, site_url, metric_date, dimension, dimension_value, clicks, impressions, ctr, position) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'sc-domain:lipsky-live-site.com', '2026-11-01', 'query', 'lipsky law', 4, 101, 0.04, 8.1)`)).rejects.toMatchObject({ code: '23505' });
        await db.exec(`insert into public.integration_sync_runs (integration_id, brand_id, website_id, provider, kind) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'wordpress', 'pages')`);
        await expect(db.exec(`insert into public.integration_sync_runs (integration_id, brand_id, website_id, provider, kind) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'wordpress', 'pages')`)).rejects.toMatchObject({ code: '23505' });
    });

    it('access helpers never return NULL (PL/pgSQL "if not NULL" would silently allow)', async () => {
        const A = (await db.query<{ id: string }>(`select id from public.agencies where slug = 'vca'`)).rows[0]!.id;
        const b = C.lipsky;
        const checks = [
            'app.is_platform_admin()', 'app.is_active_user()', `app.is_agency_admin('${b}')`, `app.is_agency_manager('${b}')`, `app.is_brand_staff('${b}')`,
            `app.can_read_brand('${b}')`, `app.can_write_brand('${b}')`, `app.can_admin_brand('${b}')`, `app.can_manage_owners('${b}')`,
            `app.can_read_client_row('${b}', null)`, `app.is_agency_admin_for_agency('${A}')`, `app.is_agency_staff_for_agency('${A}')`,
            `app.client_permission('${b}', 'ai_chat')`, `app.agency_open('${A}')`, `app.brand_agency_open('${b}')`,
            `app.ai_connection_in_scope('${id(4999)}', '${b}')`,
        ];
        const stranger: TestUser = { id: id(4998), email: 'nobody@example.test' };
        for (const u of [U.adpostAdmin, U.cmsClient, U.lipskyClient, U.vcaAdmin, stranger]) {
            const r = (await as<Record<string, boolean | null>>(db, u, `select ${checks.map((c, i) => `${c} as c${i}`).join(', ')}`))[0]!;
            const nulls = checks.filter((_, i) => r[`c${i}`] === null);
            expect(nulls, u.email).toEqual([]);
        }
    });

    it('GA4 property ids and GSC site urls are validated', async () => {
        await expect(db.exec(`insert into public.ga4_metric_rows (integration_id, brand_id, website_id, property_id, metric_date, dimension) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'UA-123', current_date, 'total')`)).rejects.toMatchObject({ code: '23514' });
        await expect(db.exec(`insert into public.gsc_metric_rows (integration_id, brand_id, website_id, site_url, metric_date, dimension, clicks, impressions, ctr, position) values ('${I.lipskyWp}', '${C.lipsky}', '${W.lipsky}', 'javascript:alert(1)', current_date, 'total', 0, 0, 0, 0)`)).rejects.toMatchObject({ code: '23514' });
    });
});
