import React from 'react';
import { Head, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';

type Source = 'all' | 'ga4' | 'gsc';

interface ReportFilters {
    website_id: number | null;
    date_from: string;
    date_to: string;
    source: Source;
}

interface ReportWebsite {
    id: number;
    name: string;
    domain: string;
    client_name: string;
}

interface ReportSummary {
    gsc_clicks: number;
    gsc_impressions: number;
    ga4_sessions: number;
    ga4_conversions: number;
}

interface TrendPoint {
    date: string;
    value: number;
}

interface ReportTrends {
    gsc_clicks: TrendPoint[];
    gsc_impressions: TrendPoint[];
    ga4_sessions: TrendPoint[];
}

interface TopQuery {
    query: string;
    clicks: number;
}

interface TopPage {
    page_path: string;
    sessions: number;
}

interface ReportsIndexProps {
    filters: ReportFilters;
    websites: ReportWebsite[];
    has_report_data: boolean;
    summary: ReportSummary;
    trends: ReportTrends;
    top_queries: TopQuery[];
    top_pages: TopPage[];
    seo_insights: unknown[];
}

// ── Inline SVG sparkline ────────────────────────────────────────────────────

function Sparkline({ points, color = '#6366f1' }: { points: TrendPoint[]; color?: string }) {
    if (points.length === 0) {
        return <p className="mt-1 text-xs text-gray-400">No data for range.</p>;
    }

    const W = 200;
    const H = 48;
    const pad = 3;

    const values = points.map((p) => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    const xs = points.map((_, i) =>
        points.length === 1 ? W / 2 : pad + (i / (points.length - 1)) * (W - 2 * pad)
    );
    const ys = values.map((v) => H - pad - ((v - minV) / range) * (H - 2 * pad));

    const linePts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
    const areaPts = `${xs[0]},${H - pad} ${linePts} ${xs[xs.length - 1]},${H - pad}`;

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-12"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <polygon points={areaPts} fill={color} fillOpacity="0.12" />
            <polyline
                points={linePts}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

// ── Sparkline card ──────────────────────────────────────────────────────────

function SparkCard({
    label,
    total,
    points,
    color,
}: {
    label: string;
    total: number;
    points: TrendPoint[];
    color: string;
}) {
    return (
        <Card>
            <CardContent>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{total.toLocaleString()}</p>
                <Sparkline points={points} color={color} />
            </CardContent>
        </Card>
    );
}

// ── Export helpers ──────────────────────────────────────────────────────────

function exportPdfUrl(organization: string, filters: ReportFilters): string {
    try {
        return route('reports.export.pdf', {
            organization,
            ...(filters.website_id !== null ? { website_id: filters.website_id } : {}),
            date_from: filters.date_from,
            date_to: filters.date_to,
            source: filters.source,
        });
    } catch {
        return '#';
    }
}

function applyFilters(organization: string, filters: Partial<ReportFilters>) {
    router.get(
        route('reports.index', { organization }),
        Object.fromEntries(
            Object.entries(filters).filter(([, v]) => v !== null && v !== '' && v !== undefined)
        ) as Record<string, string | number>,
        { preserveScroll: true, replace: true },
    );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ReportsIndex({
    filters,
    websites,
    has_report_data,
    summary,
    trends,
    top_queries,
    top_pages,
}: ReportsIndexProps) {
    const orgSlug = route().params?.organization as string;

    const showGsc = filters.source !== 'ga4';
    const showGa4 = filters.source !== 'gsc';

    const sourceOptions: { value: Source; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'ga4', label: 'GA4 only' },
        { value: 'gsc', label: 'GSC only' },
    ];

    return (
        <AppLayout title="Reports">
            <Head title="Reports" />

            <div className="space-y-6">
                {/* ── Filters ── */}
                <Card>
                    <CardContent>
                        <div className="flex flex-wrap gap-4 items-end justify-between">
                        <div className="flex flex-wrap gap-4 items-end">
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="website_id">Website</Label>
                                <select
                                    id="website_id"
                                    value={filters.website_id ?? ''}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        applyFilters(orgSlug, {
                                            ...filters,
                                            website_id: val === '' ? null : Number(val),
                                        });
                                    }}
                                    className="h-9 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">All websites</option>
                                    {websites.map((w) => (
                                        <option key={w.id} value={w.id}>
                                            {w.name} ({w.domain})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <Label htmlFor="date_from">From</Label>
                                <Input
                                    id="date_from"
                                    type="date"
                                    value={filters.date_from}
                                    onChange={(e) =>
                                        applyFilters(orgSlug, { ...filters, date_from: e.target.value })
                                    }
                                    className="h-9 w-36"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <Label htmlFor="date_to">To</Label>
                                <Input
                                    id="date_to"
                                    type="date"
                                    value={filters.date_to}
                                    onChange={(e) =>
                                        applyFilters(orgSlug, { ...filters, date_to: e.target.value })
                                    }
                                    className="h-9 w-36"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <Label>Data source</Label>
                                <div className="flex rounded-md border border-gray-300 overflow-hidden">
                                    {sourceOptions.map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() =>
                                                applyFilters(orgSlug, { ...filters, source: opt.value })
                                            }
                                            className={`px-3 py-1 text-sm transition-colors ${
                                                filters.source === opt.value
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'bg-white text-gray-600 hover:bg-gray-50'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 self-end">
                            <div className="flex items-center gap-2">
                                <a
                                    href={route('reports.export', {
                                        organization: orgSlug,
                                        ...(filters.website_id !== null ? { website_id: filters.website_id } : {}),
                                        date_from: filters.date_from,
                                        date_to: filters.date_to,
                                        source: filters.source,
                                    })}
                                    title="Download the current report as a CSV file for use in spreadsheets"
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    Download CSV (spreadsheet)
                                </a>
                                <a
                                    href={exportPdfUrl(orgSlug, filters)}
                                    title="Download the current report as a formatted PDF for sharing or printing"
                                    className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 transition-colors"
                                >
                                    Download PDF (formatted report)
                                </a>
                            </div>
                            <p className="text-xs text-gray-400">CSV for spreadsheets and data analysis · PDF for sharing or printing</p>
                        </div>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Empty state ── */}
                {!has_report_data ? (
                    <Card>
                        <CardContent>
                            <div className="py-8 text-center">
                                <p className="text-sm font-medium text-gray-700">No data available</p>
                                <p className="mt-1 text-sm text-gray-500">No report data is available for the selected website, source, and date range.</p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-6">
                        {/* ── Trend sparklines ── */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            {showGsc && (
                                <SparkCard
                                    label="GSC Clicks"
                                    total={summary.gsc_clicks}
                                    points={trends.gsc_clicks}
                                    color="#6366f1"
                                />
                            )}
                            {showGsc && (
                                <SparkCard
                                    label="GSC Impressions"
                                    total={summary.gsc_impressions}
                                    points={trends.gsc_impressions}
                                    color="#8b5cf6"
                                />
                            )}
                            {showGa4 && (
                                <SparkCard
                                    label="GA4 Sessions"
                                    total={summary.ga4_sessions}
                                    points={trends.ga4_sessions}
                                    color="#06b6d4"
                                />
                            )}
                        </div>

                        {/* ── Summary + tables ── */}
                        <div className="grid grid-cols-2 gap-6">
                            {/* Summary */}
                            <Card>
                                <CardHeader>
                                    <p className="text-sm font-medium text-gray-700">Summary</p>
                                </CardHeader>
                                <CardContent>
                                    <dl className="space-y-2 text-sm">
                                        {showGsc && (
                                            <>
                                                <div className="flex justify-between">
                                                    <dt className="text-gray-500">GSC Clicks</dt>
                                                    <dd className="font-medium">
                                                        {summary.gsc_clicks.toLocaleString()}
                                                    </dd>
                                                </div>
                                                <div className="flex justify-between">
                                                    <dt className="text-gray-500">GSC Impressions</dt>
                                                    <dd className="font-medium">
                                                        {summary.gsc_impressions.toLocaleString()}
                                                    </dd>
                                                </div>
                                            </>
                                        )}
                                        {showGa4 && (
                                            <>
                                                <div className="flex justify-between">
                                                    <dt className="text-gray-500">GA4 Sessions</dt>
                                                    <dd className="font-medium">
                                                        {summary.ga4_sessions.toLocaleString()}
                                                    </dd>
                                                </div>
                                                <div className="flex justify-between">
                                                    <dt className="text-gray-500">GA4 Conversions</dt>
                                                    <dd className="font-medium">
                                                        {summary.ga4_conversions.toLocaleString()}
                                                    </dd>
                                                </div>
                                            </>
                                        )}
                                    </dl>
                                </CardContent>
                            </Card>

                            {/* Top Queries (GSC) */}
                            {showGsc && (
                                <Card>
                                    <CardHeader>
                                        <p className="text-sm font-medium text-gray-700">Top Queries</p>
                                    </CardHeader>
                                    <CardContent>
                                        {top_queries.length === 0 ? (
                                            <p className="text-sm text-gray-400">No queries in range.</p>
                                        ) : (
                                            <ul className="space-y-1 text-sm">
                                                {top_queries.slice(0, 5).map((q) => (
                                                    <li key={q.query} className="flex justify-between">
                                                        <span className="text-gray-700 truncate">{q.query}</span>
                                                        <span className="ml-4 text-gray-500">
                                                            {q.clicks} clicks
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* Top Pages (GA4) */}
                            {showGa4 && (
                                <Card>
                                    <CardHeader>
                                        <p className="text-sm font-medium text-gray-700">Top Pages</p>
                                    </CardHeader>
                                    <CardContent>
                                        {top_pages.length === 0 ? (
                                            <p className="text-sm text-gray-400">No pages in range.</p>
                                        ) : (
                                            <ul className="space-y-1 text-sm">
                                                {top_pages.slice(0, 5).map((p) => (
                                                    <li key={p.page_path} className="flex justify-between">
                                                        <span className="text-gray-700 truncate">
                                                            {p.page_path}
                                                        </span>
                                                        <span className="ml-4 text-gray-500">
                                                            {p.sessions} sessions
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
