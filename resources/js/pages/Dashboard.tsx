import React from 'react';
import { Head } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface RecentSeoInsight {
    id: number;
    title: string;
    summary: string;
    status: string;
    status_label: string;
    severity: string;
    website_name: string | null;
    created_at: string | null;
}

interface DashboardProps {
    organization?: {
        id: number;
        name: string;
        slug: string;
        timezone: string;
    };
    member?: {
        role: string;
        label: string;
    };
    stats?: {
        clients_count: number | string | null;
        websites_count: number | string | null;
        connected_integrations_count: number | string | null;
        last_sync_status: string | null;
        last_sync_at: string | null;
        gsc_clicks: number | string | null;
        gsc_impressions: number | string | null;
        ga4_organic_sessions: number | string | null;
        open_seo_insights_count: number | string | null;
        recent_seo_insights: RecentSeoInsight[] | null;
        has_synced_data: boolean | null;
    };
}

export default function Dashboard({ organization, member, stats }: DashboardProps) {
    const dashboardStats = {
        clients_count: stats?.clients_count ?? 0,
        websites_count: stats?.websites_count ?? 0,
        connected_integrations_count: stats?.connected_integrations_count ?? 0,
        last_sync_status: stats?.last_sync_status ?? null,
        last_sync_at: stats?.last_sync_at ?? null,
        gsc_clicks: stats?.gsc_clicks ?? 0,
        gsc_impressions: stats?.gsc_impressions ?? 0,
        ga4_organic_sessions: stats?.ga4_organic_sessions ?? 0,
        open_seo_insights_count: stats?.open_seo_insights_count ?? 0,
        recent_seo_insights: Array.isArray(stats?.recent_seo_insights) ? stats.recent_seo_insights : [],
        has_synced_data: stats?.has_synced_data === true,
    };
    const connectedIntegrationsCount = numericValue(dashboardStats.connected_integrations_count);
    const openSeoInsightsCount = numericValue(dashboardStats.open_seo_insights_count);
    const websitesCount = numericValue(dashboardStats.websites_count);
    const isClient = member?.role === 'client';

    return (
        <AppLayout title="Dashboard">
            <Head title="Dashboard" />

            <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-bold text-gray-900">{organization?.name ?? 'Dashboard'}</h2>
                        <Badge variant="indigo">{member?.label ?? 'Member'}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                        {isClient ? 'Client portal overview' : 'Organization performance overview'} / {organization?.timezone ?? 'UTC'}
                    </p>
                </div>
                <div className="text-sm text-gray-500">
                    {dashboardStats.last_sync_at ? `Last sync ${dashboardStats.last_sync_at}` : 'No sync completed yet'}
                </div>
            </div>

            <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                        label={isClient ? 'Assigned client' : 'Clients'}
                        value={formatNumber(dashboardStats.clients_count)}
                        detail={isClient ? 'Your client record' : 'Active organization clients'}
                    />
                    <KpiCard
                        label="Active websites"
                        value={formatNumber(dashboardStats.websites_count)}
                        detail={isClient ? 'Assigned to your client' : 'Tracked across the organization'}
                    />
                    <KpiCard
                        label="Connected integrations"
                        value={formatNumber(dashboardStats.connected_integrations_count)}
                        detail={connectedIntegrationsCount > 0 ? 'Ready for analytics sync' : 'No integrations connected yet'}
                        muted={connectedIntegrationsCount === 0}
                    />
                    <KpiCard
                        label="Open SEO insights"
                        value={formatNumber(dashboardStats.open_seo_insights_count)}
                        detail={openSeoInsightsCount > 0 ? 'Waiting for review or action' : 'No SEO insights yet'}
                        muted={openSeoInsightsCount === 0}
                    />
                </div>

                {connectedIntegrationsCount === 0 && (
                    <EmptyNotice
                        title="No integrations connected yet"
                        description="Connect Google Analytics or Search Console to start syncing website performance data."
                    />
                )}

                <Card>
                    <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-base font-semibold text-gray-900">SEO Snapshot</h3>
                            <p className="mt-1 text-sm text-gray-500">Latest synced analytics totals for visible websites.</p>
                        </div>
                        <Badge variant={dashboardStats.last_sync_status ? syncVariant(dashboardStats.last_sync_status) : 'gray'}>
                            {dashboardStats.last_sync_status ?? 'No sync'}
                        </Badge>
                    </CardHeader>
                    <CardContent>
                        {!dashboardStats.has_synced_data ? (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No synced analytics data yet</p>
                                <p className="mt-1 text-sm text-gray-500">
                                    Dashboard metrics will appear after a connected GA4 or Search Console integration syncs.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <MetricTile label="GSC clicks" value={formatNumber(dashboardStats.gsc_clicks)} badge="GSC" />
                                <MetricTile label="GSC impressions" value={formatNumber(dashboardStats.gsc_impressions)} badge="GSC" />
                                <MetricTile label="GA4 organic sessions" value={formatNumber(dashboardStats.ga4_organic_sessions)} badge="GA4" />
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">Recent SEO Insights</h3>
                        <p className="mt-1 text-sm text-gray-500">Open recommendations generated from synced analytics data.</p>
                    </CardHeader>
                    <CardContent>
                        {dashboardStats.recent_seo_insights.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No SEO insights yet</p>
                                <p className="mt-1 text-sm text-gray-500">
                                    Insights will appear here after analytics data is synced and analyzed.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {dashboardStats.recent_seo_insights.map((insight) => (
                                    <div key={insight.id} className="rounded-lg border border-gray-200 p-4">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h4 className="font-medium text-gray-900">{insight.title}</h4>
                                                    <Badge variant={severityVariant(insight.severity)}>{insight.severity}</Badge>
                                                    <Badge variant={statusVariant(insight.status)}>{insight.status_label}</Badge>
                                                </div>
                                                <p className="mt-1 text-sm text-gray-600">{insight.summary}</p>
                                            </div>
                                            <div className="shrink-0 text-left text-xs text-gray-500 md:text-right">
                                                <p>{insight.website_name ?? 'Organization-wide'}</p>
                                                {insight.created_at && <p>{insight.created_at}</p>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">Getting started</h3>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {[
                                { step: 1, label: 'Create your organization', done: true },
                                { step: 2, label: isClient ? 'Assign websites' : 'Add clients and websites', done: websitesCount > 0 },
                                { step: 3, label: 'Connect Google data sources', done: connectedIntegrationsCount > 0 },
                                { step: 4, label: 'Review SEO insights', done: openSeoInsightsCount > 0 },
                            ].map((item) => (
                                <div key={item.step} className="flex min-h-16 items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
                                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                        item.done
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-gray-100 text-gray-500'
                                    }`}>
                                        {item.done ? '✓' : item.step}
                                    </div>
                                    <span className={`text-sm ${item.done ? 'text-gray-500' : 'text-gray-700'}`}>
                                        {item.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}

const formatNumber = (value: number | string | null | undefined): string => {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) ? numberValue.toLocaleString() : '0';
};

const numericValue = (value: number | string | null | undefined): number => {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) ? numberValue : 0;
};

function KpiCard({ label, value, detail, muted = false }: {
    label: string;
    value: string;
    detail: string;
    muted?: boolean;
}) {
    return (
        <Card>
            <CardContent className="pt-6">
                <p className="text-sm font-medium text-gray-500">{label}</p>
                <p className={`mt-2 text-3xl font-bold ${muted ? 'text-gray-400' : 'text-gray-900'}`}>{value}</p>
                <p className="mt-1 text-xs text-gray-500">{detail}</p>
            </CardContent>
        </Card>
    );
}

function MetricTile({ label, value, badge }: { label: string; value: string; badge: string }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-gray-500">{label}</p>
                <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                    {badge}
                </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
        </div>
    );
}

function EmptyNotice({ title, description }: { title: string; description: string }) {
    return (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
            <p className="text-sm font-medium text-yellow-900">{title}</p>
            <p className="mt-1 text-sm text-yellow-800">{description}</p>
        </div>
    );
}

function severityVariant(severity: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' {
    if (severity === 'high') {
        return 'red';
    }

    if (severity === 'medium') {
        return 'yellow';
    }

    return 'blue';
}

function statusVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' {
    if (status === 'approved') {
        return 'green';
    }

    if (status === 'reviewed') {
        return 'indigo';
    }

    if (status === 'dismissed') {
        return 'gray';
    }

    return 'yellow';
}

function syncVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' {
    if (status === 'Completed') {
        return 'green';
    }

    if (status === 'Failed') {
        return 'red';
    }

    return 'yellow';
}
