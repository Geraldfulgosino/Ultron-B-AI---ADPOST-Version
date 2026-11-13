// @vitest-environment node
/** IntegrationSyncService with an in-memory repository and fake HTTP (no network, no database). */
import { connectWordPressCredentials, disconnectIntegration, discoverWordPressSite, runTechnicalCrawl, syncWordPressContent, type IntegrationPermissions, type IntegrationRow, type SyncRepository } from '../../../../../supabase/functions/_shared/integrations/sync.ts';
import { IntegrationError, type WebsiteRef } from '../../../../../supabase/functions/_shared/integrations/types.ts';
import type { WpContentRecord } from '../../../../../supabase/functions/_shared/integrations/wordpress.ts';

const SITE: WebsiteRef = { id: 'web-1', brandId: 'brand-1', clientId: null, websiteUrl: 'https://lugenixdigitalservices.com', isDemo: false };
const ADMIN: IntegrationPermissions = { can_view: true, can_sync: true, can_manage: true };

function memoryRepo(perms: IntegrationPermissions = ADMIN, site: WebsiteRef = SITE) {
    const integrations: IntegrationRow[] = [];
    const runs: Array<{ id: string; integrationId: string; kind: string; status: string; read?: number; written?: number; errorCategory?: string | null; errorMessage?: string | null }> = [];
    const secrets = new Map<string, unknown>();
    const items = new Map<string, WpContentRecord & { removedAt: string | null }>();
    const findings = new Map<string, { status: string; lastSeen: string; checkId: string }>();
    const updates: Array<Record<string, unknown>> = [];
    let seq = 0;
    const repo: SyncRepository = {
        permissions: async () => perms,
        website: async (id) => (id === site.id ? site : null),
        integration: async (w, p) => integrations.find((i) => i.websiteId === w && i.provider === p) ?? null,
        ensureIntegration: async (w, provider, authMethod) => {
            const row: IntegrationRow = { id: `int-${++seq}`, websiteId: w.id, provider, status: 'not_connected', authMethod, credentialConfigured: false, enabled: true };
            integrations.push(row);
            return row;
        },
        updateIntegration: async (id, patch) => {
            updates.push({ id, ...patch });
            const row = integrations.find((i) => i.id === id)!;
            if (patch.status) row.status = patch.status;
            if (patch.credentialConfigured !== undefined) row.credentialConfigured = patch.credentialConfigured;
        },
        startRun: async (integration, _w, kind) => {
            if (runs.some((r) => r.integrationId === integration.id && r.kind === kind && r.status === 'running')) throw new IntegrationError('limit_exceeded', 'A sync of this kind is already running.');
            const id = `run-${++seq}`;
            runs.push({ id, integrationId: integration.id, kind, status: 'running' });
            return id;
        },
        finishRun: async (id, r) => { Object.assign(runs.find((x) => x.id === id)!, { status: r.status, read: r.recordsRead, written: r.recordsWritten, errorCategory: r.errorCategory, errorMessage: r.errorMessage }); },
        readSecret: async (id) => (secrets.get(id) as never) ?? null,
        writeSecret: async (id, _w, v) => { secrets.set(id, v); },
        deleteSecret: async (id) => { secrets.delete(id); },
        upsertWpItems: async (_i, w, list) => {
            let changed = 0;
            for (const r of list) {
                const key = `${w.id}|${r.type}|${r.externalId}`;
                const old = items.get(key);
                if (!old || old.fingerprint !== r.fingerprint || old.removedAt) changed++;
                items.set(key, { ...r, removedAt: null });
            }
            return changed;
        },
        markWpItemsRemoved: async (w, type, keep, at) => {
            let n = 0;
            for (const [k, v] of items) if (k.startsWith(`${w}|${type}|`) && !keep.includes(v.externalId) && !v.removedAt) { v.removedAt = at; n++; }
            return n;
        },
        saveCrawl: async () => `job-${++seq}`,
        upsertFindings: async (_w, _s, list, ref) => {
            let n = 0;
            for (const f of list) {
                const old = findings.get(f.fingerprint);
                if (!old) n++;
                findings.set(f.fingerprint, { status: old?.status ?? 'open', lastSeen: ref.observedAt, checkId: f.checkId });
            }
            return n;
        },
        resolveUnseenFindings: async (_w, _s, seen) => {
            let n = 0;
            for (const [fp, f] of findings) if (!seen.includes(fp) && f.status === 'open') { f.status = 'resolved'; n++; }
            return n;
        },
    };
    return { repo, integrations, runs, secrets, items, findings, updates };
}

type Route = { status?: number; body: unknown; headers?: Record<string, string>; type?: string };
function http(routes: Record<string, Route | (() => Route)>) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = (async (input: string, init: RequestInit = {}) => {
        const u = new URL(input);
        calls.push({ url: input, headers: { ...(init.headers as Record<string, string>) } });
        const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => `${u.pathname}${u.search}`.startsWith(k));
        const raw = key ? routes[key]! : { status: 404, body: { code: 'rest_no_route' } };
        const r = typeof raw === 'function' ? raw() : raw;
        return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'application/json', ...r.headers } });
    }) as unknown as typeof fetch;
    return { deps: { fetch: fetchFn, resolve: async () => ['93.184.215.14'] }, calls };
}
const ROOT = { name: 'Lugenix', home: 'https://lugenixdigitalservices.com', url: 'https://lugenixdigitalservices.com', namespaces: ['wp/v2', 'rankmath/v1'], authentication: { 'application-passwords': {} } };
const pages = (ids: number[], suffix = '') => ({ body: ids.map((id) => ({ id, link: `https://lugenixdigitalservices.com/p${id}/`, slug: `p${id}`, title: { rendered: `Page ${id}${suffix}` }, status: 'publish', date_gmt: '2026-01-01T00:00:00', modified_gmt: '2026-01-02T00:00:00' })), headers: { 'x-wp-total': String(ids.length), 'x-wp-totalpages': '1' } });

describe('IntegrationSyncService', () => {
    it('discovery records a verified connection only after the real request succeeded', async () => {
        const m = memoryRepo();
        const h = http({ '/wp-json/': { body: ROOT }, '/wp-json/wp/v2/': { body: [], headers: { 'x-wp-total': '0' } } });
        const d = await discoverWordPressSite({ userId: 'u1', http: h.deps, repo: m.repo }, 'web-1');
        expect(d.seoPlugin).toBe('rank_math');
        expect(m.integrations[0]).toMatchObject({ provider: 'wordpress', status: 'sync_completed' });
        expect(m.updates.find((u) => u.status === 'sync_completed')).toHaveProperty('verifiedAt');
        expect(m.runs[0]).toMatchObject({ kind: 'discovery', status: 'succeeded' });
    });

    it('re-sync does not duplicate; changes and removals are counted only after a complete listing', async () => {
        const m = memoryRepo();
        let version = pages([1, 2, 3]);
        const h = http({ '/wp-json/wp/v2/pages': () => version });
        const ctx = { userId: 'u1', http: h.deps, repo: m.repo };
        expect((await syncWordPressContent(ctx, 'web-1', ['page'])).types.page).toMatchObject({ listed: 3, changed: 3, removed: 0 });
        expect((await syncWordPressContent(ctx, 'web-1', ['page'])).types.page).toMatchObject({ listed: 3, changed: 0, removed: 0 });
        version = pages([1, 2], ' (edited)');
        expect((await syncWordPressContent(ctx, 'web-1', ['page'])).types.page).toMatchObject({ listed: 2, changed: 2, removed: 1 });
        expect(m.items.size).toBe(3);
        expect([...m.items.values()].filter((i) => i.removedAt)).toHaveLength(1);
    });

    it('permission checks run before any network request', async () => {
        for (const [perms, fn] of [
            [{ can_view: true, can_sync: false, can_manage: false }, (c: never) => syncWordPressContent(c, 'web-1')],
            [{ can_view: true, can_sync: true, can_manage: false }, (c: never) => connectWordPressCredentials(c, 'web-1', { username: 'u', applicationPassword: 'x'.repeat(24) })],
            [{ can_view: false, can_sync: false, can_manage: false }, (c: never) => runTechnicalCrawl(c, 'web-1')],
        ] as const) {
            const m = memoryRepo(perms);
            const h = http({});
            await expect(fn({ userId: 'u1', http: h.deps, repo: m.repo } as never)).rejects.toBeInstanceOf(IntegrationError);
            expect(h.calls).toHaveLength(0);
        }
    });

    it('demo websites are refused before any request', async () => {
        const m = memoryRepo(ADMIN, { ...SITE, websiteUrl: 'https://pod.example', isDemo: true });
        const h = http({});
        await expect(syncWordPressContent({ userId: 'u1', http: h.deps, repo: m.repo }, 'web-1')).rejects.toMatchObject({ category: 'blocked_url' });
        expect(h.calls).toHaveLength(0);
    });

    it('stores credentials only after WordPress accepted them; never in run errors; disconnect deletes them', async () => {
        const m = memoryRepo();
        const bad = http({ '/wp-json/wp/v2/users/me': { status: 401, body: { code: 'invalid_username' } } });
        await expect(connectWordPressCredentials({ userId: 'u1', http: bad.deps, repo: m.repo }, 'web-1', { username: 'reader', applicationPassword: 'abcd efgh ijkl mnop qrst uvwx' })).rejects.toMatchObject({ category: 'auth_failed' });
        expect(m.secrets.size).toBe(0);
        const good = http({ '/wp-json/wp/v2/users/me': { body: { id: 7, name: 'reader', roles: ['author'], capabilities: {} } }, '/wp-json/wp/v2/pages': pages([1]) });
        const ctx = { userId: 'u1', http: good.deps, repo: m.repo };
        expect(await connectWordPressCredentials(ctx, 'web-1', { username: 'reader', applicationPassword: 'abcd efgh ijkl mnop qrst uvwx' })).toMatchObject({ status: 'connected' });
        expect(m.secrets.get('int-1')).toEqual({ username: 'reader', applicationPassword: 'abcdefghijklmnopqrstuvwx' });
        expect((await syncWordPressContent(ctx, 'web-1', ['page'])).authenticated).toBe(true);
        expect(good.calls.at(-1)!.headers.authorization).toMatch(/^Basic /);
        expect(JSON.stringify(m.updates)).not.toContain('abcdefghijkl');
        expect(await disconnectIntegration(ctx, 'web-1', 'wordpress')).toEqual({ status: 'not_connected' });
        expect(m.secrets.size).toBe(0);
    });

    it('a failed sync records the category on the run and the connection status', async () => {
        const m = memoryRepo();
        const h = http({ '/wp-json/wp/v2/pages': { status: 429, body: { code: 'too_many' }, headers: { 'retry-after': '60' } } });
        await expect(syncWordPressContent({ userId: 'u1', http: h.deps, repo: m.repo }, 'web-1', ['page'])).rejects.toMatchObject({ category: 'rate_limited' });
        expect(m.runs[0]).toMatchObject({ status: 'failed', errorCategory: 'rate_limited' });
        expect(m.integrations[0]!.status).toBe('rate_limited');
    });

    it('overlapping syncs of the same kind are refused', async () => {
        const m = memoryRepo();
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const h = http({ '/wp-json/wp/v2/pages': pages([1]) });
        const slow = { ...h.deps, resolve: async () => { await gate; return ['93.184.215.14']; } };
        const first = syncWordPressContent({ userId: 'u1', http: slow, repo: m.repo }, 'web-1', ['page']);
        await new Promise((r) => setTimeout(r, 10));
        await expect(syncWordPressContent({ userId: 'u1', http: h.deps, repo: m.repo }, 'web-1', ['page'])).rejects.toMatchObject({ category: 'limit_exceeded' });
        release();
        await first;
    });

    it('crawl findings upsert by fingerprint and resolve only after a complete crawl', async () => {
        const m = memoryRepo();
        let html = '<html><head><title>Short</title><meta name="viewport" content="x"></head><body><h1>A</h1></body></html>';
        const h = http({ '/robots.txt': { status: 404, body: 'no' }, '/sitemap.xml': { status: 404, body: 'no' }, '/': () => ({ body: html, type: 'text/html' }) });
        const ctx = { userId: 'u1', http: h.deps, repo: m.repo };
        const first = await runTechnicalCrawl(ctx, 'web-1', { maxPages: 5 });
        expect(first.newFindings).toBeGreaterThan(0);
        const again = await runTechnicalCrawl(ctx, 'web-1', { maxPages: 5 });
        expect(again).toMatchObject({ newFindings: 0, resolved: 0 });
        html = `<html><head><title>A good descriptive title for the home page</title><meta name="description" content="${'d'.repeat(120)}"><link rel="canonical" href="https://lugenixdigitalservices.com/"><meta name="viewport" content="x"></head><body><h1>A</h1></body></html>`;
        const fixed = await runTechnicalCrawl(ctx, 'web-1', { maxPages: 5 });
        expect(fixed.resolved).toBeGreaterThan(0);
        expect([...m.findings.values()].find((f) => f.checkId === 'meta_description_missing')!.status).toBe('resolved');
    });
});
