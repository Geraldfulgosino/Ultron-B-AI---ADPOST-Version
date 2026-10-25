import { Link } from 'react-router';
import { Page } from '@/layouts/AppShell';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, StatCard } from '@/components/ui';
import { KpiTile } from '@/components/charts/KpiTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { useBrand, useQuery } from '@/app/backend';
import { formatDate, formatDateTime } from '@/lib/utils';
import { INSIGHT_STATUS, INTEGRATION_STATUS, PROVIDER_LABELS, SEVERITY } from '@/pages/seo/labels';

export function DashboardPage() {
    const { brand } = useBrand();
    const q = useQuery((api) => api.analytics.dashboard(brand.id), [brand.id]);
    const base = `/b/${brand.slug}`;

    return (
        <Page title="Dashboard" description={brand.name}>
            {q.loading ? (
                <LoadingState />
            ) : q.error ? (
                <ErrorState error={q.error} onRetry={q.reload} />
            ) : (
                (() => {
                    const d = q.data!;
                    return (
                        <>
                            <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
                                <StatCard label="Clients" value={d.counts.clients} />
                                <StatCard label="Websites" value={d.counts.websites} />
                                <StatCard label="Integrations connected" value={d.counts.integrationsConnected} />
                                <StatCard label="Integrations failing" value={d.counts.integrationsError} hint={d.counts.integrationsError ? 'Needs reconnect' : 'All healthy'} />
                                <StatCard label="Insights pending review" value={d.counts.insightsPending} />
                            </div>

                            {d.window ? (
                                <>
                                    <p className="text-xs text-gray-500">
                                        Last 28 days of synced data: {formatDate(d.window.from + 'T00:00:00Z')} to {formatDate(d.window.to + 'T00:00:00Z')}
                                    </p>
                                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                                        <KpiTile label="Sessions (GA4)" value={d.kpis.sessions.current} delta={d.kpis.sessions.delta} period="previous 28 days" />
                                        <KpiTile label="Conversions (GA4)" value={d.kpis.conversions.current} delta={d.kpis.conversions.delta} period="previous 28 days" />
                                        <KpiTile label="Clicks (GSC)" value={d.kpis.clicks.current} delta={d.kpis.clicks.delta} period="previous 28 days" />
                                        <KpiTile label="Impressions (GSC)" value={d.kpis.impressions.current} delta={d.kpis.impressions.delta} period="previous 28 days" />
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-2">
                                        <TrendChart title="Daily sessions" data={d.sessionsTrend} />
                                        <TrendChart title="Daily search clicks" data={d.clicksTrend} />
                                    </div>
                                </>
                            ) : (
                                <EmptyState title="No analytics data yet" description="Connect GA4 and Search Console for a website to start collecting data." />
                            )}

                            <div className="grid gap-4 lg:grid-cols-2">
                                <Card>
                                    <CardHeader className="flex items-center justify-between">
                                        <CardTitle>Latest SEO insights</CardTitle>
                                        <Link to={`${base}/seo/insights`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View all</Link>
                                    </CardHeader>
                                    <CardContent>
                                        {d.recentInsights.length ? (
                                            <ul className="divide-y divide-gray-100">
                                                {d.recentInsights.map((i) => (
                                                    <li key={i.id} className="py-2">
                                                        <Link to={`${base}/seo/insights/${i.id}`} className="text-sm font-medium text-gray-900 hover:text-indigo-700">{i.title}</Link>
                                                        <div className="mt-1 flex gap-2">
                                                            <Badge variant={SEVERITY[i.severity].variant}>{SEVERITY[i.severity].label}</Badge>
                                                            <Badge variant={INSIGHT_STATUS[i.status].variant}>{INSIGHT_STATUS[i.status].label}</Badge>
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-gray-500">No open insights.</p>
                                        )}
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex items-center justify-between">
                                        <CardTitle>Integration status</CardTitle>
                                        <Link to={`${base}/integrations`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Manage</Link>
                                    </CardHeader>
                                    <CardContent>
                                        {d.integrations.length ? (
                                            <ul className="divide-y divide-gray-100">
                                                {d.integrations.map((i) => (
                                                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                                        <div className="min-w-0">
                                                            <p className="text-sm text-gray-900 truncate">{i.websiteName} · {PROVIDER_LABELS[i.provider]}</p>
                                                            <p className="text-xs text-gray-500">{i.lastSyncedAt ? `Synced ${formatDateTime(i.lastSyncedAt)}` : 'Never synced'}</p>
                                                        </div>
                                                        <Badge variant={INTEGRATION_STATUS[i.status].variant}>{INTEGRATION_STATUS[i.status].label}</Badge>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-gray-500">No integrations yet.</p>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        </>
                    );
                })()
            )}
        </Page>
    );
}
