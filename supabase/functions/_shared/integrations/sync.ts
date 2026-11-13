/**
 * IntegrationSyncService: runs a connector for one website and persists the results through a
 * repository (Supabase service role in the Edge Function; in-memory in tests).
 *
 * Invariants
 *  - The caller's rights are checked first (integration_permissions under the caller's JWT).
 *  - The website comes from the database (RLS-visible to the caller), never from request input.
 *  - Demo websites are refused before any network request.
 *  - One running sync per integration and kind (database unique index; reported as 'sync_in_progress').
 *  - An integration becomes 'connected' only after a real provider request succeeded.
 *  - Re-syncs do not duplicate: items upsert by provider id, findings by fingerprint.
 *  - Items are marked removed only after a complete (non-truncated) listing.
 *  - Errors are categorized and recorded on the run and the connection; secrets are never logged.
 */
import { sanitize } from '../ai/errors.ts';
import { crawlWebsite, type CrawlFinding, type CrawledPage } from './crawler.ts';
import { discoverWordPress, listWordPressContent, testWordPressCredentials, type WpContentRecord, type WpContentType, type WpCredentials, type WpDiscovery } from './wordpress.ts';
import { assertLiveWebsite, IntegrationError, statusForError, type HttpDeps, type IntegrationProvider, type IntegrationStatus, type WebsiteRef } from './types.ts';

export interface IntegrationPermissions { can_view: boolean; can_sync: boolean; can_manage: boolean }

export interface IntegrationRow {
    id: string;
    websiteId: string;
    provider: IntegrationProvider;
    status: IntegrationStatus | 'pending' | 'error' | 'disconnected';
    authMethod: 'none' | 'application_password' | 'oauth2';
    credentialConfigured: boolean;
    enabled: boolean;
}

export interface SyncRepository {
    permissions(websiteId: string): Promise<IntegrationPermissions>;
    website(websiteId: string): Promise<WebsiteRef | null>;
    integration(websiteId: string, provider: IntegrationProvider): Promise<IntegrationRow | null>;
    ensureIntegration(website: WebsiteRef, provider: IntegrationProvider, authMethod: IntegrationRow['authMethod'], userId: string): Promise<IntegrationRow>;
    updateIntegration(id: string, patch: Partial<{ status: IntegrationStatus; verifiedAt: string | null; lastSuccessAt: string; lastFailureAt: string; errorCategory: string | null; lastErrorMessage: string | null; credentialConfigured: boolean; config: Record<string, unknown>; externalPropertyId: string | null; label: string }>): Promise<void>;
    /** Throws IntegrationError('limit_exceeded'… ) if a run of this kind is already running. */
    startRun(integration: IntegrationRow, website: WebsiteRef, kind: string, userId: string): Promise<string>;
    finishRun(runId: string, r: { status: 'succeeded' | 'failed' | 'cancelled'; recordsRead: number; recordsWritten: number; truncated: boolean; errorCategory?: string | null; errorMessage?: string | null }): Promise<void>;
    readSecret<T>(integrationId: string): Promise<T | null>;
    writeSecret(integrationId: string, website: WebsiteRef, value: unknown): Promise<void>;
    deleteSecret(integrationId: string): Promise<void>;
    /** Upserts by (website, type, external id); returns how many rows were new or changed (fingerprint differs). */
    upsertWpItems(integration: IntegrationRow, website: WebsiteRef, items: WpContentRecord[], fetchedAt: string): Promise<number>;
    markWpItemsRemoved(websiteId: string, type: WpContentType, keepIds: number[], at: string): Promise<number>;
    saveCrawl(website: WebsiteRef, userId: string, pages: CrawledPage[], meta: { startUrl: string; maxPages: number; maxDepth: number; stoppedBy: string; startedAt: string; finishedAt: string }): Promise<string>;
    /** Upserts by (website, fingerprint): new → inserted, existing → last_seen updated (status kept). Returns inserted count. */
    upsertFindings(website: WebsiteRef, source: 'crawler' | 'wordpress' | 'ga4' | 'gsc', findings: CrawlFinding[], ref: { crawlJobId?: string; syncRunId?: string; observedAt: string }): Promise<number>;
    /** After a complete crawl: open crawler findings not seen in this crawl become resolved. */
    resolveUnseenFindings(websiteId: string, source: 'crawler', seenFingerprints: string[], at: string): Promise<number>;
}

export interface SyncContext {
    userId: string;
    http: HttpDeps;
    repo: SyncRepository;
    now?: () => Date;
}

async function load(ctx: SyncContext, websiteId: string, need: 'can_sync' | 'can_manage' | 'can_view') {
    const perms = await ctx.repo.permissions(websiteId);
    if (!perms.can_view) throw new IntegrationError('not_found', 'Website not found.');
    if (!perms[need]) throw new IntegrationError('permission_denied', need === 'can_manage' ? 'Only client or agency administrators can manage integrations.' : 'You cannot run syncs for this website.');
    const website = await ctx.repo.website(websiteId);
    if (!website) throw new IntegrationError('not_found', 'Website not found.');
    const url = assertLiveWebsite(website);
    return { website, url };
}

async function withRun<T>(ctx: SyncContext, integration: IntegrationRow, website: WebsiteRef, kind: string, work: (runId: string) => Promise<{ read: number; written: number; truncated: boolean; result: T }>): Promise<T> {
    const now = () => (ctx.now?.() ?? new Date()).toISOString();
    if (!integration.enabled) throw new IntegrationError('permission_denied', 'This integration is disabled.');
    const runId = await ctx.repo.startRun(integration, website, kind, ctx.userId);
    await ctx.repo.updateIntegration(integration.id, { status: 'syncing' }).catch(() => undefined);
    try {
        const r = await work(runId);
        await ctx.repo.finishRun(runId, { status: 'succeeded', recordsRead: r.read, recordsWritten: r.written, truncated: r.truncated });
        await ctx.repo.updateIntegration(integration.id, { status: 'sync_completed', verifiedAt: now(), lastSuccessAt: now(), errorCategory: null, lastErrorMessage: null });
        return r.result;
    } catch (e) {
        const err = e instanceof IntegrationError ? e : new IntegrationError('provider_error', 'The sync failed unexpectedly.');
        const message = sanitize(err.message, 300);
        await ctx.repo.finishRun(runId, { status: err.category === 'cancelled' ? 'cancelled' : 'failed', recordsRead: 0, recordsWritten: 0, truncated: false, errorCategory: err.category, errorMessage: message });
        await ctx.repo.updateIntegration(integration.id, { status: statusForError(err.category), lastFailureAt: now(), errorCategory: err.category, lastErrorMessage: message });
        throw err;
    }
}

// ── WordPress ───────────────────────────────────────────────────────────────────────────────

/** Public discovery: proves the site is WordPress and that it is this website. No credentials. */
export async function discoverWordPressSite(ctx: SyncContext, websiteId: string): Promise<WpDiscovery> {
    const { website } = await load(ctx, websiteId, 'can_sync');
    const integration = (await ctx.repo.integration(websiteId, 'wordpress')) ?? (await ctx.repo.ensureIntegration(website, 'wordpress', 'none', ctx.userId));
    return withRun(ctx, integration, website, 'discovery', async () => {
        const d = await discoverWordPress(website.websiteUrl, ctx.http);
        await ctx.repo.updateIntegration(integration.id, { config: { discovery: { ...d, namespaces: d.namespaces.slice(0, 40) } }, label: d.siteName || 'WordPress' });
        return { read: 1, written: 1, truncated: false, result: d };
    });
}

/** Stores an Application Password (encrypted) only after WordPress accepted it. Admins only. */
export async function connectWordPressCredentials(ctx: SyncContext, websiteId: string, creds: WpCredentials) {
    const { website } = await load(ctx, websiteId, 'can_manage');
    const test = await testWordPressCredentials(website.websiteUrl, creds, ctx.http);
    const integration = (await ctx.repo.integration(websiteId, 'wordpress')) ?? (await ctx.repo.ensureIntegration(website, 'wordpress', 'application_password', ctx.userId));
    await ctx.repo.writeSecret(integration.id, website, { username: creds.username.trim(), applicationPassword: creds.applicationPassword.replace(/\s+/g, '') });
    const now = (ctx.now?.() ?? new Date()).toISOString();
    await ctx.repo.updateIntegration(integration.id, { status: 'connected', verifiedAt: now, credentialConfigured: true, errorCategory: null, lastErrorMessage: null, config: { wpUser: { id: test.userId, name: test.name, roles: test.roles }, warnings: test.warnings } });
    return { status: 'connected' as const, user: { name: test.name, roles: test.roles }, warnings: test.warnings };
}

export async function disconnectIntegration(ctx: SyncContext, websiteId: string, provider: IntegrationProvider, revoke?: (secret: unknown) => Promise<void>) {
    await load(ctx, websiteId, 'can_manage');
    const integration = await ctx.repo.integration(websiteId, provider);
    if (!integration) return { status: 'not_connected' as const };
    const secret = await ctx.repo.readSecret(integration.id);
    if (secret && revoke) await revoke(secret).catch(() => undefined); // provider revocation is best effort
    await ctx.repo.deleteSecret(integration.id);
    await ctx.repo.updateIntegration(integration.id, { status: 'not_connected', verifiedAt: null, credentialConfigured: false, externalPropertyId: null });
    return { status: 'not_connected' as const };
}

export async function syncWordPressContent(ctx: SyncContext, websiteId: string, types: WpContentType[] = ['page', 'post', 'category', 'tag'], signal?: { cancelled: boolean }) {
    const { website } = await load(ctx, websiteId, 'can_sync');
    const integration = (await ctx.repo.integration(websiteId, 'wordpress')) ?? (await ctx.repo.ensureIntegration(website, 'wordpress', 'none', ctx.userId));
    const creds = integration.credentialConfigured ? await ctx.repo.readSecret<WpCredentials>(integration.id) : null;
    if (integration.credentialConfigured && !creds) throw new IntegrationError('credentials_expired', 'Stored WordPress credentials are missing. Reconnect WordPress.');
    const kind = types.length === 1 ? types[0]! : 'content';
    return withRun(ctx, integration, website, kind, async () => {
        const at = (ctx.now?.() ?? new Date()).toISOString();
        const summary: Record<string, { listed: number; total: number | null; changed: number; removed: number; truncated: boolean }> = {};
        let read = 0, written = 0, truncated = false;
        for (const type of types) {
            const r = await listWordPressContent(website.websiteUrl, type, ctx.http, { creds, signal });
            const changed = await ctx.repo.upsertWpItems(integration, website, r.records, at);
            const removed = r.truncated ? 0 : await ctx.repo.markWpItemsRemoved(website.id, type, r.records.map((x) => x.externalId), at);
            summary[type] = { listed: r.records.length, total: r.total, changed, removed, truncated: r.truncated };
            read += r.records.length;
            written += changed + removed;
            truncated ||= r.truncated;
        }
        return { read, written, truncated, result: { authenticated: !!creds, types: summary, fetchedAt: at } };
    });
}

// ── Crawler ────────────────────────────────────────────────────────────────────────────────

export async function runTechnicalCrawl(ctx: SyncContext, websiteId: string, o: { maxPages?: number; maxDepth?: number; signal?: { cancelled: boolean } } = {}) {
    const { website, url } = await load(ctx, websiteId, 'can_sync');
    const integration = (await ctx.repo.integration(websiteId, 'site_crawler')) ?? (await ctx.repo.ensureIntegration(website, 'site_crawler', 'none', ctx.userId));
    return withRun(ctx, integration, website, 'crawl', async (runId) => {
        const maxPages = Math.min(o.maxPages ?? 50, 100); // one Edge Function invocation stays small
        const maxDepth = Math.min(o.maxDepth ?? 3, 5);
        const r = await crawlWebsite({ startUrl: url.origin + '/', allowedHosts: [url.hostname], maxPages, maxDepth, budgetMs: 110_000, signal: o.signal }, ctx.http);
        const jobId = await ctx.repo.saveCrawl(website, ctx.userId, r.pages, { startUrl: r.startUrl, maxPages, maxDepth, stoppedBy: r.stoppedBy, startedAt: r.startedAt, finishedAt: r.finishedAt });
        const inserted = await ctx.repo.upsertFindings(website, 'crawler', r.findings, { crawlJobId: jobId, syncRunId: runId, observedAt: r.finishedAt });
        // Only a complete crawl can say an earlier finding is gone.
        const resolved = r.stoppedBy === 'complete' ? await ctx.repo.resolveUnseenFindings(website.id, 'crawler', r.findings.map((f) => f.fingerprint), r.finishedAt) : 0;
        return { read: r.pages.length, written: r.pages.length + inserted + resolved, truncated: r.stoppedBy !== 'complete', result: { jobId, pages: r.pages.length, findings: r.findings.length, newFindings: inserted, resolved, stoppedBy: r.stoppedBy } };
    });
}
