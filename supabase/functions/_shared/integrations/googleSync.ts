/**
 * Google integrations for a website: OAuth start/callback, property selection and syncs.
 * Builds on sync.ts (same permission, run and status rules). Read-only Google scopes.
 *
 * Connection states: not_connected → pending_authorization (OAuth started) → pending_authorization
 * (authorized, property not chosen) → connected (property verified with a real API request).
 */
import { sanitize } from '../ai/errors.ts';
import { buildAuthorizationUrl, createOAuthRequest, exchangeAuthorizationCode, refreshAccessToken, resolveDateRange, sha256Hex, todayIn, validateOAuthCallback, type DatePreset, type DateRange, type GoogleOAuthConfig, type GoogleProvider, type StoredOAuthState } from './google.ts';
import { GA4_DIMENSIONS, listGa4Properties, runGa4Report, verifyGa4Property, type Ga4Row } from './ga4.ts';
import { findOpportunities, GSC_DIMENSIONS, listGscSites, propertyCoversWebsite, querySearchAnalytics, verifyGscProperty, type GscRow } from './gsc.ts';
import type { CrawlFinding } from './crawler.ts';
import type { IntegrationRow, SyncContext, SyncRepository } from './sync.ts';
import { assertLiveWebsite, IntegrationError, statusForError, type WebsiteRef } from './types.ts';

export interface GoogleSecret { refreshToken: string; scopes: string[]; grantedAt: string }

export interface GoogleRepository extends SyncRepository {
    saveOAuthState(s: StoredOAuthState & { brandId: string; encryptedVerifier: string }): Promise<void>;
    loadOAuthState(stateHash: string): Promise<(StoredOAuthState & { id: string; encryptedVerifier: string }) | null>;
    consumeOAuthState(id: string): Promise<boolean>;
    encrypt(scope: string, value: unknown): Promise<string>;
    decrypt<T>(scope: string, blob: string): Promise<T>;
    upsertGa4Rows(integration: IntegrationRow, website: WebsiteRef, propertyId: string, rows: Ga4Row[], fetchedAt: string): Promise<number>;
    upsertGscRows(integration: IntegrationRow, website: WebsiteRef, siteUrl: string, rows: GscRow[], fetchedAt: string): Promise<number>;
    integrationConfig(integrationId: string): Promise<{ externalPropertyId: string | null; config: Record<string, unknown> }>;
}

export interface GoogleContext extends Omit<SyncContext, 'repo'> {
    repo: GoogleRepository;
    oauth: GoogleOAuthConfig;
}

const now = (ctx: { now?: () => Date }) => ctx.now?.() ?? new Date();

async function website(ctx: GoogleContext, websiteId: string, need: 'can_manage' | 'can_sync' | 'can_view') {
    const p = await ctx.repo.permissions(websiteId);
    if (!p.can_view) throw new IntegrationError('not_found', 'Website not found.');
    if (!p[need]) throw new IntegrationError('permission_denied', need === 'can_manage' ? 'Only client or agency administrators can connect Google.' : 'You cannot run syncs for this website.');
    const w = await ctx.repo.website(websiteId);
    if (!w) throw new IntegrationError('not_found', 'Website not found.');
    assertLiveWebsite(w);
    return w;
}

async function accessToken(ctx: GoogleContext, integration: IntegrationRow): Promise<string> {
    const secret = await ctx.repo.readSecret<GoogleSecret>(integration.id);
    if (!secret?.refreshToken) throw new IntegrationError('credentials_expired', 'Google is not authorized for this website. Connect Google again.');
    return (await refreshAccessToken(ctx.oauth, secret.refreshToken, ctx.http.fetch, now(ctx))).accessToken;
}

/** Step 1 (admins): returns the Google consent URL. State and PKCE verifier are stored server-side. */
export async function startGoogleAuthorization(ctx: GoogleContext, websiteId: string, provider: GoogleProvider) {
    const w = await website(ctx, websiteId, 'can_manage');
    const integration = (await ctx.repo.integration(websiteId, provider)) ?? (await ctx.repo.ensureIntegration(w, provider, 'oauth2', ctx.userId));
    const req = await createOAuthRequest();
    await ctx.repo.saveOAuthState({
        stateHash: req.stateHash, provider, userId: ctx.userId, websiteId, brandId: w.brandId, redirectUri: ctx.oauth.redirectUri,
        expiresAt: new Date(now(ctx).getTime() + 10 * 60_000).toISOString(), consumedAt: null, encryptedVerifier: await ctx.repo.encrypt(req.stateHash, req.verifier),
    });
    if (integration.status === 'not_connected') await ctx.repo.updateIntegration(integration.id, { status: 'pending_authorization' });
    return { authorizationUrl: buildAuthorizationUrl(ctx.oauth, provider, req.state, req.challenge) };
}

/** Step 2 (callback): validates state, exchanges the code server-side, stores the refresh token encrypted. */
export async function completeGoogleAuthorization(ctx: GoogleContext, query: { state?: string | null; code?: string | null; error?: string | null }) {
    const stateHash = query.state && /^[0-9a-f]{64}$/.test(query.state) ? await sha256Hex(query.state) : '';
    const stored = stateHash ? await ctx.repo.loadOAuthState(stateHash) : null;
    const { code } = await validateOAuthCallback(query, stored, ctx.userId, now(ctx));
    if (!(await ctx.repo.consumeOAuthState(stored!.id))) throw new IntegrationError('auth_failed', 'This authorization was already used.');
    const w = await website(ctx, stored!.websiteId, 'can_manage');
    const verifier = await ctx.repo.decrypt<string>(stored!.stateHash, stored!.encryptedVerifier);
    const tokens = await exchangeAuthorizationCode(ctx.oauth, stored!.provider, code, verifier, ctx.http.fetch, now(ctx));
    const integration = (await ctx.repo.integration(w.id, stored!.provider)) ?? (await ctx.repo.ensureIntegration(w, stored!.provider, 'oauth2', ctx.userId));
    await ctx.repo.writeSecret(integration.id, w, { refreshToken: tokens.refreshToken, scopes: tokens.scopes, grantedAt: now(ctx).toISOString() } satisfies GoogleSecret);
    // Authorized, but not 'connected' until a property is chosen and verified.
    await ctx.repo.updateIntegration(integration.id, { status: 'pending_authorization', credentialConfigured: true, errorCategory: null, lastErrorMessage: null });
    return { websiteId: w.id, provider: stored!.provider, next: 'select_property' as const };
}

export async function listGoogleProperties(ctx: GoogleContext, websiteId: string, provider: GoogleProvider) {
    const w = await website(ctx, websiteId, 'can_manage');
    const integration = await ctx.repo.integration(websiteId, provider);
    if (!integration?.credentialConfigured) throw new IntegrationError('credentials_expired', 'Connect Google first.');
    const token = await accessToken(ctx, integration);
    if (provider === 'google_analytics') return { properties: (await listGa4Properties(ctx.http.fetch, token)).map((p) => ({ id: p.propertyId, name: p.displayName, account: p.accountName, coversWebsite: null })) };
    return { properties: (await listGscSites(ctx.http.fetch, token)).map((s) => ({ id: s.siteUrl, name: s.siteUrl, account: s.permissionLevel, coversWebsite: propertyCoversWebsite(s.siteUrl, w.websiteUrl) })) };
}

/** The chosen property is verified with a real API request before the connection becomes 'connected'. */
export async function selectGoogleProperty(ctx: GoogleContext, websiteId: string, provider: GoogleProvider, propertyId: string) {
    const w = await website(ctx, websiteId, 'can_manage');
    const integration = await ctx.repo.integration(websiteId, provider);
    if (!integration?.credentialConfigured) throw new IntegrationError('credentials_expired', 'Connect Google first.');
    const token = await accessToken(ctx, integration);
    const label = provider === 'google_analytics' ? (await verifyGa4Property(ctx.http.fetch, token, propertyId)).displayName : (await verifyGscProperty(ctx.http.fetch, token, propertyId, w.websiteUrl)).siteUrl;
    await ctx.repo.updateIntegration(integration.id, { status: 'connected', verifiedAt: now(ctx).toISOString(), externalPropertyId: propertyId, label, errorCategory: null, lastErrorMessage: null });
    return { status: 'connected' as const, propertyId, label };
}

async function googleRun<T>(ctx: GoogleContext, integration: IntegrationRow, w: WebsiteRef, kind: string, work: (runId: string) => Promise<{ read: number; written: number; truncated: boolean; result: T }>): Promise<T> {
    const runId = await ctx.repo.startRun(integration, w, kind, ctx.userId);
    try {
        const r = await work(runId);
        await ctx.repo.finishRun(runId, { status: 'succeeded', recordsRead: r.read, recordsWritten: r.written, truncated: r.truncated });
        await ctx.repo.updateIntegration(integration.id, { status: 'sync_completed', verifiedAt: now(ctx).toISOString(), lastSuccessAt: now(ctx).toISOString(), errorCategory: null, lastErrorMessage: null });
        return r.result;
    } catch (e) {
        const err = e instanceof IntegrationError ? e : new IntegrationError('provider_error', 'The sync failed unexpectedly.');
        await ctx.repo.finishRun(runId, { status: 'failed', recordsRead: 0, recordsWritten: 0, truncated: false, errorCategory: err.category, errorMessage: sanitize(err.message, 300) });
        await ctx.repo.updateIntegration(integration.id, { status: statusForError(err.category), lastFailureAt: now(ctx).toISOString(), errorCategory: err.category, lastErrorMessage: sanitize(err.message, 300) });
        throw err;
    }
}

async function connected(ctx: GoogleContext, websiteId: string, provider: GoogleProvider) {
    const w = await website(ctx, websiteId, 'can_sync');
    const integration = await ctx.repo.integration(websiteId, provider);
    const cfg = integration ? await ctx.repo.integrationConfig(integration.id) : null;
    if (!integration || !integration.credentialConfigured || !cfg?.externalPropertyId) throw new IntegrationError('not_configured', 'Connect Google and choose a property first.');
    if (!integration.enabled) throw new IntegrationError('permission_denied', 'This integration is disabled.');
    return { w, integration, propertyId: cfg.externalPropertyId, config: cfg.config };
}

export async function syncGoogleAnalytics(ctx: GoogleContext, websiteId: string, preset: DatePreset = 'last_28_days', custom?: DateRange) {
    const { w, integration, propertyId, config } = await connected(ctx, websiteId, 'google_analytics');
    return googleRun(ctx, integration, w, 'ga4', async () => {
        const token = await accessToken(ctx, integration);
        const tz = typeof config.timeZone === 'string' ? config.timeZone : 'UTC';
        const { current, previous } = resolveDateRange(preset, todayIn(tz, now(ctx)), custom);
        // Fetch both periods so comparisons never mix in fabricated values.
        const range = { from: previous.from, to: current.to };
        let read = 0, written = 0, truncated = false, timeZone: string | null = null;
        const at = now(ctx).toISOString();
        for (const dim of GA4_DIMENSIONS) {
            const r = await runGa4Report(ctx.http.fetch, token, propertyId, range, dim);
            timeZone ??= r.timeZone;
            read += r.rows.length;
            written += await ctx.repo.upsertGa4Rows(integration, w, propertyId, r.rows, at);
            truncated ||= r.truncated;
        }
        if (timeZone && timeZone !== config.timeZone) await ctx.repo.updateIntegration(integration.id, { config: { ...config, timeZone } });
        return { read, written, truncated, result: { propertyId, current, previous, rows: read, timeZone } };
    });
}

export async function syncSearchConsole(ctx: GoogleContext, websiteId: string, preset: DatePreset = 'last_28_days', custom?: DateRange) {
    const { w, integration, propertyId } = await connected(ctx, websiteId, 'google_search_console');
    return googleRun(ctx, integration, w, 'gsc', async (runId) => {
        const token = await accessToken(ctx, integration);
        const ranges = resolveDateRange(preset, todayIn('America/Los_Angeles', now(ctx)), custom); // Search Console reports in Pacific Time
        const at = now(ctx).toISOString();
        let read = 0, written = 0, truncated = false, firstIncomplete: string | null = null;
        const byDim: Record<string, { cur: GscRow[]; prev: GscRow[] }> = {};
        for (const dim of GSC_DIMENSIONS) {
            const r = await querySearchAnalytics(ctx.http.fetch, token, propertyId, { from: ranges.previous.from, to: ranges.current.to }, dim);
            firstIncomplete ??= r.firstIncompleteDate;
            read += r.rows.length;
            written += await ctx.repo.upsertGscRows(integration, w, propertyId, r.rows, at);
            truncated ||= r.truncated;
            byDim[dim] = { cur: r.rows.filter((x) => x.date >= ranges.current.from), prev: r.rows.filter((x) => x.date <= ranges.previous.to) };
        }
        const findings: CrawlFinding[] = [];
        for (const dim of ['query', 'page', 'device'] as const) {
            for (const o of findOpportunities(dim, byDim[dim]!.cur, byDim[dim]!.prev, ranges)) {
                findings.push({
                    checkId: o.checkId, kind: 'heuristic', severity: o.severity, confidence: o.confidence, title: o.title,
                    subjectUrl: dim === 'page' ? o.subject : null, evidence: { ...o.evidence, dimension: dim, subject: o.subject, property: propertyId, firstIncompleteDate: firstIncomplete },
                    recommendation: o.recommendation, suggestedTask: o.severity === 'high' || o.severity === 'medium' ? { title: `${o.title}: ${o.subject}`.slice(0, 200), team: 'seo', priority: o.severity === 'high' ? 'high' : 'medium' } : null,
                    fingerprint: await sha256Hex(`${o.checkId}|${dim}|${o.subject}|${ranges.current.from}|${ranges.current.to}`).then((h) => h.slice(0, 32)),
                });
            }
        }
        const inserted = await ctx.repo.upsertFindings(w, 'gsc', findings, { syncRunId: runId, observedAt: at });
        return { read, written: written + inserted, truncated, result: { propertyId, ...ranges, rows: read, opportunities: findings.length, firstIncompleteDate: firstIncomplete } };
    });
}
