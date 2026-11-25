import { useState } from 'react';
import { Link } from 'react-router';
import { Page } from '@/layouts/AppShell';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Label, LoadingState, Select, SimulatedBadge, SimulatedNotice, StatCard } from '@/components/ui';
import { KpiTile } from '@/components/charts/KpiTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { BarList } from '@/components/charts/BarList';
import { useBrand, useQuery } from '@/app/backend';
import { formatDate, formatDateTime } from '@/lib/utils';
import { INSIGHT_STATUS, INTEGRATION_STATUS, PROVIDER_LABELS, SEVERITY } from '@/pages/seo/labels';
import { clientBase } from '@/app/paths';

export const DASHBOARD_RANGES = [7, 28, 30, 90] as const;

export function DashboardPage() {
    const { brand } = useBrand();
    const [days, setDays] = useState<number>(28);
    const [websiteId, setWebsiteId] = useState<string | null>(null);
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const q = useQuery((api) => api.analytics.dashboard(brand.id, { days, websiteId }), [brand.id, days, websiteId]);
    const base = `${clientBase(brand)}`;
    const period = `previous ${days} days`;

    return (
        <Page title="Dashboard" description={brand.name}>
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Dashboard filters">
                <div>
                    <span className="block text-sm font-medium text-fg-secondary mb-1">Range</span>
                    <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
                        {DASHBOARD_RANGES.map((d) => (
                            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
                                className={`rounded-md px-3 py-1.5 text-sm ${days === d ? 'bg-indigo-600 text-white' : 'text-fg-secondary hover:bg-surface-strong'}`}>
                                {d}d
                            </button>
                        ))}
                    </div>
                </div>
                <div className="min-w-48">
                    <Label htmlFor="dashboard-website">Website</Label>
                    <Select id="dashboard-website" value={websiteId ?? ''} onChange={(e) => setWebsiteId(e.target.value || null)}>
                        <option value="">All websites</option>
                        {(websites.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                </div>
            </div>
            {q.loading && !q.data ? (
                <LoadingState />
            ) : q.error ? (
                <ErrorState error={q.error} onRetry={q.reload} />
            ) : (
                (() => {
                    const d = q.data!;
                    return (
                        <>
                            {d.simulated && <SimulatedNotice what="analytics, search and integration data on this dashboard" />}
                            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                                <StatCard label="Websites" value={d.counts.websites} />
                                <StatCard label="Integrations connected" value={d.counts.integrationsConnected} hint={d.counts.integrationsSimulated ? `${d.counts.integrationsSimulated} simulated (demo)` : undefined} />
                                <StatCard label="Integrations failing" value={d.counts.integrationsError} hint={d.counts.integrationsError ? 'Needs reconnect' : 'All healthy'} />
                                <StatCard label="Insights pending review" value={d.counts.insightsPending} />
                            </div>

                            {d.window ? (
                                <>
                                    <p className="text-xs text-fg-muted">
                                        Last {d.window.days} days of {d.simulated ? 'simulated' : 'synced'} data: {formatDate(d.window.from + 'T00:00:00Z')} to {formatDate(d.window.to + 'T00:00:00Z')}, compared with the {period}.
                                    </p>
                                    <h2 className="text-sm font-semibold text-fg">Google Analytics 4{d.simulated && <span className="ml-2 align-middle"><SimulatedBadge /></span>}</h2>
                                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                                        <KpiTile label="Sessions (GA4)" value={d.kpis.sessions.current} delta={d.kpis.sessions.delta} period={period} />
                                        <KpiTile label="Active users (GA4)" value={d.kpis.activeUsers.current} delta={d.kpis.activeUsers.delta} period={period} />
                                        {d.kpis.engagementRate
                                            ? <KpiTile label="Engagement rate (GA4)" value={d.kpis.engagementRate.current} delta={d.kpis.engagementRate.delta} period={period} format="percent" />
                                            : <StatCard label="Engagement rate (GA4)" value="—" hint="Not available for this data" />}
                                        <KpiTile label="Key events (GA4)" value={d.kpis.conversions.current} delta={d.kpis.conversions.delta} period={period} />
                                    </div>
                                    <h2 className="text-sm font-semibold text-fg">Search Console{d.simulated && <span className="ml-2 align-middle"><SimulatedBadge /></span>}</h2>
                                    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                                        <KpiTile label="Clicks (GSC)" value={d.kpis.clicks.current} delta={d.kpis.clicks.delta} period={period} />
                                        <KpiTile label="Impressions (GSC)" value={d.kpis.impressions.current} delta={d.kpis.impressions.delta} period={period} />
                                        <KpiTile label="CTR (GSC)" value={d.kpis.ctr.current} delta={d.kpis.ctr.delta} period={period} format="percent" />
                                        <KpiTile label="Avg. position (GSC, average)" value={d.kpis.avgPosition.current} delta={d.kpis.avgPosition.delta} period={period} format="decimal" upIsGood={false} />
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-2">
                                        <TrendChart title="Daily sessions (GA4)" data={d.sessionsTrend} />
                                        <TrendChart title="Daily search clicks (GSC)" data={d.clicksTrend} />
                                    </div>
                                    {(d.channels.length > 0 || d.devices.length > 0) && (
                                        <div className="grid gap-4 lg:grid-cols-2">
                                            <BarList title="Sessions by channel (GA4)" rows={d.channels} />
                                            <BarList title="Sessions by device (GA4)" rows={d.devices.map((r) => ({ ...r, label: r.label[0]!.toUpperCase() + r.label.slice(1) }))} />
                                        </div>
                                    )}
                                </>
                            ) : (
                                <EmptyState title="No analytics data yet" description="Connect GA4 and Search Console for a website to start collecting data." />
                            )}

                            <div className="grid gap-4 lg:grid-cols-2">
                                <Card>
                                    <CardHeader className="flex items-center justify-between">
                                        <CardTitle>Latest SEO insights</CardTitle>
                                        <Link to={`${base}/seo/insights`} className="text-xs font-medium text-accent hover:text-accent-strong">View all</Link>
                                    </CardHeader>
                                    <CardContent>
                                        {d.recentInsights.length ? (
                                            <ul className="divide-y divide-line-subtle">
                                                {d.recentInsights.map((i) => (
                                                    <li key={i.id} className="py-2">
                                                        <Link to={`${base}/seo/insights/${i.id}`} className="text-sm font-medium text-fg hover:text-accent-strong">{i.title}</Link>
                                                        <div className="mt-1 flex flex-wrap gap-2">
                                                            <Badge variant={SEVERITY[i.severity].variant}>{SEVERITY[i.severity].label}</Badge>
                                                            <Badge variant={INSIGHT_STATUS[i.status].variant}>{INSIGHT_STATUS[i.status].label}</Badge>
                                                            {i.simulated && <SimulatedBadge />}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-fg-muted">No open insights.</p>
                                        )}
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex items-center justify-between">
                                        <CardTitle>Integration status</CardTitle>
                                        <Link to={`${base}/integrations`} className="text-xs font-medium text-accent hover:text-accent-strong">Manage</Link>
                                    </CardHeader>
                                    <CardContent>
                                        {d.integrations.length ? (
                                            <ul className="divide-y divide-line-subtle">
                                                {d.integrations.map((i) => (
                                                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                                        <div className="min-w-0">
                                                            <p className="text-sm text-fg truncate">{i.websiteName} · {PROVIDER_LABELS[i.provider]}</p>
                                                            <p className="text-xs text-fg-muted">{i.lastSyncedAt ? `${i.simulated ? 'Simulated sync' : 'Synced'} ${formatDateTime(i.lastSyncedAt)}` : 'Never synced'}</p>
                                                        </div>
                                                        <span className="flex gap-1.5">
                                                            {i.simulated && <SimulatedBadge />}
                                                            <Badge variant={INTEGRATION_STATUS[i.status].variant}>{INTEGRATION_STATUS[i.status].label}</Badge>
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-fg-muted">No integrations yet.</p>
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
