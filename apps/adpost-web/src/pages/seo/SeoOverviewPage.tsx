import { Page } from '@/layouts/AppShell';
import { Card, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, SimulatedNotice, Table, TBody, Td, Th, THead } from '@/components/ui';
import { BarList } from '@/components/charts/BarList';
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
                    const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
                    return (
                        <>
                            {d.simulated && <SimulatedNotice what="search and analytics data in this range" />}
                            <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                                <KpiTile label="Clicks" value={d.totals.clicks} delta={delta(d.totals.clicks, d.previous.clicks)} />
                                <KpiTile label="Impressions" value={d.totals.impressions} delta={delta(d.totals.impressions, d.previous.impressions)} />
                                <KpiTile label="CTR" value={d.totals.ctr} format="percent" />
                                <KpiTile label="Avg. position (average)" value={d.totals.avgPosition} format="decimal" />
                                <KpiTile label="Sessions" value={d.totals.sessions} delta={delta(d.totals.sessions, d.previous.sessions)} />
                                <KpiTile label="Key events" value={d.totals.conversions} delta={delta(d.totals.conversions, d.previous.conversions)} />
                            </div>
                            {(d.searchDevices.length > 0 || d.searchCountries.length > 0) && (
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <BarList title="Search clicks by device (GSC)" rows={d.searchDevices.map((r) => ({ ...r, label: cap(r.label) }))} />
                                    <BarList title="Search clicks by country (GSC)" rows={d.searchCountries} />
                                </div>
                            )}
                            {(d.movers.gainers.length > 0 || d.movers.decliners.length > 0) && (
                                <div className="grid gap-4 xl:grid-cols-2">
                                    {([['Biggest click gains', d.movers.gainers], ['Biggest click declines', d.movers.decliners]] as const).map(([title, rows]) => (
                                        <Card key={title}>
                                            <CardHeader><CardTitle>{title}</CardTitle><p className="text-xs text-fg-muted">Query clicks vs the previous period of the same length (weekly buckets).</p></CardHeader>
                                            <Table className="border-0 shadow-none rounded-none">
                                                <THead><tr><Th>Query</Th><Th className="text-right">Previous</Th><Th className="text-right">Current</Th><Th className="text-right">Change</Th></tr></THead>
                                                <TBody>
                                                    {rows.length ? rows.map((r) => (
                                                        <tr key={r.query}>
                                                            <Td className="max-w-56 truncate">{r.query}</Td>
                                                            <Td className="text-right tabular-nums">{formatNumber(r.prevClicks)}</Td>
                                                            <Td className="text-right tabular-nums">{formatNumber(r.clicks)}</Td>
                                                            <Td className={`text-right tabular-nums ${r.change >= 0 ? 'text-success' : 'text-danger-strong'}`}>{r.change > 0 ? '+' : ''}{formatNumber(r.change)}</Td>
                                                        </tr>
                                                    )) : <tr><td colSpan={4} className="px-4 py-3 text-sm text-fg-muted">None in this range.</td></tr>}
                                                </TBody>
                                            </Table>
                                        </Card>
                                    ))}
                                </div>
                            )}
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
