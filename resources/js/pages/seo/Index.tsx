import React from 'react';
import { Head, Link, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

type DataSource = 'all' | 'ga4' | 'gsc';

interface TrendPoint {
    date: string;
    value: number;
}

interface SeoProps {
    filters?: {
        website_id: number | null;
        date_from: string;
        date_to: string;
        source: DataSource;
    };
    stats?: {
        websites: number | string | null;
        connected_integrations: number | string | null;
        keywords_tracked: number | string | null;
        clicks: number | string | null;
        impressions: number | string | null;
        ctr: number | string | null;
        average_position: number | string | null;
        organic_sessions: number | string | null;
        conversions: number | string | null;
        has_synced_data: boolean | null;
        last_sync_status: string | null;
        last_sync_at: string | null;
    };
    websites?: Array<{
        id: number;
        name: string;
        domain: string;
        client_name: string;
        status: string;
        last_synced_at: string | null;
    }>;
    landingPages?: Array<{
        page_path: string;
        sessions: number | string | null;
        conversions: number | string | null;
        clicks: number | string | null;
        impressions: number | string | null;
        ctr: number | string | null;
    }>;
    trends?: {
        gsc_clicks?: TrendPoint[] | null;
        gsc_impressions?: TrendPoint[] | null;
        ga4_organic_sessions?: TrendPoint[] | null;
    };
    searchQueries?: Array<{
        query: string;
        clicks: number | string | null;
        impressions: number | string | null;
        ctr: number | string | null;
        average_position: number | string | null;
    }>;
    insights?: Array<{
        id: number;
        type: string;
        type_label: string;
        status: string;
        status_label: string;
        severity: string;
        title: string;
        summary: string;
        recommendation: string | null;
        subject_type: string | null;
        subject_value: string | null;
        website_name: string | null;
        created_at: string | null;
    }>;
    latestSync: {
        provider: string;
        status: string;
        records_synced: number;
        finished_at: string | null;
        error_message: string | null;
    } | null;
    canGenerateInsights: boolean;
}

interface SharedProps {
    currentOrganization: { slug: string };
    errors?: Record<string, string>;
}

const GSC_INSIGHT_TYPES = new Set([
    'declining_page_clicks',
    'high_impression_low_ctr_query',
    'improving_page_impressions',
    'ranking_opportunity',
]);

function insightDataSource(type: string): 'ga4' | 'gsc' | 'mixed' {
    if (GSC_INSIGHT_TYPES.has(type)) return 'gsc';
    return 'mixed';
}

export default function SeoIndex({ filters, stats, websites, landingPages, trends, searchQueries, insights, latestSync, canGenerateInsights }: SeoProps) {
    const page = usePage();
    const { currentOrganization, errors = {} } = page.props as unknown as SharedProps;
    const orgSlug = currentOrganization?.slug ?? page.url.split('/').filter(Boolean)[0] ?? '';
    const safeFilters = {
        website_id: filters?.website_id ?? null,
        date_from: filters?.date_from ?? '',
        date_to: filters?.date_to ?? '',
        source: filters?.source ?? 'all',
    };
    const metrics = {
        websites: stats?.websites ?? 0,
        connected_integrations: stats?.connected_integrations ?? 0,
        keywords_tracked: stats?.keywords_tracked ?? 0,
        clicks: stats?.clicks ?? 0,
        impressions: stats?.impressions ?? 0,
        ctr: stats?.ctr ?? 0,
        average_position: stats?.average_position ?? null,
        organic_sessions: stats?.organic_sessions ?? 0,
        conversions: stats?.conversions ?? 0,
        has_synced_data: stats?.has_synced_data === true,
        last_sync_status: stats?.last_sync_status ?? null,
        last_sync_at: stats?.last_sync_at ?? null,
    };
    const websiteRows = Array.isArray(websites) ? websites : [];
    const landingPageRows = Array.isArray(landingPages) ? landingPages : [];
    const searchQueryRows = Array.isArray(searchQueries) ? searchQueries : [];
    const insightRows = Array.isArray(insights) ? insights : [];
    const trendData = {
        gsc_clicks: normalizeTrendPoints(trends?.gsc_clicks),
        gsc_impressions: normalizeTrendPoints(trends?.gsc_impressions),
        ga4_organic_sessions: normalizeTrendPoints(trends?.ga4_organic_sessions),
    };
    const source = safeFilters.source;
    const form = useForm({
        website_id: safeFilters.website_id?.toString() ?? '',
        date_from: safeFilters.date_from,
        date_to: safeFilters.date_to,
        source: safeFilters.source,
    });
    const insightsForm = useForm({});
    const hasFilterErrors = Object.keys(errors).length > 0;

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        form.get(route('seo.index', { organization: orgSlug }), {
            preserveScroll: true,
            preserveState: true,
        });
    };

    const generateInsights = () => {
        insightsForm.post(route('seo.insights.generate', { organization: orgSlug }), {
            preserveScroll: true,
        });
    };

    const showLandingPages = source === 'all' || source === 'ga4';
    const showSearchQueries = source === 'all' || source === 'gsc';
    const showGscTrends = source === 'all' || source === 'gsc';
    const showGa4Trends = source === 'all' || source === 'ga4';

    return (
        <AppLayout title="SEO Dashboard">
            <Head title="SEO" />

            <div className="space-y-6">
                <Card>
                    <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">SEO performance</h2>
                            <p className="mt-1 text-sm text-gray-500">Dashboard data is loaded from synchronized local analytics tables.</p>
                        </div>
                        <Link href={route('integrations.index', { organization: orgSlug })} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                            Manage integrations
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(180px,1fr)_160px_160px_160px_auto] lg:items-end">
                            <div>
                                <Label htmlFor="seo-website">Website</Label>
                                <select
                                    id="seo-website"
                                    value={form.data.website_id}
                                    onChange={(event) => form.setData('website_id', event.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All websites</option>
                                    {websiteRows.map((website) => (
                                        <option key={website.id} value={website.id}>
                                            {website.name} ({website.domain})
                                        </option>
                                    ))}
                                </select>
                                {errors.website_id && <p className="mt-1 text-xs text-red-600">{errors.website_id}</p>}
                            </div>
                            <div>
                                <Label htmlFor="seo-source">Data source</Label>
                                <select
                                    id="seo-source"
                                    value={form.data.source}
                                    onChange={(event) => form.setData('source', event.target.value as DataSource)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="all">All sources</option>
                                    <option value="ga4">Google Analytics 4</option>
                                    <option value="gsc">Google Search Console</option>
                                </select>
                                {errors.source && <p className="mt-1 text-xs text-red-600">{errors.source}</p>}
                            </div>
                            <div>
                                <Label htmlFor="seo-date-from">From</Label>
                                <Input id="seo-date-from" type="date" value={form.data.date_from} onChange={(event) => form.setData('date_from', event.target.value)} error={errors.date_from} />
                            </div>
                            <div>
                                <Label htmlFor="seo-date-to">To</Label>
                                <Input id="seo-date-to" type="date" value={form.data.date_to} onChange={(event) => form.setData('date_to', event.target.value)} error={errors.date_to} />
                            </div>
                            <Button type="submit" loading={form.processing}>
                                Apply
                            </Button>
                        </form>
                        {hasFilterErrors && (
                            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                The selected filters could not be applied.
                            </div>
                        )}
                        {form.processing && (
                            <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-700">
                                Loading SEO analytics...
                            </div>
                        )}
                    </CardContent>
                </Card>

                {source === 'all' && (
                    <div className="space-y-5">
                        <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Google Search Console Metrics</p>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <Kpi label="Clicks" value={formatNumber(metrics.clicks)} badge="gsc" />
                                <Kpi label="Impressions" value={formatNumber(metrics.impressions)} badge="gsc" />
                                <Kpi label="CTR" value={`${formatDecimal(metrics.ctr)}%`} badge="gsc" />
                                <Kpi label="Average position" value={formatOptionalDecimal(metrics.average_position)} badge="gsc" />
                                <Kpi label="Keywords" value={formatNumber(metrics.keywords_tracked)} badge="gsc" muted={!metrics.has_synced_data} />
                            </div>
                        </div>
                        <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Google Analytics 4 Metrics</p>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <Kpi label="Organic sessions" value={formatNumber(metrics.organic_sessions)} badge="ga4" />
                                <Kpi label="Conversions" value={formatNumber(metrics.conversions)} badge="ga4" />
                                <Kpi label="Last sync" value={metrics.last_sync_status ?? 'No sync'} detail={metrics.last_sync_at ?? undefined} muted={!metrics.last_sync_status} badge="both" />
                            </div>
                        </div>
                    </div>
                )}

                {source === 'ga4' && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Kpi label="Organic sessions" value={formatNumber(metrics.organic_sessions)} />
                        <Kpi label="Conversions" value={formatNumber(metrics.conversions)} />
                        <Kpi label="Last sync" value={metrics.last_sync_status ?? 'No sync'} detail={metrics.last_sync_at ?? undefined} muted={!metrics.last_sync_status} />
                    </div>
                )}

                {source === 'gsc' && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <Kpi label="Clicks" value={formatNumber(metrics.clicks)} />
                        <Kpi label="Impressions" value={formatNumber(metrics.impressions)} />
                        <Kpi label="CTR" value={`${formatDecimal(metrics.ctr)}%`} />
                        <Kpi label="Average position" value={formatOptionalDecimal(metrics.average_position)} />
                        <Kpi label="Keywords" value={formatNumber(metrics.keywords_tracked)} muted={!metrics.has_synced_data} />
                        <Kpi label="Last sync" value={metrics.last_sync_status ?? 'No sync'} detail={metrics.last_sync_at ?? undefined} muted={!metrics.last_sync_status} />
                    </div>
                )}

                {!metrics.has_synced_data && (
                    <Card>
                        <CardContent className="py-10 text-center">
                            <p className="text-sm font-medium text-gray-900">No synced analytics data for this selection</p>
                            <p className="mt-1 text-sm text-gray-500">Sync a connected GA4 or Search Console integration, or adjust the website and date range.</p>
                        </CardContent>
                    </Card>
                )}

                {latestSync?.error_message && (
                    <Card>
                        <CardContent className="border-l-4 border-red-500 py-4">
                            <p className="text-sm font-medium text-gray-900">Latest sync error</p>
                            <p className="mt-1 text-sm text-red-600">{latestSync.error_message}</p>
                        </CardContent>
                    </Card>
                )}

                <div className={`grid gap-6 ${showGscTrends && showGa4Trends ? 'xl:grid-cols-3' : showGscTrends ? 'xl:grid-cols-2' : ''}`}>
                    {showGscTrends && (
                        <>
                            <TrendChart
                                title="GSC clicks over time"
                                description="Daily Search Console clicks in the selected range."
                                points={trendData.gsc_clicks}
                                source="gsc"
                                emptyTitle="No GSC trend data yet"
                            />
                            <TrendChart
                                title="GSC impressions over time"
                                description="Daily Search Console impressions in the selected range."
                                points={trendData.gsc_impressions}
                                source="gsc"
                                emptyTitle="No GSC trend data yet"
                            />
                        </>
                    )}
                    {showGa4Trends && (
                        <TrendChart
                            title="GA4 organic sessions over time"
                            description="Daily organic sessions in the selected range."
                            points={trendData.ga4_organic_sessions}
                            source="ga4"
                            emptyTitle="No GA4 trend data yet"
                        />
                    )}
                </div>

                <Card>
                    <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">SEO insights</h2>
                            <p className="mt-1 text-sm text-gray-500">Generated from local analytics patterns and stored for review.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Link
                                href={route('seo.insights.index', { organization: orgSlug })}
                                className="text-sm text-indigo-600 hover:underline"
                            >
                                View all insights →
                            </Link>
                            {canGenerateInsights && (
                                <Button type="button" variant="secondary" loading={insightsForm.processing} onClick={generateInsights}>
                                    Generate insights
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {insightRows.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No SEO insights yet</p>
                                <p className="mt-1 text-sm text-gray-500">Generate insights after analytics data has been synced locally.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {insightRows.map((insight) => (
                                    <div key={insight.id} className="rounded-lg border border-gray-200 p-4">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="font-medium text-gray-900">{insight.title}</h3>
                                                    <Badge variant={severityVariant(insight.severity)}>{insight.severity}</Badge>
                                                    <Badge variant={statusVariant(insight.status)}>{insight.status_label}</Badge>
                                                    <SourceBadge source={insightDataSource(insight.type)} />
                                                </div>
                                                <p className="mt-1 text-sm text-gray-600">{insight.summary}</p>
                                                {insight.recommendation && (
                                                    <p className="mt-2 text-sm text-gray-500">{insight.recommendation}</p>
                                                )}
                                            </div>
                                            <div className="shrink-0 text-left text-xs text-gray-500 md:text-right">
                                                <p>{insight.type_label}</p>
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

                <div className={`grid gap-6 ${showLandingPages && showSearchQueries ? 'xl:grid-cols-2' : ''}`}>
                    {showLandingPages && (
                        <DataTable
                            title="Landing pages"
                            description="Top local GA4 landing-page rows in the selected range."
                            emptyTitle="No landing page data"
                            emptyDescription="GA4 landing pages will appear after a successful analytics sync."
                            headers={['Page', 'Sessions', 'Conversions', 'Clicks', 'Impressions', 'CTR']}
                        >
                            {landingPageRows.map((lp) => (
                                <tr key={lp.page_path} className="border-t border-gray-100">
                                    <td className="max-w-[260px] truncate px-4 py-3 text-sm font-medium text-gray-900">{lp.page_path}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(lp.sessions)}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(lp.conversions)}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(lp.clicks)}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(lp.impressions)}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatDecimal(lp.ctr)}%</td>
                                </tr>
                            ))}
                        </DataTable>
                    )}

                    {showSearchQueries && (
                        <DataTable
                            title="Search queries"
                            description="Top local Search Console query rows in the selected range."
                            emptyTitle="No search query data"
                            emptyDescription="Search Console queries will appear after a successful search sync."
                            headers={['Query', 'Clicks', 'Impressions', 'CTR', 'Position']}
                        >
                            {searchQueryRows.map((query) => (
                                <tr key={query.query} className="border-t border-gray-100">
                                    <td className="max-w-[260px] truncate px-4 py-3 text-sm font-medium text-gray-900">{query.query}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(query.clicks)}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatNumber(query.impressions)}</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatDecimal(query.ctr)}%</td>
                                    <td className="px-4 py-3 text-right text-sm text-gray-600">{formatOptionalDecimal(query.average_position)}</td>
                                </tr>
                            ))}
                        </DataTable>
                    )}
                </div>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Tracked websites</h2>
                            <p className="mt-1 text-sm text-gray-500">Website records available for filtered SEO analytics.</p>
                        </div>
                        <Badge variant={numericValue(metrics.connected_integrations) > 0 ? 'green' : 'gray'}>
                            {formatNumber(metrics.connected_integrations)} connected
                        </Badge>
                    </CardHeader>
                    <CardContent>
                        {websiteRows.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No websites to analyze</p>
                                <p className="mt-1 text-sm text-gray-500">Add websites and connect Google sources before SEO data appears.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {websiteRows.map((website) => (
                                    <div key={website.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                                        <div>
                                            <p className="font-medium text-gray-900">{website.name}</p>
                                            <p className="text-sm text-gray-500">{website.domain} / {website.client_name}</p>
                                            <p className="mt-1 text-xs text-gray-400">
                                                {website.last_synced_at ? `Last sync ${website.last_synced_at}` : 'No synced analytics yet'}
                                            </p>
                                        </div>
                                        <Badge variant={website.status === 'active' ? 'green' : 'gray'}>{website.status}</Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}

function TrendChart({ title, description, points, source, emptyTitle }: {
    title: string;
    description: string;
    points: TrendPoint[] | null | undefined;
    source: 'ga4' | 'gsc';
    emptyTitle: string;
}) {
    const chartPoints = normalizeTrendPoints(points);
    const maxValue = Math.max(...chartPoints.map((point) => point.value), 0);
    const chartWidth = 320;
    const chartHeight = 120;
    const padding = 12;
    const usableWidth = chartWidth - padding * 2;
    const usableHeight = chartHeight - padding * 2;
    const polylinePoints = chartPoints.map((point, index) => {
        const x = padding + (chartPoints.length === 1 ? usableWidth : (index / (chartPoints.length - 1)) * usableWidth);
        const y = padding + usableHeight - (maxValue === 0 ? 0 : (point.value / maxValue) * usableHeight);

        return `${x},${y}`;
    }).join(' ');
    const latestPoint = chartPoints.at(-1);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                        <p className="mt-1 text-sm text-gray-500">{description}</p>
                    </div>
                    <SourceBadge source={source} />
                </div>
            </CardHeader>
            <CardContent>
                {chartPoints.length === 0 ? (
                    <div className="flex min-h-[168px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-6 text-center">
                        <p className="text-sm font-medium text-gray-900">{emptyTitle}</p>
                        <p className="mt-1 text-sm text-gray-500">Select another date range or sync analytics.</p>
                    </div>
                ) : (
                    <div>
                        <div className="mb-3 flex items-end justify-between gap-3">
                            <div>
                                <p className="text-2xl font-bold text-gray-900">{maxValue.toLocaleString()}</p>
                                <p className="text-xs text-gray-500">Peak daily value</p>
                            </div>
                            {latestPoint && (
                                <div className="text-right">
                                    <p className="text-sm font-medium text-gray-900">{latestPoint.value.toLocaleString()}</p>
                                    <p className="text-xs text-gray-500">{latestPoint.date}</p>
                                </div>
                            )}
                        </div>
                        <svg className="h-36 w-full overflow-visible" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={title}>
                            <line x1={padding} y1={chartHeight - padding} x2={chartWidth - padding} y2={chartHeight - padding} stroke="#e5e7eb" strokeWidth="1" />
                            <polyline
                                points={polylinePoints}
                                fill="none"
                                stroke={source === 'gsc' ? '#059669' : '#2563eb'}
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            {chartPoints.map((point, index) => {
                                const x = padding + (chartPoints.length === 1 ? usableWidth : (index / (chartPoints.length - 1)) * usableWidth);
                                const y = padding + usableHeight - (maxValue === 0 ? 0 : (point.value / maxValue) * usableHeight);

                                return <circle key={`${point.date}-${index}`} cx={x} cy={y} r="3" fill={source === 'gsc' ? '#059669' : '#2563eb'} />;
                            })}
                        </svg>
                        <div className="mt-2 flex justify-between text-xs text-gray-500">
                            <span>{chartPoints[0]?.date}</span>
                            <span>{chartPoints.at(-1)?.date}</span>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

const numericValue = (value: number | string | null | undefined): number => {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatNumber = (value: number | string | null | undefined): string => numericValue(value).toLocaleString();

const formatDecimal = (value: number | string | null | undefined): string => numericValue(value).toFixed(2);

const formatOptionalDecimal = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined || value === '') {
        return 'N/A';
    }

    return formatDecimal(value);
};

const normalizeTrendPoints = (points: TrendPoint[] | null | undefined): TrendPoint[] => {
    if (! Array.isArray(points)) {
        return [];
    }

    return points
        .map((point) => ({
            date: point?.date ?? '',
            value: numericValue(point?.value),
        }))
        .filter((point) => point.date !== '');
};

function SourceBadge({ source }: { source: 'ga4' | 'gsc' | 'mixed' | 'both' }) {
    const config: Record<string, { label: string; className: string }> = {
        ga4: { label: 'GA4', className: 'bg-blue-100 text-blue-700' },
        gsc: { label: 'GSC', className: 'bg-emerald-100 text-emerald-700' },
        mixed: { label: 'Mixed', className: 'bg-purple-100 text-purple-700' },
        both: { label: 'Both', className: 'bg-purple-100 text-purple-700' },
    };
    const { label, className } = config[source];
    return (
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>
            {label}
        </span>
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

    if (status === 'dismissed') {
        return 'gray';
    }

    if (status === 'reviewed') {
        return 'indigo';
    }

    return 'yellow';
}

function Kpi({ label, value, detail, muted = false, badge }: {
    label: string;
    value: string;
    detail?: string;
    muted?: boolean;
    badge?: 'ga4' | 'gsc' | 'both';
}) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-500">{label}</p>
                    {badge && <SourceBadge source={badge} />}
                </div>
                <p className={`mt-2 text-2xl font-bold ${muted ? 'text-gray-400' : 'text-gray-900'}`}>{value}</p>
                {detail && <p className="mt-1 truncate text-xs text-gray-500">{detail}</p>}
            </CardContent>
        </Card>
    );
}

function DataTable({
    title,
    description,
    emptyTitle,
    emptyDescription,
    headers,
    children,
}: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    headers: string[];
    children: React.ReactNode[];
}) {
    return (
        <Card>
            <CardHeader>
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                <p className="mt-1 text-sm text-gray-500">{description}</p>
            </CardHeader>
            <CardContent className="p-0">
                {children.length === 0 ? (
                    <div className="p-8 text-center">
                        <p className="text-sm font-medium text-gray-900">{emptyTitle}</p>
                        <p className="mt-1 text-sm text-gray-500">{emptyDescription}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr>
                                    {headers.map((header, index) => (
                                        <th key={header} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${index === 0 ? 'text-left' : 'text-right'}`}>
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>{children}</tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
