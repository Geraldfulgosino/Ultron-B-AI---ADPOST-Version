import { Download, FileText } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, StatCard } from '@/components/ui';
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
    const { brand } = useBrand();
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
            actions={r && (
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
                    <Card>
                        <CardHeader><CardTitle>Executive summary</CardTitle></CardHeader>
                        <CardContent><p className="text-sm text-gray-700">{executiveSummary(r)}</p></CardContent>
                    </Card>
                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                        {r.filters.source !== 'ga4' && <StatCard label="GSC clicks" value={formatNumber(r.summary.gscClicks)} />}
                        {r.filters.source !== 'ga4' && <StatCard label="GSC impressions" value={formatNumber(r.summary.gscImpressions)} />}
                        {r.filters.source !== 'gsc' && <StatCard label="GA4 sessions" value={formatNumber(r.summary.ga4Sessions)} />}
                        {r.filters.source !== 'gsc' && <StatCard label="GA4 conversions" value={formatNumber(r.summary.ga4Conversions)} />}
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
                                        {r.topQueries.map((x) => <li key={x.query} className="flex justify-between gap-2"><span className="truncate text-gray-700">{x.query}</span><span className="tabular-nums text-gray-900">{formatNumber(x.clicks)}</span></li>)}
                                    </ol>
                                </CardContent>
                            </Card>
                        )}
                        {r.filters.source !== 'gsc' && (
                            <Card>
                                <CardHeader><CardTitle>Top pages</CardTitle></CardHeader>
                                <CardContent>
                                    <ol className="space-y-1 text-sm">
                                        {r.topPages.map((x) => <li key={x.path} className="flex justify-between gap-2"><span className="truncate text-gray-700">{x.path}</span><span className="tabular-nums text-gray-900">{formatNumber(x.sessions)}</span></li>)}
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
                                            <span className="text-gray-700">{i.title}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-gray-500">No open insights.</p>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </Page>
    );
}
