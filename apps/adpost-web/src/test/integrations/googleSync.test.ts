// @vitest-environment node
/** Google OAuth → property → sync flow with an in-memory repository and a fake Google. */
import { completeGoogleAuthorization, listGoogleProperties, selectGoogleProperty, startGoogleAuthorization, syncGoogleAnalytics, syncSearchConsole, type GoogleRepository } from '../../../../../supabase/functions/_shared/integrations/googleSync.ts';
import type { IntegrationPermissions, IntegrationRow } from '../../../../../supabase/functions/_shared/integrations/sync.ts';
import { IntegrationError, type WebsiteRef } from '../../../../../supabase/functions/_shared/integrations/types.ts';

const SITE: WebsiteRef = { id: 'web-1', brandId: 'brand-1', clientId: null, websiteUrl: 'https://lugenixdigitalservices.com/', isDemo: false };
const OAUTH = { clientId: 'cid', clientSecret: 'server-secret', redirectUri: 'https://ppwkxlwxzutigepaizob.supabase.co/functions/v1/integration-oauth' };
const NOW = new Date('2026-11-13T18:00:00Z');

function repo(perms: IntegrationPermissions = { can_view: true, can_sync: true, can_manage: true }) {
    const integrations: Array<IntegrationRow & { externalPropertyId: string | null; config: Record<string, unknown> }> = [];
    const states: Array<{ id: string; stateHash: string; provider: 'google_analytics' | 'google_search_console'; userId: string; websiteId: string; redirectUri: string; expiresAt: string; consumedAt: string | null; encryptedVerifier: string }> = [];
    const secrets = new Map<string, unknown>();
    const ga4 = new Map<string, unknown>();
    const gsc = new Map<string, unknown>();
    const findings = new Map<string, unknown>();
    const runs: Array<{ id: string; status: string; kind: string; errorCategory?: string | null }> = [];
    const audits: Array<{ action: string; websiteId: string; details: Record<string, string> }> = [];
    /** Integrations of other websites (other clients), to test that a property feeds one website only. */
    const elsewhere: Array<{ provider: string; propertyId: string; websiteId: string; brandId: string }> = [];
    let seq = 0;
    const r: GoogleRepository = {
        permissions: async () => perms,
        website: async (id) => (id === SITE.id ? SITE : null),
        integration: async (w, p) => integrations.find((i) => i.websiteId === w && i.provider === p) ?? null,
        ensureIntegration: async (w, provider, authMethod) => { const row = { id: `int-${++seq}`, websiteId: w.id, provider, status: 'not_connected' as const, authMethod, credentialConfigured: false, enabled: true, externalPropertyId: null, config: {} }; integrations.push(row); return row; },
        updateIntegration: async (id, patch) => {
            const row = integrations.find((i) => i.id === id)!;
            if (patch.status) row.status = patch.status;
            if (patch.credentialConfigured !== undefined) row.credentialConfigured = patch.credentialConfigured;
            if (patch.externalPropertyId !== undefined) row.externalPropertyId = patch.externalPropertyId;
            if (patch.config) row.config = patch.config;
        },
        startRun: async (_i, _w, kind) => { const id = `run-${++seq}`; runs.push({ id, status: 'running', kind }); return id; },
        finishRun: async (id, x) => { Object.assign(runs.find((y) => y.id === id)!, { status: x.status, errorCategory: x.errorCategory }); },
        readSecret: async (id) => (secrets.get(id) as never) ?? null,
        writeSecret: async (id, _w, v) => { secrets.set(id, v); },
        deleteSecret: async (id) => { secrets.delete(id); },
        upsertWpItems: async () => 0, markWpItemsRemoved: async () => 0, saveCrawl: async () => 'job', resolveUnseenFindings: async () => 0,
        upsertFindings: async (_w, _s, list) => { let n = 0; for (const f of list) { if (!findings.has(f.fingerprint)) n++; findings.set(f.fingerprint, f); } return n; },
        saveOAuthState: async (s) => { states.push({ ...s, id: `st-${++seq}` }); },
        loadOAuthState: async (h) => states.find((s) => s.stateHash === h) ?? null,
        consumeOAuthState: async (id) => { const s = states.find((x) => x.id === id)!; if (s.consumedAt) return false; s.consumedAt = NOW.toISOString(); return true; },
        encrypt: async (_scope, v) => `enc:${JSON.stringify(v)}`,
        decrypt: async (_scope, blob) => JSON.parse(blob.slice(4)),
        upsertGa4Rows: async (_i, _w, p, rows) => { for (const x of rows) ga4.set(`${p}|${x.date}|${x.dimension}|${x.dimensionValue}`, x); return rows.length; },
        upsertGscRows: async (_i, _w, s, rows) => { for (const x of rows) gsc.set(`${s}|${x.date}|${x.dimension}|${x.dimensionValue}`, x); return rows.length; },
        integrationConfig: async (id) => { const i = integrations.find((x) => x.id === id)!; return { externalPropertyId: i.externalPropertyId, config: i.config }; },
        propertyAssignments: async (provider, propertyId, except) => [
            ...integrations.filter((i) => i.id !== except && i.provider === provider && i.externalPropertyId === propertyId).map((i) => ({ websiteId: i.websiteId, brandId: SITE.brandId })),
            ...elsewhere.filter((e) => e.provider === provider && e.propertyId === propertyId).map(({ websiteId, brandId }) => ({ websiteId, brandId })),
        ],
        audit: async (w, _u, action, details) => { audits.push({ action, websiteId: w.id, details }); },
    };
    return { r, integrations, states, secrets, ga4, gsc, findings, runs, audits, elsewhere };
}

function google() {
    const calls: string[] = [];
    const f = (async (input: string, init: RequestInit = {}) => {
        const u = new URL(input);
        calls.push(`${u.hostname}${u.pathname}`);
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
        if (u.hostname === 'oauth2.googleapis.com') {
            const body = new URLSearchParams(String(init.body));
            if (body.get('grant_type') === 'authorization_code') return json({ access_token: 'at', refresh_token: 'rt-secret', expires_in: 3600, scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly' });
            return json({ access_token: 'at2', expires_in: 3600 });
        }
        if (u.pathname.endsWith('/accountSummaries')) return json({ accountSummaries: [{ account: 'accounts/1', displayName: 'Lugenix', propertySummaries: [{ property: 'properties/111', displayName: 'Lugenix site' }] }] });
        if (u.pathname.endsWith(':runReport')) {
            const b = JSON.parse(String(init.body));
            const dim = b.dimensions[1]?.name;
            return json({ metricHeaders: b.metrics, rows: [{ dimensionValues: [{ value: '20261110' }, ...(dim ? [{ value: 'x' }] : [])], metricValues: b.metrics.map(() => ({ value: '3' })) }], rowCount: 1, metadata: { timeZone: 'America/New_York' } });
        }
        if (u.pathname === '/webmasters/v3/sites') return json({ siteEntry: [{ siteUrl: 'sc-domain:lugenixdigitalservices.com', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.com/', permissionLevel: 'siteOwner' }] });
        if (u.pathname.endsWith('/searchAnalytics/query')) {
            const b = JSON.parse(String(init.body));
            const dim = b.dimensions[1];
            if (dim !== 'query') return json({ rows: [] });
            return json({ rows: [{ keys: ['2026-11-10', 'wordpress seo agency'], clicks: 1, impressions: 500, ctr: 0.002, position: 5 }, { keys: ['2026-10-10', 'dental marketing'], clicks: 40, impressions: 300, ctr: 0.13, position: 4 }], metadata: { first_incomplete_date: '2026-11-11' } });
        }
        return json({ error: { status: 'NOT_FOUND' } }, 404);
    }) as unknown as typeof fetch;
    return { fetch: f, calls };
}

const ctxFor = (m: ReturnType<typeof repo>, g = google(), userId = 'admin-1') => ({ userId, http: { fetch: g.fetch, resolve: async () => ['93.184.215.14'] }, repo: m.r, oauth: OAUTH, now: () => NOW });

describe('Google integration flow', () => {
    it('OAuth: start → callback → choose property → connected only after verification', async () => {
        const m = repo();
        const ctx = ctxFor(m);
        const { authorizationUrl } = await startGoogleAuthorization(ctx, 'web-1', 'google_analytics');
        const state = new URL(authorizationUrl).searchParams.get('state')!;
        expect(m.integrations[0]!.status).toBe('pending_authorization');
        expect(m.states[0]!.stateHash).not.toBe(state); // only the hash is stored
        expect(m.states[0]!.encryptedVerifier).toMatch(/^enc:/);
        expect(await completeGoogleAuthorization(ctx, { state, code: 'auth-code' })).toMatchObject({ next: 'select_property' });
        expect(m.integrations[0]).toMatchObject({ status: 'pending_authorization', credentialConfigured: true });
        expect(m.secrets.get('int-1')).toMatchObject({ refreshToken: 'rt-secret' });
        await expect(completeGoogleAuthorization(ctx, { state, code: 'auth-code' })).rejects.toThrow(/already used/);
        expect((await listGoogleProperties(ctx, 'web-1', 'google_analytics')).properties).toEqual([{ id: 'properties/111', name: 'Lugenix site', account: 'Lugenix', coversWebsite: null }]);
        await expect(selectGoogleProperty(ctx, 'web-1', 'google_analytics', 'properties/999')).rejects.toMatchObject({ category: 'permission_denied' });
        expect(await selectGoogleProperty(ctx, 'web-1', 'google_analytics', 'properties/111')).toMatchObject({ status: 'connected' });
    });

    it('audits authorization and property selection, without tokens or codes', async () => {
        const m = repo();
        const ctx = ctxFor(m);
        const { authorizationUrl } = await startGoogleAuthorization(ctx, 'web-1', 'google_analytics');
        await completeGoogleAuthorization(ctx, { state: new URL(authorizationUrl).searchParams.get('state')!, code: 'auth-code' });
        await selectGoogleProperty(ctx, 'web-1', 'google_analytics', 'properties/111');
        expect(m.audits.map((a) => [a.action, a.websiteId])).toEqual([['integration.authorized', 'web-1'], ['integration.property_selected', 'web-1']]);
        expect(m.audits[1]!.details).toEqual({ provider: 'google_analytics', propertyId: 'properties/111' });
        const logged = JSON.stringify(m.audits);
        for (const secret of ['rt-secret', 'auth-code', '"at"', 'server-secret']) expect(logged).not.toContain(secret);
    });

    it('a property already feeding another client’s website is refused (ADPOST and POD never share data)', async () => {
        const m = repo();
        const g = google();
        const ctx = ctxFor(m, g);
        m.elsewhere.push({ provider: 'google_analytics', propertyId: 'properties/111', websiteId: 'web-pod', brandId: 'brand-pod' });
        const { authorizationUrl } = await startGoogleAuthorization(ctx, 'web-1', 'google_analytics');
        await completeGoogleAuthorization(ctx, { state: new URL(authorizationUrl).searchParams.get('state')!, code: 'auth-code' });
        const before = g.calls.length;
        await expect(selectGoogleProperty(ctx, 'web-1', 'google_analytics', 'properties/111')).rejects.toMatchObject({ category: 'permission_denied', message: expect.stringContaining('another client') });
        expect(g.calls.length).toBe(before); // refused before any Google request
        expect(m.integrations[0]).toMatchObject({ status: 'pending_authorization', externalPropertyId: null });
        expect(m.audits.map((a) => a.action)).not.toContain('integration.property_selected');
        // Search Console is a separate assignment: the same website may still connect its own GSC property.
        const gsc = await startGoogleAuthorization(ctx, 'web-1', 'google_search_console');
        await completeGoogleAuthorization(ctx, { state: new URL(gsc.authorizationUrl).searchParams.get('state')!, code: 'auth-code-2' });
        expect(await selectGoogleProperty(ctx, 'web-1', 'google_search_console', 'sc-domain:lugenixdigitalservices.com')).toMatchObject({ status: 'connected' });
    });

    it('a different user cannot complete someone else’s authorization', async () => {
        const m = repo();
        const { authorizationUrl } = await startGoogleAuthorization(ctxFor(m), 'web-1', 'google_search_console');
        const state = new URL(authorizationUrl).searchParams.get('state')!;
        await expect(completeGoogleAuthorization(ctxFor(m, google(), 'someone-else'), { state, code: 'c' })).rejects.toMatchObject({ category: 'permission_denied' });
        expect(m.secrets.size).toBe(0);
    });

    it('non-admins cannot start OAuth; viewers cannot sync', async () => {
        const g = google();
        await expect(startGoogleAuthorization(ctxFor(repo({ can_view: true, can_sync: true, can_manage: false }), g), 'web-1', 'google_analytics')).rejects.toBeInstanceOf(IntegrationError);
        await expect(syncGoogleAnalytics(ctxFor(repo({ can_view: true, can_sync: false, can_manage: false }), g), 'web-1')).rejects.toMatchObject({ category: 'permission_denied' });
        expect(g.calls).toHaveLength(0);
    });

    it('syncs GA4 for both periods across dimensions, records the property time zone', async () => {
        const m = repo();
        const ctx = ctxFor(m);
        const st = new URL((await startGoogleAuthorization(ctx, 'web-1', 'google_analytics')).authorizationUrl).searchParams.get('state')!;
        await completeGoogleAuthorization(ctx, { state: st, code: 'c' });
        await selectGoogleProperty(ctx, 'web-1', 'google_analytics', 'properties/111');
        const r = await syncGoogleAnalytics(ctx, 'web-1', 'last_7_days');
        expect(r).toMatchObject({ propertyId: 'properties/111', current: { from: '2026-11-06', to: '2026-11-12' }, timeZone: 'America/New_York' });
        expect(m.ga4.size).toBe(6); // one fake row per dimension
        expect(m.integrations[0]!.config.timeZone).toBe('America/New_York');
        expect(m.runs.at(-1)).toMatchObject({ kind: 'ga4', status: 'succeeded' });
    });

    it('Search Console: property must cover the website; sync stores rows and evidence-backed opportunities', async () => {
        const m = repo();
        const ctx = ctxFor(m);
        const st = new URL((await startGoogleAuthorization(ctx, 'web-1', 'google_search_console')).authorizationUrl).searchParams.get('state')!;
        await completeGoogleAuthorization(ctx, { state: st, code: 'c' });
        const props = (await listGoogleProperties(ctx, 'web-1', 'google_search_console')).properties;
        expect(props.map((p) => [p.id, p.coversWebsite])).toEqual([['sc-domain:lugenixdigitalservices.com', true], ['https://other.com/', false]]);
        await expect(selectGoogleProperty(ctx, 'web-1', 'google_search_console', 'https://other.com/')).rejects.toMatchObject({ category: 'site_mismatch' });
        await selectGoogleProperty(ctx, 'web-1', 'google_search_console', 'sc-domain:lugenixdigitalservices.com');
        const r = await syncSearchConsole(ctx, 'web-1', 'last_28_days');
        expect(r).toMatchObject({ rows: 2, firstIncompleteDate: '2026-11-11' });
        const f = [...m.findings.values()] as Array<{ checkId: string; evidence: Record<string, unknown> }>;
        expect(f.map((x) => x.checkId)).toEqual(expect.arrayContaining(['gsc_low_ctr', 'gsc_query_clicks_drop']));
        expect(f[0]!.evidence).toMatchObject({ property: 'sc-domain:lugenixdigitalservices.com', currentRange: r.current });
        // repeated sync: same fingerprints, no duplicate findings
        const before = m.findings.size;
        await syncSearchConsole(ctx, 'web-1', 'last_28_days');
        expect(m.findings.size).toBe(before);
    });

    it('sync before choosing a property, or after the grant is revoked, fails clearly', async () => {
        const m = repo();
        const ctx = ctxFor(m);
        await startGoogleAuthorization(ctx, 'web-1', 'google_analytics');
        await expect(syncGoogleAnalytics(ctx, 'web-1')).rejects.toMatchObject({ category: 'not_configured' });
        const revoked = google();
        const bad = (async (input: string, init: RequestInit) => (new URL(input).hostname === 'oauth2.googleapis.com' && new URLSearchParams(String(init.body)).get('grant_type') === 'refresh_token'
            ? new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) : revoked.fetch(input, init))) as unknown as typeof fetch;
        const st = new URL((await startGoogleAuthorization(ctx, 'web-1', 'google_analytics')).authorizationUrl).searchParams.get('state')!;
        await completeGoogleAuthorization(ctx, { state: st, code: 'c' });
        await selectGoogleProperty(ctx, 'web-1', 'google_analytics', 'properties/111');
        await expect(syncGoogleAnalytics({ ...ctx, http: { ...ctx.http, fetch: bad } }, 'web-1')).rejects.toMatchObject({ category: 'credentials_expired' });
        expect(m.integrations[0]!.status).toBe('credentials_expired');
    });
});
