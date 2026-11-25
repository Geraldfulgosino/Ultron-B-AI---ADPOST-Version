import type { ID, Integration, SeoInsight } from '@/domain/types';
import type { AnalyticsApi, InsightsApi, IntegrationsApi, Kpi, ReportsApi } from '../contracts';
import { addDays, breakdownTotals, buildReport, dailySeries, delta, generateInsightCandidates, latestDate, previousWindow, queryMovers, totals } from '@/domain/analytics';
import { AccessDeniedError, assertValid, NotAvailableError, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import { byClientId, type Scope } from './scope';
import { emitAutomationEvent } from './automation';
import { can, effectiveRole, hasClientPermission } from '../access';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateRange(from: string, to: string): void {
    assertValid({
        from: !DATE.test(from) && 'Start date must be YYYY-MM-DD.',
        to: (!DATE.test(to) && 'End date must be YYYY-MM-DD.') || (from > to && 'Start date must be before end date.') || (DATE.test(from) && DATE.test(to) && (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366 && 'Date range cannot exceed one year.'),
    });
}

/** Read-side helper: every list respects brand + client-role scoping. */
function visible(scope: Scope, brandId: ID) {
    const opts = { clientKey: byClientId };
    return {
        websites: () => scope.rows('websites', brandId, opts),
        metrics: () => scope.rows('dailyMetrics', brandId, opts),
        queries: () => scope.rows('searchQueries', brandId, opts),
        pages: () => scope.rows('landingPages', brandId, opts),
        integrations: () => scope.rows('integrations', brandId, opts),
        insights: () => scope.rows('seoInsights', brandId, opts),
        audits: () => scope.rows('siteAudits', brandId, opts),
        /** Staff see tasks; Client Users get none here (tasks are not client-readable rows). */
        tasks: () => scope.rows('tasks', brandId, { capability: 'read' }),
        clients: () => scope.rows('clients', brandId, { clientKey: (c) => c.id }),
    };
}

/** Website must exist in this brand and be visible to the user (client scoping). */
function assertWebsite(scope: Scope, brandId: ID, websiteId: string | null | undefined): void {
    if (!websiteId) return;
    if (!visible(scope, brandId).websites().some((w) => w.id === websiteId)) throw new ValidationError({ websiteId: 'Choose a website from this brand.' });
}

const kpi = (current: number, previous: number): Kpi => ({ current, previous, delta: delta(current, previous) });

export function localAnalytics(scope: Scope): AnalyticsApi {
    return {
        async dataRange(brandId) {
            const metrics = visible(scope, brandId).metrics();
            if (!metrics.length) return null;
            let from = metrics[0]!.date;
            for (const m of metrics) if (m.date < from) from = m.date;
            return { from, to: latestDate(metrics)! };
        },

        async dashboard(brandId, options = {}) {
            const days = options.days ?? 28;
            assertValid({ days: (!Number.isInteger(days) || days < 1 || days > 366) && 'Choose between 1 and 366 days.' });
            assertWebsite(scope, brandId, options.websiteId);
            const v = visible(scope, brandId);
            const site = <R extends { websiteId: string }>(r: R) => !options.websiteId || r.websiteId === options.websiteId;
            const websites = v.websites();
            const metrics = v.metrics().filter(site);
            const integrations = v.integrations().filter(site);
            const insights = v.insights().filter(site);
            const end = latestDate(metrics);
            const window = end ? { from: addDays(end, -(days - 1)), to: end, days } : null;
            const inWindow = window ? metrics.filter((m) => m.date >= window.from && m.date <= window.to) : [];
            const cur = totals(inWindow);
            const prevW = window ? previousWindow(window.from, window.to) : null;
            const prev = totals(prevW ? metrics.filter((m) => m.date >= prevW.from && m.date <= prevW.to) : []);
            const siteName = new Map(websites.map((w) => [w.id, w.name]));
            const demo = new Set(websites.filter((w) => w.isDemo).map((w) => w.id));

            return {
                counts: {
                    clients: v.clients().length,
                    websites: options.websiteId ? 1 : websites.length,
                    integrationsConnected: integrations.filter((i) => i.status === 'connected').length,
                    integrationsError: integrations.filter((i) => i.status === 'error').length,
                    integrationsSimulated: integrations.filter((i) => i.simulated).length,
                    insightsPending: insights.filter((i) => i.status === 'pending').length,
                },
                window,
                simulated: inWindow.some((m) => demo.has(m.websiteId)),
                kpis: {
                    sessions: kpi(cur.sessions, prev.sessions),
                    conversions: kpi(cur.conversions, prev.conversions),
                    clicks: kpi(cur.clicks, prev.clicks),
                    impressions: kpi(cur.impressions, prev.impressions),
                    activeUsers: kpi(cur.users, prev.users),
                    engagementRate: cur.engagementRate === null ? null : kpi(cur.engagementRate, prev.engagementRate ?? 0),
                    ctr: kpi(cur.ctr, prev.ctr),
                    avgPosition: kpi(cur.avgPosition, prev.avgPosition),
                },
                sessionsTrend: dailySeries(inWindow, 'sessions'),
                clicksTrend: dailySeries(inWindow, 'clicks'),
                impressionsTrend: dailySeries(inWindow, 'impressions'),
                channels: breakdownTotals(inWindow, 'source'),
                devices: breakdownTotals(inWindow, 'device'),
                recentInsights: insights.filter((i) => i.status !== 'dismissed').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
                integrations: integrations.map((i) => ({ ...i, websiteName: siteName.get(i.websiteId) ?? '' })),
            };
        },

        async seoOverview(brandId, filters) {
            validateRange(filters.from, filters.to);
            assertWebsite(scope, brandId, filters.websiteId);
            const v = visible(scope, brandId);
            const site = <R extends { websiteId: string }>(r: R) => !filters.websiteId || r.websiteId === filters.websiteId;
            const metrics = v.metrics().filter(site);
            const inRange = metrics.filter((m) => m.date >= filters.from && m.date <= filters.to);
            const pw = previousWindow(filters.from, filters.to);
            const prev = totals(metrics.filter((m) => m.date >= pw.from && m.date <= pw.to));
            const t = totals(inRange);
            const report = buildReport(
                { metrics, queries: v.queries(), pages: v.pages(), websites: v.websites(), clientNames: new Map(), insights: [] },
                { from: filters.from, to: filters.to, websiteId: filters.websiteId ?? null, source: 'all' },
            );
            const queryPos = new Map<string, { sum: number; n: number }>();
            for (const q of v.queries().filter(site)) {
                if (q.date > filters.to || addDays(q.date, 6) < filters.from) continue;
                const a = queryPos.get(q.query) ?? { sum: 0, n: 0 };
                a.sum += q.position;
                a.n++;
                queryPos.set(q.query, a);
            }
            const demo = new Set(v.websites().filter((w) => w.isDemo).map((w) => w.id));
            return {
                simulated: inRange.some((m) => demo.has(m.websiteId)),
                searchDevices: breakdownTotals(inRange, 'searchDevice'),
                searchCountries: breakdownTotals(inRange, 'searchCountry'),
                movers: queryMovers(v.queries().filter(site), filters.from, filters.to),
                filters: { from: filters.from, to: filters.to, websiteId: filters.websiteId ?? null },
                totals: { sessions: t.sessions, conversions: t.conversions, clicks: t.clicks, impressions: t.impressions, ctr: t.ctr, avgPosition: t.avgPosition },
                previous: { sessions: prev.sessions, clicks: prev.clicks, impressions: prev.impressions, conversions: prev.conversions },
                clicksTrend: dailySeries(inRange, 'clicks'),
                sessionsTrend: dailySeries(inRange, 'sessions'),
                topQueries: report.topQueries.map((q) => {
                    const p = queryPos.get(q.query);
                    return { ...q, ctr: q.impressions ? q.clicks / q.impressions : 0, position: p ? p.sum / p.n : 0 };
                }),
                topPages: report.topPages.map((p) => ({ ...p, conversionRate: p.sessions ? p.conversions / p.sessions : 0 })),
            };
        },
    };
}

export function localIntegrations(scope: Scope): IntegrationsApi {
    const { db } = scope;
    const withSite = (i: Integration) => ({ ...i, websiteName: db.find('websites', i.websiteId)?.name ?? '' });

    return {
        async list(brandId) {
            return scope.rows('integrations', brandId, { clientKey: byClientId }).map(withSite);
        },

        async completeGoogleAuthorization() {
            throw new NotAvailableError('Google sign-in', 'in local mode: it needs Supabase and the integration-google Edge Function');
        },

        async connect(brandId, websiteId, provider) {
            scope.require(brandId, 'admin');
            const site = db.all('websites').find((w) => w.id === websiteId && w.brandId === brandId);
            assertValid({ websiteId: !site && 'Choose a website from this brand.' });
            const existing = db.all('integrations').find((i) => i.websiteId === websiteId && i.provider === provider);
            if (existing && existing.status !== 'disconnected') throw new ValidationError({ provider: 'This website already has that integration.' });
            if (existing) db.delete('integrations', (i) => i.id === existing.id);
            const row: Integration = {
                id: newId('int'), brandId, clientId: site!.clientId, websiteId, provider, status: 'pending',
                externalAccountName: null, externalPropertyName: null, lastSyncedAt: null,
                lastErrorMessage: 'Google OAuth runs server-side and is available after Supabase integration (Phase 17).',
                createdAt: db.nowIso(),
            };
            db.insert('integrations', row);
            scope.audit(brandId, 'integration.connect_started', 'integration', row.id);
            return structuredClone(row);
        },

        async sync(brandId, id) {
            scope.require(brandId, 'write');
            const row = scope.owned('integrations', brandId, id, 'Integration');
            if (row.status === 'pending' || row.status === 'disconnected') throw new ValidationError({ status: 'Connect this integration before syncing.' });
            // Simulated: no external API call. Marks the sync as fresh.
            if (row.simulated) {
                // Demo connection: records a simulated attempt; the synthetic dataset is unchanged and no provider is contacted.
                // A simulated failing connection keeps failing, so the demo can show error handling.
                const failing = row.status === 'error';
                const event = { at: db.nowIso(), ok: !failing, message: failing ? row.lastErrorMessage ?? 'Simulated failure.' : 'Simulated sync: synthetic rows refreshed locally. No provider request was sent.' };
                const updated = db.patch('integrations', id, failing ? { syncHistory: [event, ...(row.syncHistory ?? [])].slice(0, 10) } : { status: 'connected', lastSyncedAt: event.at, lastErrorMessage: null, syncHistory: [event, ...(row.syncHistory ?? [])].slice(0, 10) });
                scope.audit(brandId, 'integration.synced_simulated', 'integration', id);
                return structuredClone(updated);
            }
            const updated = db.patch('integrations', id, { status: 'connected', lastSyncedAt: db.nowIso(), lastErrorMessage: null });
            scope.audit(brandId, 'integration.synced', 'integration', id);
            return structuredClone(updated);
        },

        async disconnect(brandId, id) {
            scope.require(brandId, 'admin');
            scope.owned('integrations', brandId, id, 'Integration');
            const updated = db.patch('integrations', id, { status: 'disconnected', externalAccountName: null, lastErrorMessage: null });
            scope.audit(brandId, 'integration.disconnected', 'integration', id);
            return structuredClone(updated);
        },

        async remove(brandId, id) {
            scope.require(brandId, 'admin');
            const row = scope.owned('integrations', brandId, id, 'Integration');
            if (row.status === 'connected' || row.status === 'error') throw new ValidationError({ status: 'Disconnect the integration before removing it.' });
            db.delete('integrations', (i) => i.id === id);
            scope.audit(brandId, 'integration.removed', 'integration', id);
        },
    };
}

export function localInsights(scope: Scope): InsightsApi {
    const { db } = scope;
    const opts = { clientKey: byClientId };

    return {
        async list(brandId, filters = {}) {
            return scope
                .rows('seoInsights', brandId, opts)
                .filter((i) =>
                    (!filters.status || (filters.status === 'open' ? i.status === 'pending' || i.status === 'reviewed' : i.status === filters.status)) &&
                    (!filters.websiteId || i.websiteId === filters.websiteId) &&
                    (!filters.type || i.type === filters.type) &&
                    (!filters.severity || i.severity === filters.severity),
                )
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title));
        },

        async get(brandId, id) {
            const row = scope.row('seoInsights', brandId, id, { ...opts, label: 'Insight' });
            const site = db.find('websites', row.websiteId);
            const agent = row.assignedAgentId ? db.find('agentInstances', row.assignedAgentId) : undefined;
            // The related task is shown only to users who can read tasks (staff); Client Users see no task link.
            const task = row.taskId && can(scope.facts(brandId), 'staff') ? db.find('tasks', row.taskId) : undefined;
            return {
                ...row, websiteName: site?.name ?? '', domain: site?.domain ?? '',
                assignedAgentName: agent && agent.brandId === brandId ? agent.displayName : null,
                task: task && task.brandId === brandId ? { id: task.id, title: task.title, status: task.status } : null,
            };
        },

        async generate(brandId) {
            scope.require(brandId, 'write');
            const v = visible(scope, brandId);
            const candidates = generateInsightCandidates({
                websites: v.websites(), metrics: v.metrics(), queries: v.queries(), pages: v.pages(), integrations: v.integrations(), now: db.now(),
            });
            // Do not re-raise a subject that is still open or was dismissed (legacy dedupe).
            const blocked = new Set(db.all('seoInsights').filter((i) => i.brandId === brandId && i.status !== 'approved').map((i) => i.subject));
            const rows: SeoInsight[] = candidates
                .filter((c) => !blocked.has(c.subject))
                .map((c) => ({
                    id: newId('ins'), brandId, clientId: c.clientId, websiteId: c.websiteId, type: c.type, severity: c.severity, status: 'pending',
                    subject: c.subject, title: c.title, summary: c.summary, recommendation: c.recommendation, evidence: c.evidence, source: 'rules',
                    reviewedBy: null, reviewedAt: null, reviewNotes: null, createdAt: db.nowIso(),
                }));
            if (rows.length) db.insertMany('seoInsights', rows);
            scope.audit(brandId, 'insights.generated', 'brand', brandId);
            return { created: rows.length };
        },

        async setStatus(brandId, id, status, notes) {
            scope.require(brandId, 'write');
            const row = scope.owned('seoInsights', brandId, id, 'Insight');
            if (status === row.status) throw new ValidationError({ status: `Insight is already ${status}.` });
            const updated = db.patch('seoInsights', id, {
                status,
                reviewedBy: status === 'pending' ? null : scope.userId,
                reviewedAt: status === 'pending' ? null : db.nowIso(),
                reviewNotes: notes === undefined ? row.reviewNotes : notes?.trim() || null,
            });
            scope.audit(brandId, `insight.${status === 'pending' ? 'reopened' : status}`, 'seo_insight', id);
            if (status === 'approved') emitAutomationEvent(db, brandId, 'insight.approved');
            return structuredClone(updated);
        },

        async bulkSetStatus(brandId, ids, status) {
            scope.require(brandId, 'write');
            let updated = 0;
            for (const id of new Set(ids)) {
                const row = db.find('seoInsights', id);
                if (!row || row.brandId !== brandId) throw new NotFoundError('Insight'); // all-or-nothing on foreign ids
            }
            for (const id of new Set(ids)) {
                const row = db.find('seoInsights', id)!;
                if (row.status !== 'pending' && !(status === 'dismissed' && row.status === 'reviewed')) continue;
                db.patch('seoInsights', id, { status, reviewedBy: scope.userId, reviewedAt: db.nowIso() });
                updated++;
            }
            scope.audit(brandId, `insights.bulk_${status}`, 'brand', brandId);
            return { updated };
        },
    };
}

export function localReports(scope: Scope): ReportsApi {
    const { db } = scope;
    return {
        async preview(brandId, filters) {
            validateRange(filters.from, filters.to);
            assertValid({ source: !['all', 'ga4', 'gsc'].includes(filters.source) && 'Unknown source.' });
            assertWebsite(scope, brandId, filters.websiteId);
            const v = visible(scope, brandId);
            return buildReport(
                {
                    metrics: v.metrics(), queries: v.queries(), pages: v.pages(), websites: v.websites(),
                    clientNames: new Map(v.clients().map((c) => [c.id, c.name])), insights: v.insights(),
                    audits: v.audits(), tasks: v.tasks(),
                },
                filters,
            );
        },

        async recordExport(brandId, format) {
            const f = scope.facts(brandId);
            // Client Users need the explicit download_reports permission (read-only by default).
            if (effectiveRole(f) === 'client' && !hasClientPermission(f, 'download_reports')) throw new AccessDeniedError('Report downloads are not enabled for your account.');
            scope.audit(brandId, `report.exported_${format}`, 'brand', brandId);
            emitAutomationEvent(db, brandId, 'report.generated');
        },
    };
}
