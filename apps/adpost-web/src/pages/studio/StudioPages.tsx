import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Check, Plus } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Textarea, type BadgeVariant } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import type { WebChangeStage } from '@/domain/types';
import { cn, formatDateTime } from '@/lib/utils';

export const STAGES: Array<{ key: WebChangeStage; label: string }> = [
    { key: 'design', label: 'Design' },
    { key: 'development', label: 'Development' },
    { key: 'review', label: 'Review' },
    { key: 'awaiting_approval', label: 'Approval' },
    { key: 'released', label: 'Released' },
];
const STAGE_BADGE: Record<WebChangeStage, { label: string; variant: BadgeVariant }> = {
    brief: { label: 'Brief', variant: 'gray' },
    design: { label: 'Needs design', variant: 'blue' },
    development: { label: 'Needs development', variant: 'blue' },
    review: { label: 'In review', variant: 'yellow' },
    awaiting_approval: { label: 'Awaiting approval', variant: 'yellow' },
    released: { label: 'Released', variant: 'green' },
    cancelled: { label: 'Cancelled', variant: 'gray' },
};

export function StudioPage() {
    const { brand, can } = useBrand();
    const list = useQuery((api) => api.studio.list(brand.id), [brand.id]);
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const [creating, setCreating] = useState(false);
    const site = (id: string) => websites.data?.find((w) => w.id === id)?.domain ?? '';

    return (
        <Page
            title="Web Studio"
            description="Website changes from brief to release: the Web Design and Web Development agents draft, people review and approve"
            actions={can.write && websites.data?.length ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" /> New change</Button> : null}
        >
            {list.loading ? (
                <LoadingState />
            ) : list.error ? (
                <ErrorState error={list.error} onRetry={list.reload} />
            ) : !list.data!.length ? (
                <EmptyState title="No website changes yet" description="Describe a page or UX change and let the web team draft it." />
            ) : (
                <ul className="space-y-2" aria-label="Website changes">
                    {list.data!.map((c) => (
                        <li key={c.id}>
                            <Link to={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300">
                                <div className="min-w-0">
                                    <p className="font-medium text-gray-900">{c.title}</p>
                                    <p className="text-xs text-gray-500">{site(c.websiteId)} · updated {formatDateTime(c.updatedAt)}</p>
                                </div>
                                <Badge variant={STAGE_BADGE[c.stage].variant}>{STAGE_BADGE[c.stage].label}</Badge>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            {creating && <CreateChangeDialog websites={websites.data ?? []} onClose={() => setCreating(false)} />}
        </Page>
    );
}

function CreateChangeDialog({ websites, onClose }: { websites: Array<{ id: string; name: string }>; onClose: () => void }) {
    const { brand } = useBrand();
    const navigate = useNavigate();
    const [form, setForm] = useState({ websiteId: websites[0]?.id ?? '', title: '', brief: '' });
    const create = useAction((api) => api.studio.create(brand.id, form));
    const errors = fieldErrors(create.error);
    return (
        <Dialog open title="New website change" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.pending} onClick={async () => { const c = await create.run(); if (c) navigate(`/b/${brand.slug}/studio/${c.id}`); }}>Create</Button></>}>
            <div className="space-y-4">
                <Field id="change-site" label="Website" required>
                    <Select id="change-site" value={form.websiteId} onChange={(e) => setForm({ ...form, websiteId: e.target.value })}>{websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
                </Field>
                <Field id="change-title" label="Title" required><Input id="change-title" value={form.title} error={errors.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field id="change-brief" label="Brief" required hint="What should change, for whom, and how success is measured.">
                    <Textarea id="change-brief" rows={5} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} />
                    {errors.brief && <p className="mt-1 text-xs text-red-600">{errors.brief}</p>}
                </Field>
            </div>
        </Dialog>
    );
}

function Proposal({ title, text, empty }: { title: string; text: string | null; empty: string }) {
    return (
        <Card>
            <CardHeader className="flex items-center justify-between"><CardTitle>{title}</CardTitle>{text && <Badge variant="blue">Simulated</Badge>}</CardHeader>
            <CardContent>{text ? <p className="whitespace-pre-wrap text-sm text-gray-700">{text}</p> : <p className="text-sm text-gray-500">{empty}</p>}</CardContent>
        </Card>
    );
}

export function StudioDetailPage() {
    const { changeId = '' } = useParams();
    const { brand, can } = useBrand();
    const q = useQuery((api) => api.studio.get(brand.id, changeId), [brand.id, changeId]);
    const approval = useQuery((api) => (q.data?.approvalId ? api.work.approvals(brand.id).then((l) => l.find((a) => a.id === q.data!.approvalId) ?? null) : Promise.resolve(null)), [brand.id, q.data?.approvalId]);
    const design = useAction((api) => api.studio.runDesign(brand.id, changeId));
    const dev = useAction((api) => api.studio.runDevelopment(brand.id, changeId));
    const toggle = useAction((api, key: string) => api.studio.toggleChecklist(brand.id, changeId, key));
    const release = useAction((api) => api.studio.requestRelease(brand.id, changeId));
    const released = useAction((api) => api.studio.markReleased(brand.id, changeId));
    const cancel = useAction((api) => api.studio.cancel(brand.id, changeId));
    const error = design.error ?? dev.error ?? toggle.error ?? release.error ?? released.error ?? cancel.error;

    if (q.loading) return <Page title="Web change"><LoadingState /></Page>;
    if (q.error || !q.data) return <Page title="Web change"><ErrorState error={q.error} /></Page>;
    const c = q.data;
    const current = STAGES.findIndex((s) => s.key === c.stage);

    return (
        <Page title={c.title} description="Web Studio change" actions={<Link to={`/b/${brand.slug}/studio`} className="text-sm text-indigo-600 hover:text-indigo-700">All changes</Link>}>
            <ol className="flex flex-wrap gap-2" aria-label="Pipeline">
                {STAGES.map((s, i) => {
                    const done = c.stage !== 'cancelled' && (i < current || c.stage === 'released');
                    const active = s.key === c.stage;
                    return (
                        <li key={s.key} aria-current={active ? 'step' : undefined} className={cn('flex items-center gap-1 rounded-full border px-3 py-1 text-xs', active ? 'border-indigo-600 bg-indigo-50 text-indigo-800' : done ? 'border-green-200 bg-green-50 text-green-800' : 'border-gray-200 text-gray-500')}>
                            {done && <Check className="h-3 w-3" aria-hidden="true" />} {s.label}
                        </li>
                    );
                })}
                {c.stage === 'cancelled' && <li><Badge>Cancelled</Badge></li>}
            </ol>
            {error ? <ErrorState error={error} /> : null}
            <Card>
                <CardHeader><CardTitle>Brief</CardTitle></CardHeader>
                <CardContent><p className="whitespace-pre-wrap text-sm text-gray-700">{c.brief}</p></CardContent>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
                <Proposal title="Design proposal · Web Design Agent" text={c.designProposal} empty="Not drafted yet." />
                <Proposal title="Implementation proposal · Web Development Agent" text={c.devProposal} empty={c.designProposal ? 'Not drafted yet.' : 'Drafted after the design step.'} />
            </div>
            {can.write && (
                <div className="flex flex-wrap gap-2">
                    {['design', 'development', 'review'].includes(c.stage) && <Button variant={c.stage === 'design' ? 'primary' : 'secondary'} loading={design.pending} onClick={() => void design.run()}>{c.designProposal ? 'Redraft design' : 'Draft design'}</Button>}
                    {['development', 'review'].includes(c.stage) && <Button variant={c.stage === 'development' ? 'primary' : 'secondary'} loading={dev.pending} onClick={() => void dev.run()}>{c.devProposal ? 'Redraft implementation' : 'Draft implementation'}</Button>}
                    {c.stage !== 'released' && c.stage !== 'cancelled' && <Button variant="ghost" onClick={() => confirm('Cancel this change?') && void cancel.run()}>Cancel change</Button>}
                </div>
            )}
            {(c.stage === 'review' || c.stage === 'awaiting_approval' || c.stage === 'released') && (
                <Card>
                    <CardHeader><CardTitle>Release checklist</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        <ul className="space-y-1">
                            {c.checklist.map((i) => (
                                <li key={i.key}>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={i.done} disabled={!can.write || c.stage !== 'review'} onChange={() => void toggle.run(i.key)} />
                                        {i.label}
                                    </label>
                                </li>
                            ))}
                        </ul>
                        {c.stage === 'review' && can.write && (
                            <Button loading={release.pending} disabled={c.checklist.some((i) => !i.done)} onClick={() => void release.run()}>Request release approval</Button>
                        )}
                        {c.stage === 'awaiting_approval' && (
                            <Alert tone={approval.data?.status === 'approved' ? 'success' : approval.data?.status === 'rejected' ? 'error' : 'info'}>
                                Release approval is <strong>{approval.data?.status ?? 'pending'}</strong>.{' '}
                                <Link to={`/b/${brand.slug}/approvals`} className="underline">Open approvals</Link>
                            </Alert>
                        )}
                        {c.stage === 'awaiting_approval' && approval.data?.status === 'approved' && can.admin && (
                            <Button loading={released.pending} onClick={() => void released.run()}>Mark as released</Button>
                        )}
                        {c.stage === 'released' && (
                            <Alert tone="success">Released {c.releasedAt && formatDateTime(c.releasedAt)}. Local mode records the release only. Deployment to the live site happens outside this app.</Alert>
                        )}
                    </CardContent>
                </Card>
            )}
        </Page>
    );
}
