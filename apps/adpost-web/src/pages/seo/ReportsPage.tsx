import { Download, FileText } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, SimulatedBadge, SimulatedNotice } from '@/components/ui';
import { KpiTile } from '@/components/charts/KpiTile';
import { delta } from '@/domain/analytics';
import { PriorityBadge } from './AuditSections';
import { TrendChart } from '@/components/charts/TrendChart';
import { ReportFiltersBar } from '@/components/filters/ReportFilters';
import { useAction, useBrand, useQuery } from '@/app/backend';
import { reportToCsv, type ReportFilters } from '@/domain/analytics';
import { executiveSummary, reportToPdf } from '@/domain/pdf';
import { downloadBlob, reportFilename } from '@/lib/download';
import { formatNumber } from '@/lib/utils';
import { INSIGHT_STATUS, SEVERITY } from './labels';
import { useReportFilters } from './useReportFilters';

export function ReportsPage() {
    const { brand, role, clientPermissions } = useBrand();
    // Client Users download reports only with the explicit permission (enforced again by the data layer).
    const canDownload = role !== 'client' || clientPermissions.includes('download_reports');
    const { filters, setFilters, dataEnd, websites } = useReportFilters(true);
    const f: ReportFilters | null = filters ? { from: filters.from, to: filters.to, websiteId: filters.websiteId, source: filters.source ?? 'all' } : null;
    const q = useQuery((api) => (f ? api.reports.preview(brand.id, f) : Promise.resolve(null)), [brand.id, f?.from, f?.to, f?.websiteId, f?.source]);
    const record = useAction((api, format: 'csv' | 'pdf') => api.reports.recordExport(brand.id, format));

    const exportAs = async (format: 'csv' | 'pdf') => {
        const report = q.data;
        if (!report) return;
        const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const name = reportFilename(brand.slug, report.filters.from, report.filters.to, format);
        if (format === 'csv') downloadBlob(reportToCsv(report, brand.name, generatedAt), name, 'text/csv;charset=utf-8');
        else downloadBlob(reportToPdf(report, brand.name, generatedAt) as Uint8Array<ArrayBuffer>, name, 'application/pdf');
        await record.run(format);
    };

    const r = q.data;
    return (
        <Page
            title="Reports"
            description="Client-ready performance report preview and exports"
            actions={r && canDownload && (
                <>
                    <Button variant="secondary" onClick={() => void exportAs('csv')}><Download className="h-4 w-4" aria-hidden="true" /> Export CSV</Button>
                    <Button onClick={() => void exportAs('pdf')}><FileText className="h-4 w-4" aria-hidden="true" /> Export PDF</Button>
                </>
            )}
        >
            {filters && <ReportFiltersBar value={filters} onChange={setFilters} dataEnd={dataEnd} websites={websites} showSource />}
            {record.error ? <ErrorState error={record.error} /> : null}
            {q.loading || !filters ? (
                <LoadingState />
            ) : q.error ? (
                <ErrorState error={q.error} onRetry={q.reload} />
            ) : !r ? null : !r.hasData ? (
                <EmptyState title="No report data for the selected range" description="Try a different date range or website. You can still export an empty report." />
            ) : (
                <>
                    {r.simulated && <SimulatedNotice what="report data (exports carry a DEMO / SYNTHETIC DATA notice)" />}
                    <Card>
                        <CardHeader><CardTitle>Executive summary</CardTitle></CardHeader>
                        <CardContent><p className="text-sm text-fg-secondary">{executiveSummary(r)}</p></CardContent>
                    </Card>
                    <p className="text-xs text-fg-muted">Compared with the previous period: {r.previous.from} to {r.previous.to}.</p>
                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                        {r.filters.source !== 'ga4' && <KpiTile label="GSC clicks" value={r.summary.gscClicks} delta={delta(r.summary.gscClicks, r.previous.gscClicks)} period="previous period" />}
                        {r.filters.source !== 'ga4' && <KpiTile label="GSC impressions" value={r.summary.gscImpressions} delta={delta(r.summary.gscImpressions, r.previous.gscImpressions)} period="previous period" />}
                        {r.filters.source !== 'ga4' && <KpiTile label="GSC CTR" value={r.search.ctr} format="percent" />}
                        {r.filters.source !== 'ga4' && <KpiTile label="Avg. position (average)" value={r.search.avgPosition} format="decimal" />}
                        {r.filters.source !== 'gsc' && <KpiTile label="GA4 sessions" value={r.summary.ga4Sessions} delta={delta(r.summary.ga4Sessions, r.previous.ga4Sessions)} period="previous period" />}
                        {r.filters.source !== 'gsc' && <KpiTile label="GA4 key events" value={r.summary.ga4Conversions} delta={delta(r.summary.ga4Conversions, r.previous.ga4Conversions)} period="previous period" />}
                        {r.filters.source !== 'gsc' && <KpiTile label="GA4 active users" value={r.ga4.activeUsers} />}
                        {r.filters.source !== 'gsc' && r.ga4.engagementRate !== null && <KpiTile label="GA4 engagement rate" value={r.ga4.engagementRate} format="percent" />}
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                        {r.filters.source !== 'ga4' && <TrendChart title="GSC clicks per day" data={r.trends.gscClicks} />}
                        {r.filters.source !== 'ga4' && <TrendChart title="GSC impressions per day" data={r.trends.gscImpressions} />}
                        {r.filters.source !== 'gsc' && <TrendChart title="GA4 sessions per day" data={r.trends.ga4Sessions} />}
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                        {r.filters.source !== 'ga4' && (
                            <Card>
                                <CardHeader><CardTitle>Top queries</CardTitle></CardHeader>
                                <CardContent>
                                    <ol className="space-y-1 text-sm">
                                        {r.topQueries.map((x) => <li key={x.query} className="flex justify-between gap-2"><span className="truncate text-fg-secondary">{x.query}</span><span className="tabular-nums text-fg">{formatNumber(x.clicks)}</span></li>)}
                                    </ol>
                                </CardContent>
                            </Card>
                        )}
                        {r.filters.source !== 'gsc' && (
                            <Card>
                                <CardHeader><CardTitle>Top pages</CardTitle></CardHeader>
                                <CardContent>
                                    <ol className="space-y-1 text-sm">
                                        {r.topPages.map((x) => <li key={x.path} className="flex justify-between gap-2"><span className="truncate text-fg-secondary">{x.path}</span><span className="tabular-nums text-fg">{formatNumber(x.sessions)}</span></li>)}
                                    </ol>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                    <Card>
                        <CardHeader><CardTitle>SEO insights</CardTitle></CardHeader>
                        <CardContent>
                            {r.insights.length ? (
                                <ul className="space-y-2">
                                    {r.insights.map((i) => (
                                        <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                                            <Badge variant={SEVERITY[i.severity].variant}>{SEVERITY[i.severity].label}</Badge>
                                            <Badge variant={INSIGHT_STATUS[i.status].variant}>{INSIGHT_STATUS[i.status].label}</Badge>
                                            <span className="text-fg-secondary">{i.title}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-fg-muted">No open insights.</p>
                            )}
                        </CardContent>
                    </Card>
                    <div className="grid gap-4 lg:grid-cols-2">
                        {r.technical && (
                            <Card>
                                <CardHeader className="flex items-center justify-between gap-2"><CardTitle>Technical findings</CardTitle>{r.technical.simulated && <SimulatedBadge />}</CardHeader>
                                <CardContent>
                                    <p className="text-sm text-fg-secondary">Health score <span className="font-semibold text-fg tabular-nums">{r.technical.score}/100</span> from {r.technical.pagesCrawled} pages on {r.technical.date}{r.technical.simulated ? ' (simulated audit, no crawl ran)' : ''}.</p>
                                    <ul className="mt-2 space-y-1 text-sm">
                                        {r.technical.lines.map((l) => <li key={l.label} className="flex justify-between gap-2"><span className="text-fg-secondary">{l.label} · {l.count} pages</span><span className="tabular-nums text-fg">−{l.deduction}</span></li>)}
                                    </ul>
                                </CardContent>
                            </Card>
                        )}
                        <Card>
                            <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
                            <CardContent>
                                {r.recommendations.length ? (
                                    <ol className="space-y-2 text-sm">
                                        {r.recommendations.map((x) => <li key={x.title}><span className="flex flex-wrap items-center gap-2"><PriorityBadge priority={x.priority} /><span className="font-medium text-fg">{x.title}</span></span><span className="text-xs text-fg-muted">{x.recommendation}</span></li>)}
                                    </ol>
                                ) : <p className="text-sm text-fg-muted">No open recommendations.</p>}
                            </CardContent>
                        </Card>
                    </div>
                    {r.tasks.length > 0 && (
                        <Card>
                            <CardHeader><CardTitle>Tasks and action items</CardTitle></CardHeader>
                            <CardContent>
                                <ul className="divide-y divide-line-subtle text-sm">
                                    {r.tasks.map((t) => <li key={t.title} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="text-fg">{t.title}</span><span className="flex gap-2 text-xs text-fg-muted"><PriorityBadge priority={t.priority} /><Badge variant="gray">{t.status.replace('_', ' ')}</Badge>{t.dueDate && <span>due {t.dueDate}</span>}</span></li>)}
                                </ul>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </Page>
    );
}
