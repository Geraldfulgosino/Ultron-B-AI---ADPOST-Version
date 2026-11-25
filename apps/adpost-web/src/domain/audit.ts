/**
 * Site-audit scoring. Pure and explainable: the score is always recomputed from the issue list,
 * so the dashboard, intelligence page, reports and agents can never disagree about it.
 */
import type { AuditCategory, AuditIssue, Severity, SiteAudit } from './types';

/** Points deducted per 1% of crawled pages affected, by severity. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 0.6, medium: 0.3, low: 0.1 };
/** No single issue can cost more than this many points. */
export const MAX_DEDUCTION_PER_ISSUE = 12;

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
    indexability: 'Indexability',
    on_page: 'On-page',
    links: 'Links',
    performance: 'Performance',
    structured_data: 'Structured data',
};

export interface ScoreLine {
    code: string;
    label: string;
    severity: Severity;
    count: number;
    /** Share of crawled pages affected (0-1). */
    share: number;
    deduction: number;
}

export interface HealthScore {
    score: number;
    lines: ScoreLine[];
    formula: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function healthScore(issues: readonly AuditIssue[], pagesCrawled: number): HealthScore {
    const pages = Math.max(1, pagesCrawled);
    const lines = issues
        .filter((i) => i.count > 0)
        .map((i) => {
            const share = Math.min(1, i.count / pages);
            const deduction = round1(Math.min(MAX_DEDUCTION_PER_ISSUE, share * 100 * SEVERITY_WEIGHT[i.severity]));
            return { code: i.code, label: i.label, severity: i.severity, count: i.count, share, deduction };
        })
        .sort((a, b) => b.deduction - a.deduction || a.code.localeCompare(b.code));
    const total = lines.reduce((s, l) => s + l.deduction, 0);
    return {
        score: Math.max(0, Math.round(100 - total)),
        lines,
        formula: `100 minus, for each issue, (% of pages affected × severity weight: high ${SEVERITY_WEIGHT.high}, medium ${SEVERITY_WEIGHT.medium}, low ${SEVERITY_WEIGHT.low}), capped at ${MAX_DEDUCTION_PER_ISSUE} points per issue.`,
    };
}

/** Affected-page counts per category (the issue-distribution chart). */
export function issueDistribution(issues: readonly AuditIssue[]): Array<{ category: AuditCategory; label: string; issues: number; pages: number }> {
    const by = new Map<AuditCategory, { issues: number; pages: number }>();
    for (const i of issues) {
        if (!i.count) continue;
        const a = by.get(i.category) ?? { issues: 0, pages: 0 };
        a.issues++;
        a.pages += i.count;
        by.set(i.category, a);
    }
    return (Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[])
        .filter((c) => by.has(c))
        .map((c) => ({ category: c, label: AUDIT_CATEGORY_LABELS[c], ...by.get(c)! }));
}

export function healthTrend(audits: readonly SiteAudit[]): Array<{ date: string; value: number }> {
    return [...audits].sort((a, b) => a.date.localeCompare(b.date)).map((a) => ({ date: a.date, value: healthScore(a.issues, a.pagesCrawled).score }));
}
