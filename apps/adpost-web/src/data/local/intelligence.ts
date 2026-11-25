import type { ID } from '@/domain/types';
import type { IntelligenceApi } from '../contracts';
import { compareWebsites, scoreOpportunities, websiteAnomalies } from '@/domain/intelligence';
import { healthScore, healthTrend, issueDistribution } from '@/domain/audit';
import type { AuditOverview } from '../contracts';
import { INSIGHT_TYPE_LABELS_PLAIN } from '@/domain/insightText';
import { assertValid, ValidationError } from '../errors';
import { byClientId, type Scope } from './scope';
import { localChat } from './chat';
import { assertFeature } from './entitlements';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localIntelligence(scope: Scope): IntelligenceApi {
    const { db } = scope;
    const rows = (brandId: ID) => ({
        websites: scope.rows('websites', brandId, { clientKey: byClientId }),
        metrics: scope.rows('dailyMetrics', brandId, { clientKey: byClientId }),
        queries: scope.rows('searchQueries', brandId, { clientKey: byClientId }),
        audits: scope.rows('siteAudits', brandId, { clientKey: byClientId }),
        insights: scope.rows('seoInsights', brandId, { clientKey: byClientId }),
    });

    return {
        async overview(brandId, f) {
            assertFeature(db, brandId, 'intelligence');
            assertValid({ from: !DATE.test(f.from) && 'Start date must be YYYY-MM-DD.', to: (!DATE.test(f.to) && 'End date must be YYYY-MM-DD.') || (f.from > f.to && 'Start date must be before end date.') });
            const r = rows(brandId);
            if (f.websiteId && !r.websites.some((w) => w.id === f.websiteId)) throw new ValidationError({ websiteId: 'Choose a website from this brand.' });
            const sites = f.websiteId ? r.websites.filter((w) => w.id === f.websiteId) : r.websites;
            const ids = new Set(sites.map((w) => w.id));
            const audits: AuditOverview[] = sites.flatMap((w) => {
                const own = r.audits.filter((a) => a.websiteId === w.id && a.date <= f.to).sort((a, b) => a.date.localeCompare(b.date));
                const last = own[own.length - 1];
                if (!last) return [];
                const h = healthScore(last.issues, last.pagesCrawled);
                return [{ websiteId: w.id, date: last.date, simulated: last.simulated, pagesCrawled: last.pagesCrawled, score: h.score, formula: h.formula, lines: h.lines, distribution: issueDistribution(last.issues), trend: healthTrend(own), lab: last.lab, competitors: last.competitors }];
            });
            const open = r.insights.filter((i) => ids.has(i.websiteId) && (i.status === 'pending' || i.status === 'reviewed' || i.status === 'approved'));
            const prio = (p?: string) => ({ urgent: 0, high: 1, medium: 2, low: 3 })[p ?? 'medium'] ?? 2;
            const sev = { high: 0, medium: 1, low: 2 } as const;
            const demo = new Set(sites.filter((w) => w.isDemo).map((w) => w.id));
            return {
                audits,
                contentGaps: open.filter((i) => i.type === 'content_gap').sort((a, b) => prio(a.priority) - prio(b.priority)),
                recommendations: [...open].sort((a, b) => prio(a.priority) - prio(b.priority) || sev[a.severity] - sev[b.severity] || a.title.localeCompare(b.title)).slice(0, 8),
                simulated: r.metrics.some((m) => demo.has(m.websiteId) && m.date >= f.from && m.date <= f.to) || audits.some((a) => a.simulated),
                anomalies: websiteAnomalies(sites, r.metrics, f.from, f.to),
                opportunities: scoreOpportunities(r.queries.filter((q) => ids.has(q.websiteId)), f.from, f.to),
                comparison: compareWebsites(sites, r.metrics, f.from, f.to),
            };
        },

        async discussInsight(brandId, insightId) {
            const insight = scope.row('seoInsights', brandId, insightId, { clientKey: byClientId, label: 'Insight' });
            const manager = db.all('agentInstances').find((a) => a.brandId === brandId && a.templateKey === 'seo_manager');
            if (!manager) throw new ValidationError({ agent: 'This brand has no SEO Manager agent.' });
            const chat = localChat(scope);
            const c = await chat.createDirect(brandId, manager.id, `Insight: ${insight.title}`.slice(0, 120));
            const site = db.find('websites', insight.websiteId);
            await chat.send(brandId, c.id, {
                body: [
                    `Please review this ${INSIGHT_TYPE_LABELS_PLAIN[insight.type]} insight for ${site?.domain ?? 'our site'} and propose next steps.`,
                    `Title: ${insight.title}`,
                    `Summary: ${insight.summary}`,
                    `Evidence: ${Object.entries(insight.evidence).map(([k, v]) => `${k}=${v}`).join(', ')}`,
                ].join('\n'),
            });
            return { conversationId: c.id };
        },
    };
}
