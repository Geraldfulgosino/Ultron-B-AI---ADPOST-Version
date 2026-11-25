import { Link } from 'react-router';
import { Badge, Card, CardContent, CardHeader, CardTitle, SimulatedBadge, Table, TBody, Td, Th, THead } from '@/components/ui';
import { BarList } from '@/components/charts/BarList';
import { TrendChart } from '@/components/charts/TrendChart';
import type { AuditOverview } from '@/data/contracts';
import type { SeoInsight } from '@/domain/types';
import { INSIGHT_STATUS, INSIGHT_TYPE_LABELS, SEVERITY } from './labels';

const PRIORITY: Record<string, { label: string; variant: 'red' | 'yellow' | 'blue' | 'gray' }> = {
    urgent: { label: 'Urgent', variant: 'red' },
    high: { label: 'High priority', variant: 'yellow' },
    medium: { label: 'Medium priority', variant: 'blue' },
    low: { label: 'Low priority', variant: 'gray' },
};

export function PriorityBadge({ priority }: { priority?: string }) {
    const p = PRIORITY[priority ?? ''];
    return p ? <Badge variant={p.variant}>{p.label}</Badge> : null;
}

/** Site audit: score with its explanation, issue distribution, trend, lab metrics and competitors. */
export function AuditSection({ audit, siteName }: { audit: AuditOverview; siteName: string }) {
    const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    return (
        <>
            <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                    <CardHeader className="flex items-center justify-between gap-2">
                        <CardTitle>Site health: {siteName}</CardTitle>
                        {audit.simulated && <SimulatedBadge />}
                    </CardHeader>
                    <CardContent>
                        <p className="text-4xl font-semibold tabular-nums text-fg">{audit.score}<span className="text-base font-normal text-fg-muted">/100</span></p>
                        <p className="mt-1 text-xs text-fg-muted">
                            {audit.simulated ? 'Simulated audit' : 'Audit'} of {audit.pagesCrawled} pages on {audit.date}.{audit.simulated ? ' No crawl ran: demo findings.' : ''}
                        </p>
                        <p className="mt-3 text-xs text-fg-secondary"><span className="font-medium">How it is calculated:</span> {audit.formula}</p>
                    </CardContent>
                </Card>
                <div className="lg:col-span-2">
                    <TrendChart title={`Health score trend${audit.simulated ? ' (simulated)' : ''}`} data={audit.trend} />
                </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                    <CardHeader><CardTitle>Score deductions</CardTitle><p className="text-xs text-fg-muted">Every point removed from 100, by issue.</p></CardHeader>
                    <Table className="border-0 shadow-none rounded-none">
                        <THead><tr><Th>Issue</Th><Th>Severity</Th><Th className="text-right">Pages</Th><Th className="text-right">Points</Th></tr></THead>
                        <TBody>
                            {audit.lines.map((l) => (
                                <tr key={l.code}>
                                    <Td>{l.label}</Td>
                                    <Td><Badge variant={SEVERITY[l.severity].variant}>{SEVERITY[l.severity].label}</Badge></Td>
                                    <Td className="text-right tabular-nums">{l.count} <span className="text-xs text-fg-muted">({(l.share * 100).toFixed(0)}%)</span></Td>
                                    <Td className="text-right tabular-nums">−{l.deduction}</Td>
                                </tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
                <div className="grid gap-4">
                    <BarList title="Technical issue distribution" description="Affected pages per category in the latest audit." rows={audit.distribution.map((d) => ({ label: `${d.label} (${d.issues} issue types)`, value: d.pages }))} unit=" pages" />
                    <Card>
                        <CardHeader className="flex items-center justify-between gap-2"><CardTitle>Lab performance</CardTitle>{audit.simulated && <SimulatedBadge />}</CardHeader>
                        <CardContent>
                            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                {[['Mobile LCP', sec(audit.lab.mobileLcpMs), audit.lab.mobileLcpMs > 2500], ['Desktop LCP', sec(audit.lab.desktopLcpMs), audit.lab.desktopLcpMs > 2500], ['CLS', audit.lab.cls.toFixed(2), audit.lab.cls > 0.1], ['INP', `${audit.lab.inpMs} ms`, audit.lab.inpMs > 200]].map(([k, v, bad]) => (
                                    <div key={String(k)}>
                                        <dt className="text-xs text-fg-muted">{k}</dt>
                                        <dd className="tabular-nums text-fg">{v} <span className={`text-xs ${bad ? 'text-danger-strong' : 'text-success'}`}>{bad ? 'needs work' : 'good'}</span></dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="mt-2 text-xs text-fg-muted">Lab values, not field Core Web Vitals.{audit.simulated ? ' Simulated for the demo.' : ''}</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
            {audit.competitors.length > 0 && (
                <BarList
                    title={`Competitor comparison${audit.simulated ? ' (simulated)' : ''}`}
                    description="Visibility index (0–100) across the tracked queries. Competitors are fictitious demo sites on .example domains; no external keyword research ran."
                    rows={[...audit.competitors].sort((a, b) => b.visibility - a.visibility).map((c) => ({ label: `${c.name} · ${c.sharedKeywords} shared queries`, value: c.visibility, emphasis: c.isSelf }))}
                    max={100}
                />
            )}
        </>
    );
}

export function InsightList({ title, description, insights, base }: { title: string; description: string; insights: SeoInsight[]; base: string }) {
    return (
        <Card>
            <CardHeader><CardTitle>{title}</CardTitle><p className="text-xs text-fg-muted">{description}</p></CardHeader>
            <CardContent>
                {insights.length ? (
                    <ol className="space-y-2">
                        {insights.map((i) => (
                            <li key={i.id} className="rounded-lg border border-line-subtle p-2">
                                <Link to={`${base}/seo/insights/${i.id}`} className="text-sm font-medium text-fg hover:text-accent-strong">{i.title}</Link>
                                <p className="mt-0.5 text-xs text-fg-muted">{i.recommendation}</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    <PriorityBadge priority={i.priority} />
                                    <Badge variant={SEVERITY[i.severity].variant}>{SEVERITY[i.severity].label}</Badge>
                                    <Badge variant="gray">{i.category ?? INSIGHT_TYPE_LABELS[i.type]}</Badge>
                                    <Badge variant={INSIGHT_STATUS[i.status].variant}>{INSIGHT_STATUS[i.status].label}</Badge>
                                    {i.simulated && <SimulatedBadge />}
                                </div>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="text-sm text-fg-muted">Nothing open.</p>
                )}
            </CardContent>
        </Card>
    );
}
