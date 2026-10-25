import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, Table, TBody, Td, Th, THead } from '@/components/ui';
import { ReportFiltersBar } from '@/components/filters/ReportFilters';
import { useBrand, useQuery } from '@/app/backend';
import { formatDate, formatNumber, formatPercent } from '@/lib/utils';
import { useReportFilters } from './useReportFilters';

function Delta({ value }: { value: number | null }) {
    if (value === null) return <span className="text-gray-400">—</span>;
    const up = value >= 0;
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
        <span className={`inline-flex items-center gap-0.5 tabular-nums ${up ? 'text-green-700' : 'text-red-700'}`}>
            <Icon className="h-3 w-3" aria-hidden="true" />
            {`${up ? '+' : ''}${(value * 100).toFixed(1)}%`}
        </span>
    );
}

export function IntelligencePage() {
    const { brand } = useBrand();
    const { filters, setFilters, dataEnd, websites } = useReportFilters();
    const q = useQuery((api) => (filters ? api.intelligence.overview(brand.id, filters) : Promise.resolve(null)), [brand.id, filters?.from, filters?.to, filters?.websiteId]);
    const siteName = (id: string) => websites.find((w) => w.id === id)?.name ?? id;

    return (
        <Page title="SEO Intelligence" description="Anomalies, click opportunities and website comparison, computed from synced data">
            {filters && <ReportFiltersBar value={filters} onChange={setFilters} dataEnd={dataEnd} websites={websites} />}
            {q.loading || !filters ? (
                <LoadingState />
            ) : q.error ? (
                <ErrorState error={q.error} onRetry={q.reload} />
            ) : !q.data ? null : (
                <>
                    <Card>
                        <CardHeader><CardTitle>Website comparison</CardTitle></CardHeader>
                        <Table className="border-0 shadow-none rounded-none">
                            <THead>
                                <tr><Th>Website</Th><Th className="text-right">Sessions</Th><Th className="text-right">vs prev.</Th><Th className="text-right">Conv. rate</Th><Th className="text-right">Clicks</Th><Th className="text-right">vs prev.</Th><Th className="text-right">CTR</Th><Th className="text-right">Avg. pos.</Th></tr>
                            </THead>
                            <TBody>
                                {q.data.comparison.map((r) => (
                                    <tr key={r.websiteId}>
                                        <Td><p className="font-medium text-gray-900">{r.name}</p><p className="text-xs text-gray-500">{r.domain}</p></Td>
                                        <Td className="text-right tabular-nums">{formatNumber(r.sessions)}</Td>
                                        <Td className="text-right"><Delta value={r.sessionsDelta} /></Td>
                                        <Td className="text-right tabular-nums">{formatPercent(r.conversionRate, 2)}</Td>
                                        <Td className="text-right tabular-nums">{formatNumber(r.clicks)}</Td>
                                        <Td className="text-right"><Delta value={r.clicksDelta} /></Td>
                                        <Td className="text-right tabular-nums">{formatPercent(r.ctr, 2)}</Td>
                                        <Td className="text-right tabular-nums">{r.avgPosition.toFixed(1)}</Td>
                                    </tr>
                                ))}
                            </TBody>
                        </Table>
                    </Card>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Anomalies</CardTitle>
                                <p className="text-xs text-gray-500">Days more than 2.5 standard deviations from the trailing 14-day mean.</p>
                            </CardHeader>
                            <CardContent>
                                {q.data.anomalies.length ? (
                                    <ul className="divide-y divide-gray-100" aria-label="Anomalies">
                                        {q.data.anomalies.map((a) => (
                                            <li key={`${a.websiteId}-${a.metric}-${a.date}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                                                <div>
                                                    <p className="text-gray-900">{siteName(a.websiteId)}: {a.metric} {a.direction === 'spike' ? 'spike' : 'drop'}</p>
                                                    <p className="text-xs text-gray-500">{formatDate(a.date + 'T00:00:00Z')} · {formatNumber(a.value)} vs ~{formatNumber(a.expected)} expected</p>
                                                </div>
                                                <Badge variant={a.direction === 'drop' ? 'red' : 'blue'}>{a.direction === 'drop' ? 'Drop' : 'Spike'} · z {a.z}</Badge>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <EmptyState title="No anomalies in this range" />
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Click opportunities</CardTitle>
                                <p className="text-xs text-gray-500">Estimated extra clicks if each query reached a typical CTR for its position, or moved to position 3.</p>
                            </CardHeader>
                            <CardContent>
                                <Alert tone="info" className="mb-3">These are estimates from an approximate industry CTR curve, not forecasts.</Alert>
                                {q.data.opportunities.length ? (
                                    <ol className="space-y-2" aria-label="Opportunities">
                                        {q.data.opportunities.map((o) => (
                                            <li key={`${o.websiteId}-${o.query}`} className="rounded-lg border border-gray-100 p-2 text-sm">
                                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                    <span className="font-medium text-gray-900">{o.query}</span>
                                                    <span className="text-xs text-gray-600 tabular-nums">~{formatNumber(o.ctrGap + o.rankGain)} clicks</span>
                                                </div>
                                                <p className="text-xs text-gray-500 tabular-nums">
                                                    {siteName(o.websiteId)} · pos {o.position.toFixed(1)} · CTR {formatPercent(o.ctr, 2)} vs ~{formatPercent(o.expectedCtr, 1)} typical · {formatNumber(o.impressions)} impressions
                                                </p>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <EmptyState title="No query opportunities in this range" />
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </Page>
    );
}
