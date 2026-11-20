/**
 * Supabase-backed repository for the integration services (Edge runtime only).
 * Caller-scoped reads (permissions, website) use the user's JWT; writes use the service role
 * and happen only after the service layer checked integration_permissions().
 */
// @ts-nocheck: Deno runtime file; type-checked by `supabase functions deploy`.
import { IntegrationError } from './types.ts';
import { decryptSecret, encryptSecret } from './secrets.ts';

export function supabaseRepository(user, admin, keyPromise) {
    const must = (r, what) => { if (r.error) throw new IntegrationError('provider_error', `Database error (${what}).`); return r.data; };
    const toRow = (r) => r && ({ id: r.id, websiteId: r.website_id, provider: r.provider, status: r.status, authMethod: r.auth_method, credentialConfigured: r.credential_configured, enabled: r.enabled });
    const columns = { status: 'status', verifiedAt: 'verified_at', lastSuccessAt: 'last_success_at', lastFailureAt: 'last_failure_at', errorCategory: 'error_category', lastErrorMessage: 'last_error_message', credentialConfigured: 'credential_configured', config: 'config', externalPropertyId: 'external_property_id', label: 'label' };
    return {
        async permissions(websiteId) {
            const r = await user.rpc('integration_permissions', { p_website_id: websiteId });
            return r.error ? { can_view: false, can_sync: false, can_manage: false } : r.data;
        },
        async website(websiteId) {
            const w = must(await user.from('websites').select('id, brand_id, client_id, website_url, is_demo, status').eq('id', websiteId).maybeSingle(), 'website');
            return w && w.status !== 'archived' ? { id: w.id, brandId: w.brand_id, clientId: w.client_id, websiteUrl: w.website_url, isDemo: w.is_demo } : null;
        },
        async integration(websiteId, provider) {
            return toRow(must(await admin.from('integrations').select('*').eq('website_id', websiteId).eq('provider', provider).maybeSingle(), 'integration'));
        },
        async ensureIntegration(website, provider, authMethod, userId) {
            // Insert; if another request created it first, use that row (never overwrite its status).
            const r = await admin.from('integrations').insert({ website_id: website.id, brand_id: website.brandId, provider, auth_method: authMethod, created_by: userId, status: 'not_connected' }).select('*').single();
            if (r.error?.code === '23505') return this.integration(website.id, provider);
            return toRow(must(r, 'integration'));
        },
        async updateIntegration(id, patch) {
            const row = Object.fromEntries(Object.entries(patch).filter(([k]) => columns[k]).map(([k, v]) => [columns[k], v]));
            const r = await admin.from('integrations').update(row).eq('id', id);
            // integrations_google_property_unique (0012): the property belongs to another website.
            if (r.error?.code === '23505') throw new IntegrationError('permission_denied', 'This Google property is already connected to another website.');
            must(r, 'integration update');
        },
        async propertyAssignments(provider, propertyId, exceptIntegrationId) {
            const rows = must(await admin.from('integrations').select('id, website_id, brand_id').eq('provider', provider).eq('external_property_id', propertyId).neq('id', exceptIntegrationId), 'property assignments');
            return rows.map((r) => ({ websiteId: r.website_id, brandId: r.brand_id }));
        },
        async audit(website, userId, action, details) {
            const brand = must(await admin.from('brands').select('agency_id').eq('id', website.brandId).single(), 'brand');
            must(await admin.from('platform_audit_events').insert({
                actor_id: userId, action, target_type: 'website', target_id: website.id, agency_id: brand.agency_id, brand_id: website.brandId, details,
            }), 'audit');
        },
        async startRun(integration, website, kind, userId) {
            const since = new Date(Date.now() - 10 * 60_000).toISOString();
            const { count } = await admin.from('integration_sync_runs').select('id', { count: 'exact', head: true }).eq('website_id', website.id).gte('started_at', since);
            if ((count ?? 0) >= 12) throw new IntegrationError('rate_limited', 'Too many syncs for this website. Try again in a few minutes.');
            const r = await admin.from('integration_sync_runs').insert({ integration_id: integration.id, brand_id: website.brandId, website_id: website.id, provider: integration.provider, kind, triggered_by: userId }).select('id').single();
            if (r.error?.code === '23505') throw new IntegrationError('limit_exceeded', 'A sync of this kind is already running.');
            return must(r, 'run').id;
        },
        async finishRun(runId, r) {
            must(await admin.from('integration_sync_runs').update({ status: r.status, finished_at: new Date().toISOString(), records_read: r.recordsRead, records_written: r.recordsWritten, truncated: r.truncated, error_category: r.errorCategory ?? null, error_message: r.errorMessage ?? null }).eq('id', runId), 'run finish');
        },
        async readSecret(integrationId) {
            const r = must(await admin.from('integration_secrets').select('encrypted_credentials').eq('integration_id', integrationId).maybeSingle(), 'secret');
            return r ? decryptSecret(await keyPromise, integrationId, r.encrypted_credentials) : null;
        },
        async writeSecret(integrationId, website, value) {
            const blob = await encryptSecret(await keyPromise, integrationId, value);
            must(await admin.from('integration_secrets').upsert({ integration_id: integrationId, brand_id: website.brandId, encrypted_credentials: blob, updated_at: new Date().toISOString() }), 'secret write');
        },
        async deleteSecret(integrationId) {
            must(await admin.from('integration_secrets').delete().eq('integration_id', integrationId), 'secret delete');
        },
        async upsertWpItems(integration, website, items, fetchedAt) {
            if (!items.length) return 0;
            const existing = must(await admin.from('wp_content_items').select('content_type, external_id, fingerprint, removed_at').eq('website_id', website.id).eq('content_type', items[0].type), 'items');
            const known = new Map(existing.map((e) => [`${e.content_type}|${e.external_id}`, e]));
            const changed = items.filter((i) => { const e = known.get(`${i.type}|${i.externalId}`); return !e || e.fingerprint !== i.fingerprint || e.removed_at; }).length;
            for (let i = 0; i < items.length; i += 500) {
                must(await admin.from('wp_content_items').upsert(items.slice(i, i + 500).map((r) => ({
                    integration_id: integration.id, brand_id: website.brandId, website_id: website.id, content_type: r.type, external_id: r.externalId, url: r.url, slug: r.slug, title: r.title, status: r.status,
                    published_at: r.publishedAt, modified_at: r.modifiedAt, author_external_id: r.authorId, parent_external_id: r.parentId, featured_media_external_id: r.featuredMediaId,
                    category_ids: r.categoryIds, tag_ids: r.tagIds, excerpt: r.excerpt, alt_text: r.altText, mime_type: r.mimeType, item_count: r.count, fingerprint: r.fingerprint, last_fetched_at: fetchedAt, removed_at: null,
                })), { onConflict: 'website_id,content_type,external_id' }), 'items upsert');
            }
            return changed;
        },
        async markWpItemsRemoved(websiteId, type, keepIds, at) {
            const rows = must(await admin.from('wp_content_items').select('id, external_id').eq('website_id', websiteId).eq('content_type', type).is('removed_at', null), 'items');
            const gone = rows.filter((r) => !keepIds.includes(Number(r.external_id))).map((r) => r.id);
            if (gone.length) must(await admin.from('wp_content_items').update({ removed_at: at }).in('id', gone), 'items removed');
            return gone.length;
        },
        async saveCrawl(website, userId, pages, meta) {
            const job = must(await admin.from('seo_crawl_jobs').insert({ brand_id: website.brandId, website_id: website.id, status: 'completed', start_url: meta.startUrl, max_pages: meta.maxPages, max_depth: meta.maxDepth, pages_crawled: pages.length, requested_by: userId, started_at: meta.startedAt, finished_at: meta.finishedAt, error_message: meta.stoppedBy === 'complete' ? null : `Stopped: ${meta.stoppedBy}` }).select('id').single(), 'crawl job');
            for (let i = 0; i < pages.length; i += 200) {
                must(await admin.from('seo_crawl_pages').insert(pages.slice(i, i + 200).map((p) => ({
                    job_id: job.id, brand_id: website.brandId, website_id: website.id, url: p.url, final_url: p.finalUrl, depth: p.depth, http_status: p.status || null, redirect_chain: p.redirectChain,
                    title: p.title, meta_description: p.metaDescription?.slice(0, 400), canonical: p.canonical, robots_meta: p.robotsMeta, h1: p.h1, heading_outline: p.headings.slice(0, 60),
                    internal_links: p.internalLinks.length, external_links: p.externalLinks, images: p.images, images_missing_alt: p.imagesMissingAlt, structured_data_types: p.structuredDataTypes,
                    has_viewport: p.hasViewport, word_count: p.wordCount, content_hash: p.contentHash,
                }))), 'crawl pages');
            }
            return job.id;
        },
        async upsertFindings(website, source, findings, ref) {
            if (!findings.length) return 0;
            const existing = must(await admin.from('seo_findings').select('fingerprint').eq('website_id', website.id).in('fingerprint', findings.map((f) => f.fingerprint)), 'findings');
            const known = new Set(existing.map((e) => e.fingerprint));
            for (const f of findings) {
                if (known.has(f.fingerprint)) {
                    must(await admin.from('seo_findings').update({ last_seen_at: ref.observedAt, evidence: f.evidence, severity: f.severity, observed_at: ref.observedAt, crawl_job_id: ref.crawlJobId ?? null, sync_run_id: ref.syncRunId ?? null }).eq('website_id', website.id).eq('fingerprint', f.fingerprint), 'finding update');
                } else {
                    must(await admin.from('seo_findings').insert({ brand_id: website.brandId, website_id: website.id, source, check_id: f.checkId, kind: f.kind, subject_url: f.subjectUrl, severity: f.severity, confidence: f.confidence, title: f.title, evidence: f.evidence, recommendation: f.recommendation, suggested_task: f.suggestedTask, observed_at: ref.observedAt, crawl_job_id: ref.crawlJobId ?? null, sync_run_id: ref.syncRunId ?? null, fingerprint: f.fingerprint }), 'finding insert');
                }
            }
            return findings.length - known.size;
        },
        async resolveUnseenFindings(websiteId, source, seen, at) {
            const open = must(await admin.from('seo_findings').select('id, fingerprint').eq('website_id', websiteId).eq('source', source).eq('status', 'open'), 'findings');
            const ids = open.filter((f) => !seen.includes(f.fingerprint)).map((f) => f.id);
            if (ids.length) must(await admin.from('seo_findings').update({ status: 'resolved', last_seen_at: at }).in('id', ids), 'findings resolve');
            return ids.length;
        },
        // ── Google (OAuth state, metrics) ──
        async saveOAuthState(st) {
            must(await admin.from('integration_oauth_states').insert({ state_hash: st.stateHash, provider: st.provider, website_id: st.websiteId, brand_id: st.brandId, user_id: st.userId, encrypted_verifier: st.encryptedVerifier, redirect_uri: st.redirectUri, expires_at: st.expiresAt }), 'oauth state');
        },
        async loadOAuthState(stateHash) {
            const r = must(await admin.from('integration_oauth_states').select('*').eq('state_hash', stateHash).maybeSingle(), 'oauth state');
            return r && { id: r.id, stateHash: r.state_hash, provider: r.provider, userId: r.user_id, websiteId: r.website_id, redirectUri: r.redirect_uri, expiresAt: r.expires_at, consumedAt: r.consumed_at, encryptedVerifier: r.encrypted_verifier };
        },
        async consumeOAuthState(id) {
            const r = must(await admin.from('integration_oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', id).is('consumed_at', null).select('id'), 'oauth consume');
            return r.length === 1;
        },
        async encrypt(scope, value) { return encryptSecret(await keyPromise, scope, value); },
        async decrypt(scope, blob) { return decryptSecret(await keyPromise, scope, blob); },
        async integrationConfig(integrationId) {
            const r = must(await admin.from('integrations').select('external_property_id, config').eq('id', integrationId).single(), 'integration');
            return { externalPropertyId: r.external_property_id, config: r.config ?? {} };
        },
        async upsertGa4Rows(integration, website, propertyId, rows, fetchedAt) {
            for (let i = 0; i < rows.length; i += 1000) {
                must(await admin.from('ga4_metric_rows').upsert(rows.slice(i, i + 1000).map((r) => ({
                    integration_id: integration.id, brand_id: website.brandId, website_id: website.id, property_id: propertyId, metric_date: r.date, dimension: r.dimension, dimension_value: r.dimensionValue,
                    active_users: r.activeUsers, total_users: r.totalUsers, sessions: r.sessions, engaged_sessions: r.engagedSessions, engagement_rate: r.engagementRate,
                    screen_page_views: r.screenPageViews, event_count: r.eventCount, key_events: r.keyEvents, fetched_at: fetchedAt,
                })), { onConflict: 'website_id,property_id,metric_date,dimension,dimension_value' }), 'ga4 rows');
            }
            return rows.length;
        },
        async upsertGscRows(integration, website, siteUrl, rows, fetchedAt) {
            for (let i = 0; i < rows.length; i += 1000) {
                must(await admin.from('gsc_metric_rows').upsert(rows.slice(i, i + 1000).map((r) => ({
                    integration_id: integration.id, brand_id: website.brandId, website_id: website.id, site_url: siteUrl, metric_date: r.date, dimension: r.dimension, dimension_value: r.dimensionValue,
                    clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, data_state: r.dataState, fetched_at: fetchedAt,
                })), { onConflict: 'website_id,site_url,metric_date,dimension,dimension_value' }), 'gsc rows');
            }
            return rows.length;
        },
    };
}
