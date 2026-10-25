import React, { useState } from 'react';
import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';

interface Insight {
    id: number;
    type: string;
    type_label: string;
    status: string;
    status_label: string;
    severity: string;
    title: string;
    website_name: string | null;
    reviewed_by_name: string | null;
    created_at: string | null;
}

interface PaginatedInsights {
    data: Insight[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
    links: Array<{ url: string | null; label: string; active: boolean }>;
}

interface Website {
    id: number;
    name: string;
    domain: string;
}

interface Filters {
    type?: string;
    status?: string;
    website_id?: string;
    severity?: string;
    date_from?: string;
    date_to?: string;
}

interface Props {
    insights: PaginatedInsights;
    filters: Filters;
    websites: Website[];
    canUpdateStatus: boolean;
}

const severityColors: Record<string, string> = {
    critical: 'text-red-700 bg-red-50',
    high: 'text-orange-700 bg-orange-50',
    medium: 'text-yellow-700 bg-yellow-50',
    low: 'text-blue-700 bg-blue-50',
};

const statusColors: Record<string, string> = {
    pending: 'text-gray-700 bg-gray-100',
    reviewed: 'text-blue-700 bg-blue-100',
    approved: 'text-green-700 bg-green-100',
    dismissed: 'text-red-700 bg-red-100',
};

interface SharedProps {
    currentOrganization: { slug: string };
}

export default function InsightsIndex({ insights, filters, websites, canUpdateStatus }: Props) {
    const page = usePage();
    const { currentOrganization } = page.props as unknown as SharedProps;
    const org = currentOrganization?.slug ?? page.url.split('/').filter(Boolean)[0] ?? '';
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkNotes, setBulkNotes] = useState('');

    const allIds = insights.data.map((i) => i.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

    const toggleAll = () => {
        setSelected(allSelected ? new Set() : new Set(allIds));
    };

    const toggleOne = (id: number) => {
        const next = new Set(selected);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelected(next);
    };

    const submitFilter = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const params: Record<string, string> = {};
        for (const [key, val] of formData.entries()) {
            if (typeof val === 'string' && val.trim()) {
                params[key] = val.trim();
            }
        }
        router.get(window.location.pathname, params, { preserveState: true, replace: true });
    };

    const submitBulk = (action: 'bulk-reviewed' | 'bulk-dismissed') => {
        router.post(route(`seo.insights.${action}`, { organization: org }), {
            ids: Array.from(selected),
            review_notes: bulkNotes || undefined,
        });
        setSelected(new Set());
        setBulkNotes('');
    };

    return (
        <AppLayout>
            <Head title="SEO Insights" />
            <div className="max-w-7xl mx-auto py-8 px-4 space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-gray-900">SEO Insights</h1>
                    <Link href={route('seo.index', { organization: org })} className="text-sm text-indigo-600 hover:underline">
                        ← Dashboard
                    </Link>
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="pt-4">
                        <form onSubmit={submitFilter} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
                            <div>
                                <Label>Status</Label>
                                <select name="status" defaultValue={filters.status ?? ''} className="w-full mt-1 border rounded-md px-2 py-1.5 text-sm">
                                    <option value="">All</option>
                                    <option value="pending">Pending</option>
                                    <option value="reviewed">Reviewed</option>
                                    <option value="approved">Approved</option>
                                    <option value="dismissed">Dismissed</option>
                                </select>
                            </div>
                            <div>
                                <Label>Severity</Label>
                                <select name="severity" defaultValue={filters.severity ?? ''} className="w-full mt-1 border rounded-md px-2 py-1.5 text-sm">
                                    <option value="">All</option>
                                    <option value="critical">Critical</option>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            <div>
                                <Label>Website</Label>
                                <select name="website_id" defaultValue={filters.website_id ?? ''} className="w-full mt-1 border rounded-md px-2 py-1.5 text-sm">
                                    <option value="">All</option>
                                    {websites.map((w) => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <Label>From</Label>
                                <Input type="date" name="date_from" defaultValue={filters.date_from ?? ''} className="mt-1" />
                            </div>
                            <div>
                                <Label>To</Label>
                                <Input type="date" name="date_to" defaultValue={filters.date_to ?? ''} className="mt-1" />
                            </div>
                            <Button type="submit" size="sm">Filter</Button>
                        </form>
                    </CardContent>
                </Card>

                {/* Bulk actions */}
                {canUpdateStatus && selected.size > 0 && (
                    <Card>
                        <CardContent className="pt-4 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                            <div className="flex-1">
                                <Label>Bulk review notes (optional)</Label>
                                <Textarea
                                    value={bulkNotes}
                                    onChange={(e) => setBulkNotes(e.target.value)}
                                    maxLength={1000}
                                    rows={2}
                                    placeholder="Notes applied to all selected insights…"
                                    className="mt-1"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button variant="secondary" size="sm" onClick={() => submitBulk('bulk-reviewed')}>
                                    Mark {selected.size} Reviewed
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => submitBulk('bulk-dismissed')}>
                                    Dismiss {selected.size}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Table */}
                <Card>
                    <CardContent className="p-0 overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    {canUpdateStatus && (
                                        <th className="w-10 px-4 py-3">
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={toggleAll}
                                                className="rounded border-gray-300"
                                            />
                                        </th>
                                    )}
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Insight</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Website</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Severity</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                                    <th className="w-20 px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                                {insights.data.length === 0 && (
                                    <tr>
                                        <td colSpan={canUpdateStatus ? 7 : 6} className="px-4 py-8 text-center text-sm text-gray-500">
                                            No insights found.
                                        </td>
                                    </tr>
                                )}
                                {insights.data.map((insight) => (
                                    <tr key={insight.id} className="hover:bg-gray-50">
                                        {canUpdateStatus && (
                                            <td className="px-4 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(insight.id)}
                                                    onChange={() => toggleOne(insight.id)}
                                                    className="rounded border-gray-300"
                                                />
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <div className="text-sm font-medium text-gray-900">{insight.title}</div>
                                            <div className="text-xs text-gray-500">{insight.type_label}</div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{insight.website_name ?? '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${severityColors[insight.severity] ?? ''}`}>
                                                {insight.severity}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[insight.status] ?? ''}`}>
                                                {insight.status_label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{insight.created_at ?? '—'}</td>
                                        <td className="px-4 py-3 text-right">
                                            <Link
                                                href={route('seo.insights.show', { organization: org, insight: insight.id })}
                                                className="text-xs text-indigo-600 hover:underline"
                                            >
                                                View →
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>

                {/* Pagination */}
                {insights.last_page > 1 && (
                    <div className="flex justify-center gap-1">
                        {insights.links.map((link, i) => (
                            link.url ? (
                                <Link
                                    key={i}
                                    href={link.url}
                                    className={`px-3 py-1.5 text-sm rounded border ${link.active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                                    dangerouslySetInnerHTML={{ __html: link.label }}
                                />
                            ) : (
                                <span
                                    key={i}
                                    className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-400"
                                    dangerouslySetInnerHTML={{ __html: link.label }}
                                />
                            )
                        ))}
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
