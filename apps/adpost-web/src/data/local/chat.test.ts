import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { SIMULATE_FAILURE_TOKEN } from '@/ai/provider';
import { ORCHESTRATION_LIMITS } from './orchestrator';

const { pod, dmd } = IDS.brands;

describe('direct chat', () => {
    it('creates a conversation, replies with a simulated, brand-grounded answer, and logs the execution', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_statistics_seo');
        const { message, replies } = await api.chat.send(pod, c.id, { body: 'How did we do last month?' });
        expect(message.author).toEqual({ type: 'user', userId: IDS.users.priya });
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ mode: 'simulated', status: 'sent', replyToId: message.id, author: { type: 'agent', agentInstanceId: 'agt_pod_statistics_seo' } });
        expect(replies[0]!.body).toMatch(/sessions/);
        expect(await api.agents.executions(pod, { conversationId: c.id })).toHaveLength(1);
        const [summary] = await api.chat.list(pod);
        expect(summary).toMatchObject({ id: c.id, messageCount: 2 });
    });

    it('passes text attachments to the agent and validates limits', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_content_seo');
        const { message } = await api.chat.send(pod, c.id, { body: 'Use this brief', attachments: [{ name: 'brief.md', sizeBytes: 20, mimeType: 'text/markdown', text: '# Brief\nTone: playful' }] });
        expect(message.attachments[0]).toMatchObject({ name: 'brief.md', textExcerpt: '# Brief\nTone: playful' });
        await expect(api.chat.send(pod, c.id, { body: 'x', attachments: [{ name: 'big.bin', sizeBytes: 2_000_000, mimeType: 'application/zip', text: null }] })).rejects.toBeInstanceOf(ValidationError);
        await expect(api.chat.send(pod, c.id, { body: '   ' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('records a failure and retries it cleanly', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_seo_manager');
        const { replies } = await api.chat.send(pod, c.id, { body: `plan ${SIMULATE_FAILURE_TOKEN}` });
        expect(replies[0]).toMatchObject({ status: 'failed', author: { type: 'system' } });
        // The retried prompt still contains the failure token, so it fails again; the old failure is replaced, not duplicated.
        const again = await api.chat.retry(pod, c.id, replies[0]!.id);
        expect(again.replies[0]!.status).toBe('failed');
        expect((await api.chat.messages(pod, c.id)).filter((m) => m.status === 'failed')).toHaveLength(1);
        await expect(api.chat.retry(pod, c.id, 'msg_nope')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('inactive agents answer with a limit notice instead of a reply', async () => {
        const db = testDb();
        await as('priya', db).api.agents.update(pod, 'agt_pod_web_design', { active: false });
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_web_design');
        const { replies } = await api.chat.send(pod, c.id, { body: 'hello' });
        expect(replies[0]).toMatchObject({ author: { type: 'system' }, status: 'sent' });
        expect(replies[0]!.body).toContain('inactive');
    });

    it('is isolated per brand; viewers read only; clients have no access', async () => {
        const db = testDb();
        const c = await as('priya', db).api.chat.createDirect(pod, 'agt_pod_seo_manager');
        await expect(as('dana', db).api.chat.messages(pod, c.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('dana', db).api.chat.messages(dmd, c.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(as('priya', db).api.chat.createDirect(pod, 'agt_dmd_seo_manager')).rejects.toBeInstanceOf(ValidationError);
        expect(await as('vic', db).api.chat.messages(pod, c.id)).toEqual([]);
        await expect(as('vic', db).api.chat.send(pod, c.id, { body: 'hi' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('casey', db).api.chat.list(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('searches message bodies within the brand only', async () => {
        const db = testDb();
        const c = await as('priya', db).api.chat.createDirect(pod, 'agt_pod_seo_manager');
        await as('priya', db).api.chat.send(pod, c.id, { body: 'zebra campaign ideas' });
        expect((await as('priya', db).api.chat.search(pod, 'zebra')).map((h) => h.conversationId)).toEqual([c.id]);
        const other = await as('dana', db).api.chat.createDirect(dmd, 'agt_dmd_seo_manager');
        await as('dana', db).api.chat.send(dmd, other.id, { body: 'zebra too' });
        expect(await as('priya', db).api.chat.search(pod, 'zebra')).toHaveLength(1);
    });

    it('archives block sending; rename validates', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_seo_manager');
        await api.chat.archive(pod, c.id, true);
        await expect(api.chat.send(pod, c.id, { body: 'hi' })).rejects.toBeInstanceOf(ValidationError);
        expect(await api.chat.list(pod)).toHaveLength(0);
        expect(await api.chat.list(pod, { includeArchived: true })).toHaveLength(1);
        await expect(api.chat.rename(pod, c.id, ' ')).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('team chat orchestration', () => {
    it('SEO team: manager answers, then delegates to specialists automatically', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createGroup(pod, { team: 'seo' });
        expect(c.agentInstanceIds).toHaveLength(4);
        const { replies } = await api.chat.send(pod, c.id, { body: 'Plan the technical and content work for this month' });
        const authors = replies.filter((r) => r.author.type === 'agent').map((r) => (r.author.type === 'agent' ? r.author.agentInstanceId : ''));
        expect(authors[0]).toBe('agt_pod_seo_manager');
        expect(authors).toEqual(expect.arrayContaining(['agt_pod_technical_seo', 'agt_pod_content_seo']));
        const handoffs = replies[0]!.proposals.filter((p) => p.action.type === 'delegate');
        expect(handoffs.every((p) => p.status === 'applied')).toBe(true);
        const execs = await api.agents.executions(pod, { conversationId: c.id });
        expect(execs.filter((e) => e.handoffDepth === 1).every((e) => e.parentExecutionId === execs.find((x) => x.handoffDepth === 0)!.id)).toBe(true);
    });

    it('@mentions address specific agents; inactive or outside mentions are skipped with a note', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        await api.agents.update(pod, 'agt_pod_web_development', { active: false });
        const c = await api.chat.createGroup(pod, { team: 'web' });
        const { replies } = await api.chat.send(pod, c.id, { body: '@web-development @technical-seo please review' });
        expect(replies.map((r) => r.body).join('\n')).toMatch(/@web-development is inactive/);
        expect(replies.map((r) => r.body).join('\n')).toMatch(/not part of this team/);
        expect(replies.some((r) => r.author.type === 'agent')).toBe(false);
    });

    it('never exceeds the turn limit and runs each agent at most once per message', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createGroup(pod, { team: 'all' });
        const { replies } = await api.chat.send(pod, c.id, { body: 'Everyone: technical, content, report and build the new page' });
        const agentReplies = replies.filter((r) => r.author.type === 'agent');
        expect(agentReplies.length).toBeLessThanOrEqual(ORCHESTRATION_LIMITS.maxTurns);
        const ids = agentReplies.map((r) => (r.author.type === 'agent' ? r.author.agentInstanceId : ''));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('summarizes a thread deterministically', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createGroup(pod, { team: 'seo' });
        await api.chat.send(pod, c.id, { body: 'Weekly plan please' });
        const s = await api.chat.summarize(pod, c.id);
        expect(s.summary).toMatch(/^\d+ messages from 1 person and \d agents\./);
        expect(s.summary).toContain('Latest request: "Weekly plan please"');
    });
});

describe('work: projects, tasks, approvals', () => {
    it('applies a task proposal into the agent inbox, assigned to the proposing agent', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_content_seo');
        const { replies } = await api.chat.send(pod, c.id, { body: 'brief for our top query' });
        const p = replies[0]!.proposals.find((x) => x.action.type === 'create_task')!;
        const r = await api.work.applyProposal(pod, replies[0]!.id, p.id);
        expect(r.kind).toBe('task');
        const [task] = await api.work.tasks(pod);
        expect(task).toMatchObject({ id: r.id, assignee: { type: 'agent', agentInstanceId: 'agt_pod_content_seo' }, sourceMessageId: replies[0]!.id });
        expect((await api.work.projects(pod)).map((x) => x.name)).toEqual(['Agent requests']);
        await expect(api.work.applyProposal(pod, replies[0]!.id, p.id)).rejects.toBeInstanceOf(ValidationError);
    });

    it('approval proposals need a human decision; requester cannot self-approve; decisions emit automation', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        const c = await priya.chat.createDirect(pod, 'agt_pod_web_development');
        const { replies } = await priya.chat.send(pod, c.id, { body: 'deploy the changes' });
        const p = replies[0]!.proposals.find((x) => x.action.type === 'request_approval')!;
        const { id } = await priya.work.applyProposal(pod, replies[0]!.id, p.id);
        await expect(as('morgan', db).api.work.decideApproval(pod, id, 'approved', '')).rejects.toBeInstanceOf(AccessDeniedError); // manager
        await expect(priya.work.decideApproval(pod, id, 'rejected', '')).rejects.toBeInstanceOf(ValidationError); // needs reason
        const done = await priya.work.decideApproval(pod, id, 'approved', 'Go');
        expect(done).toMatchObject({ status: 'approved', decidedBy: IDS.users.priya });

        const own = await priya.work.requestApproval(pod, { kind: 'external_action', title: 'Mine', summary: 'Something' });
        await expect(priya.work.decideApproval(pod, own.id, 'approved', 'ok')).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await priya.work.cancelApproval(pod, own.id)).status).toBe('cancelled');
    });

    it('task CRUD validates assignees and projects within the brand', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const proj = await api.work.createProject(pod, { name: 'Q4 SEO' });
        await expect(api.work.createProject(pod, { name: 'q4 seo' })).rejects.toBeInstanceOf(ValidationError);
        await expect(api.work.createTask(pod, { projectId: proj.id, title: 'x', assignee: { type: 'agent', agentInstanceId: 'agt_dmd_seo_manager' } })).rejects.toBeInstanceOf(ValidationError);
        await expect(api.work.createTask(pod, { projectId: proj.id, title: 'x', assignee: { type: 'user', userId: IDS.users.vic } })).rejects.toBeInstanceOf(ValidationError);
        const t = await api.work.createTask(pod, { projectId: proj.id, title: 'Fix titles', priority: 'high', assignee: { type: 'user', userId: IDS.users.morgan } });
        const moved = await api.work.updateTask(pod, t.id, { status: 'done' });
        expect(moved.status).toBe('done');
        expect(db.all('auditLogs').some((a) => a.action === 'task.completed')).toBe(true);
        await expect(as('dana', db).api.work.tasks(pod)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('vic', db).api.work.createTask(pod, { projectId: proj.id, title: 'no' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('morgan', db).api.work.removeProject(pod, proj.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await api.work.removeProject(pod, proj.id);
        expect(await api.work.tasks(pod)).toEqual([]);
    });
});
