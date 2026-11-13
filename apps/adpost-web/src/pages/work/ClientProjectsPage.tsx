/** Client portal: projects the agency shared with the client, read-only; comments with permission. */
import { useState } from 'react';
import { Page } from '@/layouts/AppShell';
import { useAction, useBrand, useQuery, fieldErrors } from '@/app/backend';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, Textarea } from '@/components/ui';
import type { Task } from '@/domain/types';
import { formatDateTime } from '@/lib/utils';

const STATUS_LABEL: Record<Task['status'], string> = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done', blocked: 'Blocked' };

export function ClientProjectsPage() {
    const { brand, clientPermissions } = useBrand();
    const projects = useQuery((api) => api.work.projects(brand.id), [brand.id]);
    const tasks = useQuery((api) => api.work.tasks(brand.id), [brand.id]);
    const [open, setOpen] = useState<string | null>(null);
    return (
        <Page title="Projects & Tasks" description={`Work the agency shares with ${brand.name}.`}>
            {projects.loading || tasks.loading ? <LoadingState /> : projects.error ? <ErrorState error={projects.error} /> : !projects.data!.length ? (
                <EmptyState title="No shared projects yet" description="Your agency has not shared any projects with you." />
            ) : (
                projects.data!.map((p) => (
                    <Card key={p.id}>
                        <CardHeader><CardTitle>{p.name}</CardTitle></CardHeader>
                        <CardContent className="space-y-2">
                            {p.description && <p className="text-sm text-fg-secondary">{p.description}</p>}
                            <ul className="divide-y divide-line" aria-label={`${p.name} tasks`}>
                                {(tasks.data ?? []).filter((t) => t.projectId === p.id).map((t) => (
                                    <li key={t.id} className="py-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                            <span className="font-medium text-fg">{t.title}</span>
                                            <span className="flex items-center gap-2"><Badge variant={t.status === 'done' ? 'green' : 'gray'}>{STATUS_LABEL[t.status]}</Badge>
                                                <button type="button" className="text-xs underline text-accent" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>Comments</button></span>
                                        </div>
                                        {open === t.id && <TaskComments taskId={t.id} canComment={clientPermissions.includes('comment_tasks')} />}
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>
                ))
            )}
        </Page>
    );
}

function TaskComments({ taskId, canComment }: { taskId: string; canComment: boolean }) {
    const { brand } = useBrand();
    const comments = useQuery((api) => api.work.comments(brand.id, taskId), [brand.id, taskId]);
    const [body, setBody] = useState('');
    const add = useAction((api) => api.work.addComment(brand.id, taskId, body));
    const errors = fieldErrors(add.error);
    return (
        <div className="mt-2 space-y-2 rounded-lg bg-surface-muted p-3">
            {comments.data?.length ? (
                <ul className="space-y-1 text-sm">{comments.data.map((c) => <li key={c.id}><span className="font-medium">{c.authorName}</span> <span className="text-xs text-fg-muted">{formatDateTime(c.createdAt)}</span><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ul>
            ) : <p className="text-xs text-fg-muted">No comments yet.</p>}
            {canComment ? (
                <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await add.run()) setBody(''); }}>
                    <Textarea aria-label="Add a comment" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
                    {errors.body && <p className="text-xs text-danger">{errors.body}</p>}
                    <Button type="submit" size="sm" loading={add.pending}>Comment</Button>
                </form>
            ) : <p className="text-xs text-fg-muted">Read-only: commenting is not enabled for your account.</p>}
        </div>
    );
}
