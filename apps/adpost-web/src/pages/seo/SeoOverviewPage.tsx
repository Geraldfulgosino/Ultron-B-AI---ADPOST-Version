import { Page } from '@/layouts/AppShell';
import { Card, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, Table, TBody, Td, Th, THead } from '@/components/ui';
import { KpiTile } from '@/components/charts/KpiTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { ReportFiltersBar } from '@/components/filters/ReportFilters';
import { useBrand, useQuery } from '@/app/backend';
import { delta } from '@/domain/analytics';
import { formatNumber, formatPercent } from '@/lib/utils';
import { useReportFilters } from './useReportFilters';

export function SeoOverviewPage() {
    const { brand } = useBrand();
    const { filters, setFilters, dataEnd, websites } = useReportFilters();
    const q = useQuery((api) => (filters ? api.analytics.seoOverview(brand.id, filters) : Promise.resolve(null)), [brand.id, filters?.from, filters?.to, filters?.websiteId]);

    return (
        <Page title="SEO Overview" description="Search and on-site performance from synced GA4 and Search Console data">
            {filters && <ReportFiltersBar value={filters} onChange={setFilters} dataEnd={dataEnd} websites={websites} />}
            {q.loading || !filters ? (
                <LoadingState />
            ) : q.error ? (
                <ErrorState error={q.error} onRetry={q.reload} />
            ) : !q.data || (!q.data.totals.sessions && !q.data.totals.impressions) ? (
                <EmptyState title="No data for this range" description="Pick another range or website, or connect integrations." />
            ) : (
                (() => {
                    const d = q.data;
                    return (
                        <>
                            <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                                <KpiTile label="Clicks" value={d.totals.clicks} delta={delta(d.totals.clicks, d.previous.clicks)} />
                                <KpiTile label="Impressions" value={d.totals.impressions} delta={delta(d.totals.impressions, d.previous.impressions)} />
                                <KpiTile label="CTR" value={d.totals.ctr} format="percent" />
                                <KpiTile label="Avg. position" value={d.totals.avgPosition} format="decimal" />
                                <KpiTile label="Sessions" value={d.totals.sessions} delta={delta(d.totals.sessions, d.previous.sessions)} />
                                <KpiTile label="Conversions" value={d.totals.conversions} delta={delta(d.totals.conversions, d.previous.conversions)} />
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                                <TrendChart title="Search clicks per day" data={d.clicksTrend} />
                                <TrendChart title="Sessions per day" data={d.sessionsTrend} />
                            </div>
                            <div className="grid gap-4 xl:grid-cols-2">
                                <Card>
                                    <CardHeader><CardTitle>Top queries</CardTitle></CardHeader>
                                    <Table className="border-0 shadow-none rounded-none">
                                        <THead><tr><Th>Query</Th><Th className="text-right">Clicks</Th><Th className="text-right">Impr.</Th><Th className="text-right">CTR</Th><Th className="text-right">Pos.</Th></tr></THead>
                                        <TBody>
                                            {d.topQueries.map((r) => (
                                                <tr key={r.query}>
                                                    <Td className="max-w-56 truncate">{r.query}</Td>
                                                    <Td className="text-right tabular-nums">{formatNumber(r.clicks)}</Td>
                                                    <Td className="text-right tabular-nums">{formatNumber(r.impressions)}</Td>
                                                    <Td className="text-right tabular-nums">{formatPercent(r.ctr)}</Td>
                                                    <Td className="text-right tabular-nums">{r.position.toFixed(1)}</Td>
                                                </tr>
                                            ))}
                                        </TBody>
                                    </Table>
                                </Card>
                                <Card>
                                    <CardHeader><CardTitle>Top landing pages</CardTitle></CardHeader>
                                    <Table className="border-0 shadow-none rounded-none">
                                        <THead><tr><Th>Page</Th><Th className="text-right">Sessions</Th><Th className="text-right">Conv.</Th><Th className="text-right">Conv. rate</Th></tr></THead>
                                        <TBody>
                                            {d.topPages.map((r) => (
                                                <tr key={r.path}>
                                                    <Td className="max-w-56 truncate">{r.path}</Td>
                                                    <Td className="text-right tabular-nums">{formatNumber(r.sessions)}</Td>
                                                    <Td className="text-right tabular-nums">{formatNumber(r.conversions)}</Td>
                                                    <Td className="text-right tabular-nums">{formatPercent(r.conversionRate, 2)}</Td>
                                                </tr>
                                            ))}
                                        </TBody>
                                    </Table>
                                </Card>
                            </div>
                        </>
                    );
                })()
            )}
        </Page>
    );
}
