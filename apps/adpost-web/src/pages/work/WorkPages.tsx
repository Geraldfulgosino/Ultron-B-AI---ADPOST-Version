import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, Dialog, EmptyState, ErrorState, Field, Input, Label, LoadingState, Select, Textarea, type BadgeVariant } from '@/components/ui';
import { fieldErrors, useAction, useBackend, useBrand, useQuery } from '@/app/backend';
import type { ApprovalKind, ApprovalRequest, ApprovalStatus, Assignee, Task, TaskPriority, TaskStatus } from '@/domain/types';
import type { AgentInstance } from '@/domain/types';
import type { MemberView } from '@/data/contracts';
import { formatDate, formatDateTime } from '@/lib/utils';

export const STATUS_LABELS: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done', blocked: 'Blocked' };
const STATUSES = Object.keys(STATUS_LABELS) as TaskStatus[];
const PRIORITY: Record<TaskPriority, { label: string; variant: BadgeVariant }> = {
    urgent: { label: 'Urgent', variant: 'red' },
    high: { label: 'High', variant: 'yellow' },
    medium: { label: 'Medium', variant: 'blue' },
    low: { label: 'Low', variant: 'gray' },
};
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
    publish_content: 'Publish content',
    deploy_change: 'Deploy change',
    run_webhook: 'Run webhook',
    external_action: 'External action',
    budget_increase: 'Budget increase',
};
const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; variant: BadgeVariant }> = {
    pending: { label: 'Pending', variant: 'yellow' },
    approved: { label: 'Approved', variant: 'green' },
    rejected: { label: 'Rejected', variant: 'red' },
    cancelled: { label: 'Cancelled', variant: 'gray' },
};

function assigneeKey(a: Assignee): string {
    return !a ? '' : a.type === 'agent' ? `agent:${a.agentInstanceId}` : `user:${a.userId}`;
}
function parseAssignee(v: string): Assignee {
    if (!v) return null;
    const [type, id] = v.split(':') as ['agent' | 'user', string];
    return type === 'agent' ? { type, agentInstanceId: id } : { type, userId: id };
}

function useAssignees() {
    const { brand } = useBrand();
    const agents = useQuery((api) => api.agents.list(brand.id), [brand.id]);
    const members = useQuery((api) => api.members.list(brand.id), [brand.id]);
    const people = (members.data ?? []).filter((m) => m.role !== 'viewer' && m.role !== 'client');
    const label = (a: Assignee) => (!a ? 'Unassigned' : a.type === 'agent' ? agents.data?.find((x) => x.id === a.agentInstanceId)?.displayName ?? 'Agent' : members.data?.find((m) => m.userId === a.userId)?.name ?? 'Member');
    return { agents: agents.data ?? [], people, label };
}

function AssigneeSelect({ id, value, onChange, agents, people }: { id: string; value: Assignee; onChange: (a: Assignee) => void; agents: AgentInstance[]; people: MemberView[] }) {
    return (
        <Select id={id} value={assigneeKey(value)} onChange={(e) => onChange(parseAssignee(e.target.value))}>
            <option value="">Unassigned</option>
            <optgroup label="People">{people.map((p) => <option key={p.userId} value={`user:${p.userId}`}>{p.name}</option>)}</optgroup>
            <optgroup label="AI agents">{agents.map((a) => <option key={a.id} value={`agent:${a.id}`}>{a.displayName}</option>)}</optgroup>
        </Select>
    );
}

export function ProjectsPage() {
    const { brand, can } = useBrand();
    const [params, setParams] = useSearchParams();
    const projects = useQuery((api) => api.work.projects(brand.id), [brand.id]);
    const projectId = params.get('project') ?? projects.data?.[0]?.id ?? '';
    const tasks = useQuery((api) => (projectId ? api.work.tasks(brand.id, { projectId }) : Promise.resolve([])), [brand.id, projectId]);
    const move = useAction((api, id: string, status: TaskStatus) => api.work.updateTask(brand.id, id, { status }));
    const removeProject = useAction((api, id: string) => api.work.removeProject(brand.id, id));
    const { agents, people, label } = useAssignees();
    const [newProject, setNewProject] = useState(false);
    const [editing, setEditing] = useState<Task | 'new' | null>(null);
    const project = projects.data?.find((p) => p.id === projectId);

    return (
        <Page
            title="Projects & Tasks"
            description="Work for people and AI agents in this brand"
            actions={can.write && (
                <>
                    <Button variant="secondary" onClick={() => setNewProject(true)}><Plus className="h-4 w-4" aria-hidden="true" /> New project</Button>
                    {project && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" /> New task</Button>}
                </>
            )}
        >
            {move.error || removeProject.error ? <ErrorState error={move.error ?? removeProject.error} /> : null}
            {projects.loading ? (
                <LoadingState />
            ) : projects.error ? (
                <ErrorState error={projects.error} onRetry={projects.reload} />
            ) : !projects.data!.length ? (
                <EmptyState title="No projects yet" description="Create a project, or apply a task proposal from an agent chat. Applied proposals land in an Agent requests project." />
            ) : (
                <>
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-56">
                            <Label htmlFor="project-picker">Project</Label>
                            <Select id="project-picker" value={projectId} onChange={(e) => setParams({ project: e.target.value })}>
                                {projects.data!.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} ({Object.values(p.taskCounts).reduce((a, b) => a + b, 0)})
                                    </option>
                                ))}
                            </Select>
                        </div>
                        {project?.description && <p className="text-sm text-gray-500">{project.description}</p>}
                        {can.admin && project && (
                            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => confirm(`Delete ${project.name} and all its tasks?`) && void removeProject.run(project.id).then(() => setParams({}))}>
                                Delete project
                            </Button>
                        )}
                    </div>
                    <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5" aria-label="Task board">
                        {STATUSES.map((status) => {
                            const col = (tasks.data ?? []).filter((t) => t.status === status);
                            return (
                                <section key={status} aria-labelledby={`col-${status}`} className="rounded-xl bg-gray-100 p-3">
                                    <h2 id={`col-${status}`} className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        {STATUS_LABELS[status]} <span className="tabular-nums">{col.length}</span>
                                    </h2>
                                    <ul className="space-y-2">
                                        {col.map((t) => (
                                            <li key={t.id}>
                                                <Card>
                                                    <CardContent className="space-y-2 px-3 py-3">
                                                        <button type="button" className="text-left text-sm font-medium text-gray-900 hover:text-indigo-700" onClick={() => setEditing(t)}>
                                                            {t.title}
                                                        </button>
                                                        <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
                                                            <Badge variant={PRIORITY[t.priority].variant}>{PRIORITY[t.priority].label}</Badge>
                                                            <span>{label(t.assignee)}</span>
                                                            {t.dueDate && <span>· due {formatDate(t.dueDate + 'T00:00:00Z')}</span>}
                                                            {t.createdBy.type === 'agent' && <Badge variant="indigo">From agent</Badge>}
                                                        </div>
                                                        {can.write && (
                                                            <Select aria-label={`Status of ${t.title}`} value={t.status} className="py-1 text-xs" onChange={(e) => void move.run(t.id, e.target.value as TaskStatus)}>
                                                                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                                                            </Select>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            );
                        })}
                    </div>
                </>
            )}
            {newProject && <ProjectDialog onClose={() => setNewProject(false)} onCreated={(id) => setParams({ project: id })} />}
            {editing && project && <TaskDialog task={editing === 'new' ? null : editing} projectId={project.id} agents={agents} people={people} readOnly={!can.write} onClose={() => setEditing(null)} />}
        </Page>
    );
}

function ProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
    const { brand } = useBrand();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const create = useAction((api) => api.work.createProject(brand.id, { name, description }));
    const errors = fieldErrors(create.error);
    return (
        <Dialog open title="New project" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.pending} onClick={async () => { const p = await create.run(); if (p) { onCreated(p.id); onClose(); } }}>Create project</Button></>}>
            <div className="space-y-4">
                <Field id="project-name" label="Name" required><Input id="project-name" value={name} error={errors.name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field id="project-description" label="Description"><Textarea id="project-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            </div>
        </Dialog>
    );
}

function TaskDialog({ task, projectId, agents, people, readOnly, onClose }: { task: Task | null; projectId: string; agents: AgentInstance[]; people: MemberView[]; readOnly: boolean; onClose: () => void }) {
    const { brand } = useBrand();
    const [form, setForm] = useState({
        title: task?.title ?? '', description: task?.description ?? '', status: task?.status ?? ('todo' as TaskStatus),
        priority: task?.priority ?? ('medium' as TaskPriority), assignee: task?.assignee ?? (null as Assignee), dueDate: task?.dueDate ?? '',
    });
    const save = useAction((api) => {
        const input = { ...form, dueDate: form.dueDate || null };
        return task ? api.work.updateTask(brand.id, task.id, input) : api.work.createTask(brand.id, { projectId, ...input });
    });
    const remove = useAction((api) => api.work.removeTask(brand.id, task!.id));
    const errors = fieldErrors(save.error);
    return (
        <Dialog
            open
            title={task ? 'Task' : 'New task'}
            onClose={onClose}
            footer={readOnly ? <Button onClick={onClose}>Close</Button> : (
                <>
                    {task && <Button variant="ghost" className="mr-auto" onClick={async () => { await remove.run(); onClose(); }}>Delete</Button>}
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button loading={save.pending} onClick={async () => (await save.run()) && onClose()}>{task ? 'Save' : 'Create task'}</Button>
                </>
            )}
        >
            <fieldset disabled={readOnly} className="space-y-4">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Field id="task-title" label="Title" required><Input id="task-title" value={form.title} error={errors.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field id="task-description" label="Description"><Textarea id="task-description" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="task-status" label="Status"><Select id="task-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select></Field>
                    <Field id="task-priority" label="Priority"><Select id="task-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>{(Object.keys(PRIORITY) as TaskPriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}</Select></Field>
                    <Field id="task-assignee" label="Assignee"><AssigneeSelect id="task-assignee" value={form.assignee} onChange={(assignee) => setForm({ ...form, assignee })} agents={agents} people={people} /></Field>
                    <Field id="task-due" label="Due date"><Input id="task-due" type="date" value={form.dueDate} error={errors.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
                </div>
                {errors.assignee && <p className="text-xs text-red-600">{errors.assignee}</p>}
                {task?.sourceMessageId && <p className="text-xs text-gray-500">Created from an agent proposal in chat.</p>}
            </fieldset>
        </Dialog>
    );
}

export function ApprovalsPage() {
    const { brand, can } = useBrand();
    const [status, setStatus] = useState<ApprovalStatus | ''>('pending');
    const list = useQuery((api) => api.work.approvals(brand.id, status ? { status } : {}), [brand.id, status]);
    const agents = useQuery((api) => api.agents.list(brand.id), [brand.id]);
    const members = useQuery((api) => api.members.list(brand.id), [brand.id]);
    const [deciding, setDeciding] = useState<{ req: ApprovalRequest; decision: 'approved' | 'rejected' } | null>(null);
    const { session } = useBackend();
    const mine = (r: ApprovalRequest) => r.requestedBy.type === 'user' && r.requestedBy.userId === session?.user.id;
    const cancel = useAction((api, id: string) => api.work.cancelApproval(brand.id, id));
    const who = (r: ApprovalRequest) =>
        r.requestedBy.type === 'agent' ? agents.data?.find((a) => a.id === (r.requestedBy as { agentInstanceId: string }).agentInstanceId)?.displayName ?? 'Agent'
        : r.requestedBy.type === 'user' ? members.data?.find((m) => m.userId === (r.requestedBy as { userId: string }).userId)?.name ?? 'Member' : 'System';

    return (
        <Page title="Approvals" description="Human sign-off for anything with an external effect">
            <Alert tone="info">Approving a request records the decision. In local mode nothing external is executed: publishing, deploys and webhooks run server-side after Phase 17.</Alert>
            {cancel.error ? <ErrorState error={cancel.error} /> : null}
            <div className="max-w-xs">
                <Label htmlFor="approval-status">Status</Label>
                <Select id="approval-status" value={status} onChange={(e) => setStatus(e.target.value as ApprovalStatus | '')}>
                    <option value="">All</option>
                    {Object.entries(APPROVAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
            </div>
            {list.loading ? (
                <LoadingState />
            ) : list.error ? (
                <ErrorState error={list.error} onRetry={list.reload} />
            ) : !list.data!.length ? (
                <EmptyState title={status === 'pending' ? 'Nothing waiting for approval' : 'No requests'} />
            ) : (
                <ul className="space-y-3" aria-label="Approval requests">
                    {list.data!.map((r) => (
                        <li key={r.id}>
                            <Card>
                                <CardContent className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={APPROVAL_STATUS[r.status].variant}>{APPROVAL_STATUS[r.status].label}</Badge>
                                        <Badge variant="indigo">{APPROVAL_KIND_LABELS[r.kind]}</Badge>
                                        <span className="font-medium text-gray-900">{r.title}</span>
                                    </div>
                                    <p className="text-sm text-gray-700">{r.summary}</p>
                                    <p className="text-xs text-gray-500">
                                        Requested by {who(r)} {r.requestedBy.type === 'agent' && '(AI agent)'} · {formatDateTime(r.createdAt)}
                                        {r.payload.conversationId && <> · <Link className="text-indigo-600" to={`/b/${brand.slug}/chat/${r.payload.conversationId}`}>source conversation</Link></>}
                                    </p>
                                    {r.decisionNote && <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">Decision note: {r.decisionNote}</p>}
                                    {r.status === 'pending' && (
                                        <div className="flex flex-wrap gap-2">
                                            {can.admin && !mine(r) && <Button size="sm" onClick={() => setDeciding({ req: r, decision: 'approved' })}>Approve</Button>}
                                            {can.admin && !mine(r) && <Button size="sm" variant="secondary" onClick={() => setDeciding({ req: r, decision: 'rejected' })}>Reject</Button>}
                                            {(can.admin || mine(r)) && <Button size="sm" variant="ghost" onClick={() => void cancel.run(r.id)}>Cancel request</Button>}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
            {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} />}
        </Page>
    );
}

function DecisionDialog({ req, decision, onClose }: { req: ApprovalRequest; decision: 'approved' | 'rejected'; onClose: () => void }) {
    const { brand } = useBrand();
    const [note, setNote] = useState('');
    const decide = useAction((api) => api.work.decideApproval(brand.id, req.id, decision, note));
    const errors = fieldErrors(decide.error);
    return (
        <Dialog
            open
            title={decision === 'approved' ? 'Approve request' : 'Reject request'}
            onClose={onClose}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={decision === 'rejected' ? 'danger' : 'primary'} loading={decide.pending} onClick={async () => (await decide.run()) && onClose()}>{decision === 'approved' ? 'Approve' : 'Reject'}</Button></>}
        >
            <div className="space-y-3">
                <p className="text-sm text-gray-700"><strong>{req.title}</strong>: {req.summary}</p>
                {decide.error && !Object.keys(errors).length ? <ErrorState error={decide.error} /> : null}
                <Field id="decision-note" label={decision === 'rejected' ? 'Reason' : 'Note (optional)'} required={decision === 'rejected'}>
                    <Textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                    {errors.note && <p className="mt-1 text-xs text-red-600">{errors.note}</p>}
                </Field>
            </div>
        </Dialog>
    );
}
