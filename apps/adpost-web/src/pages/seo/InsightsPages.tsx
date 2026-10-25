import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Sparkles } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Label, LoadingState, Select, Textarea } from '@/components/ui';
import { useAction, useBrand, useQuery } from '@/app/backend';
import type { InsightFilters } from '@/data/contracts';
import type { SeoInsightStatus, SeoInsightType, Severity } from '@/domain/types';
import { formatDateTime } from '@/lib/utils';
import { INSIGHT_STATUS, INSIGHT_TYPE_LABELS, SEVERITY } from './labels';

export function InsightsListPage() {
    const { brand, can } = useBrand();
    const [filters, setFilters] = useState<InsightFilters>({ status: 'open' });
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const list = useQuery((api) => api.insights.list(brand.id, filters), [brand.id, filters.status, filters.severity, filters.type, filters.websiteId]);
    const generate = useAction((api) => api.insights.generate(brand.id));
    const bulk = useAction((api, status: 'reviewed' | 'dismissed') => api.insights.bulkSetStatus(brand.id, [...selected], status));
    const [notice, setNotice] = useState<string | null>(null);
    const siteName = (id: string) => websites.data?.find((w) => w.id === id)?.domain ?? '';
    const set = (patch: Partial<InsightFilters>) => { setSelected(new Set()); setFilters((f) => ({ ...f, ...patch })); };
    const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    return (
        <Page
            title="SEO Insights"
            description="Rule-based findings from synced analytics, queued for human review"
            actions={can.write && (
                <Button
                    variant="secondary"
                    loading={generate.pending}
                    onClick={async () => {
                        const r = await generate.run();
                        if (r) setNotice(r.created ? `${r.created} new insight${r.created === 1 ? '' : 's'} generated.` : 'No new insights. Everything is already in the queue.');
                    }}
                >
                    <Sparkles className="h-4 w-4" aria-hidden="true" /> Generate insights
                </Button>
            )}
        >
            {notice && <Alert tone="success">{notice}</Alert>}
            {generate.error || bulk.error ? <ErrorState error={generate.error ?? bulk.error} /> : null}
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
                <div>
                    <Label htmlFor="ins-status">Status</Label>
                    <Select id="ins-status" value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as InsightFilters['status'] })}>
                        <option value="open">Open (pending + reviewed)</option>
                        <option value="">All</option>
                        {Object.entries(INSIGHT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select>
                </div>
                <div>
                    <Label htmlFor="ins-severity">Severity</Label>
                    <Select id="ins-severity" value={filters.severity ?? ''} onChange={(e) => set({ severity: (e.target.value || undefined) as Severity })}>
                        <option value="">All</option>
                        {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select>
                </div>
                <div>
                    <Label htmlFor="ins-type">Type</Label>
                    <Select id="ins-type" value={filters.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as SeoInsightType })}>
                        <option value="">All</option>
                        {Object.entries(INSIGHT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                </div>
                <div>
                    <Label htmlFor="ins-site">Website</Label>
                    <Select id="ins-site" value={filters.websiteId ?? ''} onChange={(e) => set({ websiteId: e.target.value || undefined })}>
                        <option value="">All</option>
                        {websites.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                </div>
            </div>

            {can.write && selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm">
                    <span className="font-medium text-indigo-900">{selected.size} selected</span>
                    <Button size="sm" variant="secondary" loading={bulk.pending} onClick={async () => { const r = await bulk.run('reviewed'); if (r) { setSelected(new Set()); setNotice(`${r.updated} marked reviewed.`); } }}>Mark reviewed</Button>
                    <Button size="sm" variant="secondary" loading={bulk.pending} onClick={async () => { const r = await bulk.run('dismissed'); if (r) { setSelected(new Set()); setNotice(`${r.updated} dismissed.`); } }}>Dismiss</Button>
                </div>
            )}

            {list.loading ? (
                <LoadingState />
            ) : list.error ? (
                <ErrorState error={list.error} onRetry={list.reload} />
            ) : !list.data!.length ? (
                <EmptyState title="No insights match these filters" />
            ) : (
                <ul className="space-y-2" aria-label="Insights">
                    {list.data!.map((i) => (
                        <li key={i.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                            {can.write && (
                                <input type="checkbox" className="mt-1 h-4 w-4 rounded border-gray-300" aria-label={`Select ${i.title}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                            )}
                            <div className="min-w-0 flex-1">
                                <Link to={`/b/${brand.slug}/seo/insights/${i.id}`} className="font-medium text-gray-900 hover:text-indigo-700">{i.title}</Link>
                                <p className="mt-0.5 text-sm text-gray-600 line-clamp-2">{i.summary}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                    <Badge variant={SEVERITY[i.severity].variant}>{SEVERITY[i.severity].label}</Badge>
                                    <Badge variant={INSIGHT_STATUS[i.status].variant}>{INSIGHT_STATUS[i.status].label}</Badge>
                                    <span>{INSIGHT_TYPE_LABELS[i.type]}</span>
                                    <span>· {siteName(i.websiteId)}</span>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Page>
    );
}

export function InsightDetailPage() {
    const { insightId = '' } = useParams();
    const { brand, can } = useBrand();
    const q = useQuery((api) => api.insights.get(brand.id, insightId), [brand.id, insightId]);
    const [notes, setNotes] = useState('');
    const update = useAction((api, status: SeoInsightStatus) => api.insights.setStatus(brand.id, insightId, status, notes || undefined));

    if (q.loading) return <Page title="Insight"><LoadingState /></Page>;
    if (q.error || !q.data) return <Page title="Insight"><ErrorState error={q.error} /></Page>;
    const i = q.data;

    const actions: Array<{ to: SeoInsightStatus; label: string; variant?: 'primary' | 'secondary' | 'danger' }> =
        i.status === 'pending' ? [{ to: 'reviewed', label: 'Mark reviewed', variant: 'secondary' }, { to: 'approved', label: 'Approve' }, { to: 'dismissed', label: 'Dismiss', variant: 'secondary' }]
        : i.status === 'reviewed' ? [{ to: 'approved', label: 'Approve' }, { to: 'dismissed', label: 'Dismiss', variant: 'secondary' }]
        : [{ to: 'pending', label: 'Reopen', variant: 'secondary' }];

    return (
        <Page title="Insight" description={`${i.websiteName} · ${i.domain}`} actions={<Link to={`/b/${brand.slug}/seo/insights`} className="text-sm text-indigo-600 hover:text-indigo-700">Back to insights</Link>}>
            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <h2 className="text-base font-semibold text-gray-900">{i.title}</h2>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <Badge variant={SEVERITY[i.severity].variant}>{SEVERITY[i.severity].label} severity</Badge>
                            <Badge variant={INSIGHT_STATUS[i.status].variant}>{INSIGHT_STATUS[i.status].label}</Badge>
                            <Badge variant="indigo">{INSIGHT_TYPE_LABELS[i.type]}</Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div><h3 className="font-medium text-gray-900">Summary</h3><p className="mt-1 text-gray-700">{i.summary}</p></div>
                        <div><h3 className="font-medium text-gray-900">Recommendation</h3><p className="mt-1 text-gray-700">{i.recommendation}</p></div>
                        <div>
                            <h3 className="font-medium text-gray-900">Evidence</h3>
                            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                                {Object.entries(i.evidence).map(([k, v]) => (
                                    <div key={k} className="contents">
                                        <dt className="text-gray-500">{k.replace(/_/g, ' ')}</dt>
                                        <dd className="text-gray-900 tabular-nums">{String(v)}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                        <p className="text-xs text-gray-500">Raised {formatDateTime(i.createdAt)} by {i.source === 'rules' ? 'rule engine' : 'AI agent'}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Review</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        {i.reviewedAt && <p className="text-xs text-gray-500">Last decision {formatDateTime(i.reviewedAt)}</p>}
                        {i.reviewNotes && <p className="rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{i.reviewNotes}</p>}
                        {can.write ? (
                            <>
                                <div>
                                    <Label htmlFor="review-notes">Notes</Label>
                                    <Textarea id="review-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                                </div>
                                {update.error ? <ErrorState error={update.error} /> : null}
                                <div className="flex flex-wrap gap-2">
                                    {actions.map((a) => (
                                        <Button key={a.to} size="sm" variant={a.variant} loading={update.pending} onClick={async () => { if (await update.run(a.to)) setNotes(''); }}>
                                            {a.label}
                                        </Button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-gray-500">Read-only. Your role can view but not review insights.</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </Page>
    );
}
