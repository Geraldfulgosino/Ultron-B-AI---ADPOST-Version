import type { ApprovalRequest, Assignee, ID, Project, Task, TaskPriority, TaskStatus } from '@/domain/types';
import type { WorkApi } from '../contracts';
import { AccessDeniedError, assertValid, NotFoundError, ValidationError } from '../errors';
import { can } from '../access';
import { newId } from '@/lib/utils';
import type { Scope } from './scope';
import { emitAutomationEvent } from './automation';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done', 'blocked'];
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const APPROVAL_KINDS = ['publish_content', 'deploy_change', 'run_webhook', 'external_action', 'budget_increase'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Default inbox for work created from agent proposals. */
export const AGENT_INBOX = 'Agent requests';

export function localWork(scope: Scope): WorkApi {
    const { db } = scope;

    const validAssignee = (brandId: ID, a: Assignee | undefined): string | false => {
        if (!a) return false;
        if (a.type === 'agent') return !db.all('agentInstances').some((x) => x.id === a.agentInstanceId && x.brandId === brandId) && 'Assign an agent from this brand.';
        return !db.all('brandMemberships').some((m) => m.userId === a.userId && m.brandId === brandId && m.role !== 'client' && m.role !== 'viewer') && 'Assign a brand member who can edit.';
    };

    const inbox = (brandId: ID): Project =>
        db.all('projects').find((p) => p.brandId === brandId && p.name === AGENT_INBOX) ??
        db.insert('projects', { id: newId('prj'), brandId, name: AGENT_INBOX, description: 'Tasks proposed by AI agents and accepted by a person.', status: 'active', websiteId: null, createdAt: db.nowIso() });

    const insertTask = (brandId: ID, t: Omit<Task, 'id' | 'brandId' | 'createdAt' | 'updatedAt'>): Task => {
        const task: Task = { id: newId('tsk'), brandId, ...t, createdAt: db.nowIso(), updatedAt: db.nowIso() };
        db.insert('tasks', task);
        scope.audit(brandId, 'task.created', 'task', task.id);
        return task;
    };

    const insertApproval = (brandId: ID, a: Omit<ApprovalRequest, 'id' | 'brandId' | 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'createdAt'>): ApprovalRequest => {
        const req: ApprovalRequest = { id: newId('apr'), brandId, ...a, status: 'pending', decidedBy: null, decidedAt: null, decisionNote: null, createdAt: db.nowIso() };
        db.insert('approvals', req);
        scope.audit(brandId, 'approval.requested', 'approval_request', req.id);
        return req;
    };

    return {
        async projects(brandId) {
            const tasks = scope.rows('tasks', brandId);
            return scope
                .rows('projects', brandId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => {
                    const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
                    for (const t of tasks) if (t.projectId === p.id) counts[t.status]++;
                    return { ...p, taskCounts: counts };
                });
        },

        async createProject(brandId, input) {
            scope.require(brandId, 'write');
            const name = input.name?.trim() ?? '';
            assertValid({
                name: !name ? 'Project name is required.' : db.all('projects').some((p) => p.brandId === brandId && p.name.toLowerCase() === name.toLowerCase()) && 'A project with this name already exists.',
                websiteId: input.websiteId && !db.all('websites').some((w) => w.id === input.websiteId && w.brandId === brandId) && 'Choose a website from this brand.',
            });
            const p: Project = { id: newId('prj'), brandId, name, description: input.description?.trim() ?? '', status: input.status ?? 'active', websiteId: input.websiteId ?? null, createdAt: db.nowIso() };
            db.insert('projects', p);
            scope.audit(brandId, 'project.created', 'project', p.id);
            return structuredClone(p);
        },

        async updateProject(brandId, id, input) {
            scope.require(brandId, 'write');
            scope.owned('projects', brandId, id, 'Project');
            assertValid({
                name: input.name !== undefined && !input.name.trim() && 'Project name is required.',
                websiteId: input.websiteId && !db.all('websites').some((w) => w.id === input.websiteId && w.brandId === brandId) && 'Choose a website from this brand.',
            });
            const patch: Partial<Project> = {};
            if (input.name !== undefined) patch.name = input.name.trim();
            if (input.description !== undefined) patch.description = input.description.trim();
            if (input.status !== undefined) patch.status = input.status;
            if (input.websiteId !== undefined) patch.websiteId = input.websiteId;
            return structuredClone(db.patch('projects', id, patch));
        },

        async removeProject(brandId, id) {
            scope.require(brandId, 'admin');
            scope.owned('projects', brandId, id, 'Project');
            const taskIds = new Set(db.all('tasks').filter((t) => t.projectId === id).map((t) => t.id));
            db.delete('tasks', (t) => taskIds.has(t.id));
            db.all('approvals').filter((a) => a.taskId && taskIds.has(a.taskId)).forEach((a) => db.patch('approvals', a.id, { taskId: null }));
            db.delete('projects', (p) => p.id === id);
            scope.audit(brandId, 'project.deleted', 'project', id);
        },

        async tasks(brandId, f = {}) {
            const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
            return scope
                .rows('tasks', brandId)
                .filter((t) =>
                    (!f.projectId || t.projectId === f.projectId) &&
                    (!f.status || t.status === f.status) &&
                    (!f.agentInstanceId || (t.assignee?.type === 'agent' && t.assignee.agentInstanceId === f.agentInstanceId)) &&
                    (!f.userId || (t.assignee?.type === 'user' && t.assignee.userId === f.userId)),
                )
                .sort((a, b) => rank[a.priority] - rank[b.priority] || b.createdAt.localeCompare(a.createdAt));
        },

        async createTask(brandId, input) {
            scope.require(brandId, 'write');
            const title = input.title?.trim() ?? '';
            assertValid({
                title: (!title && 'Task title is required.') || (title.length > 200 && 'Titles are limited to 200 characters.'),
                projectId: !db.all('projects').some((p) => p.id === input.projectId && p.brandId === brandId) && 'Choose a project from this brand.',
                priority: input.priority && !PRIORITIES.includes(input.priority) && 'Unknown priority.',
                status: input.status && !TASK_STATUSES.includes(input.status) && 'Unknown status.',
                assignee: validAssignee(brandId, input.assignee ?? undefined),
                dueDate: input.dueDate && !DATE.test(input.dueDate) && 'Due date must be YYYY-MM-DD.',
            });
            const task = insertTask(brandId, {
                projectId: input.projectId, title, description: input.description?.trim() ?? '', status: input.status ?? 'todo', priority: input.priority ?? 'medium',
                assignee: input.assignee ?? null, createdBy: { type: 'user', userId: scope.userId }, sourceMessageId: null, dueDate: input.dueDate ?? null,
            });
            return structuredClone(task);
        },

        async updateTask(brandId, id, input) {
            scope.require(brandId, 'write');
            const before = scope.owned('tasks', brandId, id, 'Task');
            assertValid({
                title: input.title !== undefined && !input.title.trim() && 'Task title is required.',
                projectId: input.projectId && !db.all('projects').some((p) => p.id === input.projectId && p.brandId === brandId) && 'Choose a project from this brand.',
                priority: input.priority && !PRIORITIES.includes(input.priority) && 'Unknown priority.',
                status: input.status && !TASK_STATUSES.includes(input.status) && 'Unknown status.',
                assignee: validAssignee(brandId, input.assignee ?? undefined),
                dueDate: input.dueDate && !DATE.test(input.dueDate) && 'Due date must be YYYY-MM-DD.',
            });
            const wasDone = before.status === 'done';
            const patch: Partial<Task> = { updatedAt: db.nowIso() };
            if (input.title !== undefined) patch.title = input.title.trim();
            if (input.description !== undefined) patch.description = input.description.trim();
            if (input.status !== undefined) patch.status = input.status;
            if (input.priority !== undefined) patch.priority = input.priority;
            if (input.assignee !== undefined) patch.assignee = input.assignee;
            if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
            if (input.projectId !== undefined) patch.projectId = input.projectId;
            const task = db.patch('tasks', id, patch);
            if (!wasDone && task.status === 'done') {
                scope.audit(brandId, 'task.completed', 'task', id);
                emitAutomationEvent(db, brandId, 'task.completed');
            }
            return structuredClone(task);
        },

        async removeTask(brandId, id) {
            scope.require(brandId, 'write');
            scope.owned('tasks', brandId, id, 'Task');
            db.all('approvals').filter((a) => a.taskId === id).forEach((a) => db.patch('approvals', a.id, { taskId: null }));
            db.delete('tasks', (t) => t.id === id);
            scope.audit(brandId, 'task.deleted', 'task', id);
        },

        async approvals(brandId, f = {}) {
            return scope
                .rows('approvals', brandId)
                .filter((a) => !f.status || a.status === f.status)
                .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
        },

        async requestApproval(brandId, input) {
            scope.require(brandId, 'write');
            assertValid({
                kind: !APPROVAL_KINDS.includes(input.kind) && 'Unknown approval type.',
                title: !input.title?.trim() && 'Title is required.',
                summary: !input.summary?.trim() && 'Explain what will happen if this is approved.',
                taskId: input.taskId && !db.all('tasks').some((t) => t.id === input.taskId && t.brandId === brandId) && 'Choose a task from this brand.',
            });
            const req = insertApproval(brandId, {
                kind: input.kind, title: input.title.trim(), summary: input.summary.trim(), payload: input.payload ?? {}, requestedBy: { type: 'user', userId: scope.userId },
                taskId: input.taskId ?? null, executionId: null,
            });
            return structuredClone(req);
        },

        async decideApproval(brandId, id, decision, note) {
            scope.require(brandId, 'admin');
            const req = scope.owned('approvals', brandId, id, 'Approval request');
            if (req.status !== 'pending') throw new ValidationError({ status: `This request is already ${req.status}.` });
            if (req.requestedBy.type === 'user' && req.requestedBy.userId === scope.userId) throw new AccessDeniedError('You cannot decide a request you raised. Ask another admin.');
            assertValid({ note: decision === 'rejected' && !note.trim() && 'Explain why the request is rejected.' });
            const updated = db.patch('approvals', id, { status: decision, decidedBy: scope.userId, decidedAt: db.nowIso(), decisionNote: note.trim() || null });
            scope.audit(brandId, `approval.${decision}`, 'approval_request', id);
            emitAutomationEvent(db, brandId, 'approval.decided');
            return structuredClone(updated);
        },

        async cancelApproval(brandId, id) {
            const f = scope.require(brandId, 'write');
            const req = scope.owned('approvals', brandId, id, 'Approval request');
            const own = req.requestedBy.type === 'user' && req.requestedBy.userId === scope.userId;
            if (!own && !can(f, 'admin')) throw new AccessDeniedError('Only the requester or an admin can cancel this request.');
            if (req.status !== 'pending') throw new ValidationError({ status: `This request is already ${req.status}.` });
            return structuredClone(db.patch('approvals', id, { status: 'cancelled', decidedBy: scope.userId, decidedAt: db.nowIso() }));
        },

        async applyProposal(brandId, messageId, proposalId) {
            scope.require(brandId, 'write');
            const m = scope.owned('messages', brandId, messageId, 'Message');
            const p = m.proposals.find((x) => x.id === proposalId);
            if (!p) throw new NotFoundError('Proposal');
            if (p.status !== 'proposed') throw new ValidationError({ status: 'This proposal was already handled.' });
            if (m.author.type !== 'agent') throw new ValidationError({ proposal: 'Only agent proposals can be applied.' });
            const agentId = m.author.agentInstanceId;
            let result: { kind: 'task' | 'approval'; id: ID };
            if (p.action.type === 'create_task') {
                const task = insertTask(brandId, {
                    projectId: inbox(brandId).id, title: p.action.title.slice(0, 200), description: p.action.description, status: 'todo', priority: p.action.priority,
                    assignee: { type: 'agent', agentInstanceId: agentId }, createdBy: { type: 'agent', agentInstanceId: agentId }, sourceMessageId: m.id, dueDate: null,
                });
                result = { kind: 'task', id: task.id };
            } else if (p.action.type === 'request_approval') {
                const req = insertApproval(brandId, {
                    kind: p.action.kind, title: p.action.title, summary: p.action.summary, payload: { conversationId: m.conversationId, messageId: m.id },
                    requestedBy: { type: 'agent', agentInstanceId: agentId }, taskId: null, executionId: m.executionId,
                });
                result = { kind: 'approval', id: req.id };
            } else {
                throw new ValidationError({ proposal: 'Handoffs run inside team chat.' });
            }
            db.patch('messages', m.id, { proposals: m.proposals.map((x) => (x.id === proposalId ? { ...x, status: 'applied' as const, resultId: result.id } : x)) });
            return result;
        },
    };
}
