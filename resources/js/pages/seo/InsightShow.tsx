import React from 'react';
import { Head, Link, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';

interface InsightDetail {
    id: number;
    type: string;
    type_label: string;
    severity: string;
    status: string;
    status_label: string;
    title: string;
    summary: string;
    recommendation: string | null;
    website_name: string | null;
    subject_type: string | null;
    subject_value: string | null;
    created_at: string | null;
    generated_by_name: string | null;
    reviewed_at: string | null;
    reviewed_by_name: string | null;
    review_notes: string | null;
    evidence: Record<string, unknown> | null;
    date_from: string | null;
    date_to: string | null;
}

interface SharedProps {
    currentOrganization: { slug: string };
}

interface Props {
    insight: InsightDetail;
    canUpdateStatus: boolean;
}

const severityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-blue-100 text-blue-800',
};

const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    reviewed: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    dismissed: 'bg-red-100 text-red-700',
};

function StatusForm({ action, label, variant = 'primary' }: {
    action: string;
    label: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
    const { data, setData, post, processing } = useForm({ review_notes: '' });

    return (
        <form onSubmit={(e) => { e.preventDefault(); post(action); }} className="flex flex-col gap-2">
            <Textarea
                placeholder="Review notes (optional)"
                value={data.review_notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData('review_notes', e.target.value)}
                maxLength={1000}
                rows={2}
                className="text-sm"
            />
            <Button type="submit" variant={variant} size="sm" disabled={processing}>
                {label}
            </Button>
        </form>
    );
}

export default function InsightShow({ insight, canUpdateStatus }: Props) {
    const page = usePage();
    const { currentOrganization } = page.props as unknown as SharedProps;
    const org = currentOrganization?.slug ?? page.url.split('/').filter(Boolean)[0] ?? '';
    const isPending = insight.status === 'pending';
    const isReviewed = insight.status === 'reviewed';
    const isApproved = insight.status === 'approved';
    const isDismissed = insight.status === 'dismissed';

    return (
        <AppLayout>
            <Head title={`Insight: ${insight.title}`} />
            <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{insight.title}</h1>
                        {insight.website_name && <p className="text-sm text-gray-500 mt-1">{insight.website_name}</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${severityColors[insight.severity] ?? ''}`}>
                            {insight.severity}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[insight.status] ?? ''}`}>
                            {insight.status_label}
                        </span>
                    </div>
                </div>

                {/* Detail card */}
                <Card>
                    <CardHeader>
                        <h2 className="font-semibold text-gray-900">Details</h2>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="text-sm font-medium text-gray-700">Summary</h3>
                            <p className="text-sm text-gray-600 mt-1">{insight.summary}</p>
                        </div>
                        {insight.recommendation && (
                            <div>
                                <h3 className="text-sm font-medium text-gray-700">Recommendation</h3>
                                <p className="text-sm text-gray-600 mt-1">{insight.recommendation}</p>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="font-medium text-gray-700">Type: </span>
                                <span className="text-gray-600">{insight.type_label}</span>
                            </div>
                            {insight.created_at && (
                                <div>
                                    <span className="font-medium text-gray-700">Generated: </span>
                                    <span className="text-gray-600">{insight.created_at}</span>
                                </div>
                            )}
                            {insight.generated_by_name && (
                                <div>
                                    <span className="font-medium text-gray-700">By: </span>
                                    <span className="text-gray-600">{insight.generated_by_name}</span>
                                </div>
                            )}
                            {insight.date_from && (
                                <div>
                                    <span className="font-medium text-gray-700">Period: </span>
                                    <span className="text-gray-600">{insight.date_from} – {insight.date_to}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Review history */}
                {insight.reviewed_at && (
                    <Card>
                        <CardHeader>
                            <h2 className="font-semibold text-gray-900">Review History</h2>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div>
                                <span className="font-medium text-gray-700">Reviewed: </span>
                                <span className="text-gray-600">{insight.reviewed_at}</span>
                                {insight.reviewed_by_name && (
                                    <span className="text-gray-600"> by {insight.reviewed_by_name}</span>
                                )}
                            </div>
                            {insight.review_notes && (
                                <div>
                                    <span className="font-medium text-gray-700">Notes: </span>
                                    <span className="text-gray-600">{insight.review_notes}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Actions */}
                {canUpdateStatus && (
                    <Card>
                        <CardHeader>
                            <h2 className="font-semibold text-gray-900">Actions</h2>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {(isPending || isDismissed) && (
                                <StatusForm
                                    action={route('seo.insights.reviewed', { organization: org, insight: insight.id })}
                                    label="Mark Reviewed"
                                    variant="secondary"
                                />
                            )}
                            {(isPending || isReviewed || isDismissed) && (
                                <StatusForm
                                    action={route('seo.insights.approved', { organization: org, insight: insight.id })}
                                    label="Approve"
                                    variant="primary"
                                />
                            )}
                            {(isPending || isReviewed || isApproved) && (
                                <StatusForm
                                    action={route('seo.insights.dismissed', { organization: org, insight: insight.id })}
                                    label="Dismiss"
                                    variant="danger"
                                />
                            )}
                            {!isPending && (
                                <StatusForm
                                    action={route('seo.insights.reopened', { organization: org, insight: insight.id })}
                                    label="Reopen"
                                    variant="ghost"
                                />
                            )}
                        </CardContent>
                    </Card>
                )}

                <div className="text-sm">
                    <Link href={route('seo.insights.index', { organization: org })} className="text-indigo-600 hover:underline">
                        ← Back to Insights
                    </Link>
                </div>
            </div>
        </AppLayout>
    );
}
