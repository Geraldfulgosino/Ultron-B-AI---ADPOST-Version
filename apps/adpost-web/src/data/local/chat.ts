import type { Attachment, Conversation, ID, Message, Proposal } from '@/domain/types';
import type { AttachmentInput, ChatApi, SendResult } from '../contracts';
import type { ChatTurn, ProposedAction } from '@/ai/provider';
import { assertValid, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import type { Scope } from './scope';
import { runAgent, type RunResult } from './engine';
import { orchestrateGroup, summarizeConversation, teamAgents } from './orchestrator';

export const MAX_BODY = 8000;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 1_000_000;
export const MAX_EXCERPT = 20_000;
const HISTORY_TURNS = 20;

export const TEAM_TITLES = { seo: 'SEO Team', web: 'Web Team', all: 'All Agents' } as const;

export function toAttachments(inputs: AttachmentInput[] = []): Attachment[] {
    assertValid({
        attachments:
            (inputs.length > MAX_ATTACHMENTS && `Attach at most ${MAX_ATTACHMENTS} files.`) ||
            (inputs.some((a) => a.sizeBytes > MAX_ATTACHMENT_BYTES) && 'Each attachment must be 1 MB or smaller.') ||
            (inputs.some((a) => !a.name.trim()) && 'Attachments need a file name.'),
    });
    return inputs.map((a) => ({
        id: newId('att'),
        name: a.name.trim().slice(0, 200),
        sizeBytes: a.sizeBytes,
        mimeType: a.mimeType || 'application/octet-stream',
        textExcerpt: a.text ? a.text.slice(0, MAX_EXCERPT) : null,
        knowledgeDocumentId: null,
    }));
}

/** Conversation history (oldest first, up to and including `upToId`) as provider turns, attachments inlined. */
export function historyTurns(scope: Scope, conversationId: ID, upToId?: ID): ChatTurn[] {
    const { db } = scope;
    const all = db.all('messages').filter((m) => m.conversationId === conversationId);
    const end = upToId ? all.findIndex((m) => m.id === upToId) + 1 || all.length : all.length;
    return all
        .slice(0, end)
        .filter((m) => m.status === 'sent' && m.author.type !== 'system')
        .slice(-HISTORY_TURNS)
        .map((m) => {
            const files = m.attachments.map((a) => `\n[Attachment: ${a.name}]${a.textExcerpt ? `\n${a.textExcerpt}` : ' (binary, not read)'}`).join('');
            if (m.author.type === 'user') {
                const uid = m.author.userId;
                return { role: 'user' as const, name: db.find('users', uid)?.name ?? 'User', content: m.body + files };
            }
            const aid = m.author.type === 'agent' ? m.author.agentInstanceId : '';
            return { role: 'assistant' as const, name: db.find('agentInstances', aid)?.displayName ?? 'Agent', content: m.body };
        });
}

export function toProposals(actions: ProposedAction[]): Proposal[] {
    return actions.map((action) => ({ id: newId('prp'), action, status: 'proposed', resultId: null }));
}

/** Persist an agent run's outcome as a message: reply, limit notice, or failure. */
export function recordRun(scope: Scope, brandId: ID, conversationId: ID, replyToId: ID, run: RunResult): Message {
    const { db } = scope;
    const { execution, response } = run;
    const message: Message = response
        ? {
              id: newId('msg'), brandId, conversationId, author: { type: 'agent', agentInstanceId: execution.agentInstanceId }, body: response.text,
              mentions: [], attachments: [], status: 'sent', executionId: execution.id, mode: response.mode, proposals: toProposals(response.actions),
              replyToId, createdAt: db.nowIso(),
          }
        : {
              id: newId('msg'), brandId, conversationId, author: { type: 'system' },
              body: `${db.find('agentInstances', execution.agentInstanceId)?.displayName ?? 'Agent'}: ${execution.error ?? 'No response.'}`,
              mentions: [], attachments: [], status: execution.status === 'failed' ? 'failed' : 'sent', executionId: execution.id, mode: execution.mode,
              proposals: [], replyToId, createdAt: db.nowIso(),
          };
    db.insert('messages', message);
    return structuredClone(message);
}

export function localChat(scope: Scope): ChatApi {
    const { db } = scope;
    const conv = (brandId: ID, id: ID) => scope.row('conversations', brandId, id, { label: 'Conversation' });
    const touch = (id: ID) => db.patch('conversations', id, { updatedAt: db.nowIso() });

    async function respond(brandId: ID, c: Conversation, userMessage: Message): Promise<Message[]> {
        if (c.kind === 'group') return orchestrateGroup(scope, brandId, c, userMessage);
        const run = await runAgent(scope, brandId, {
            agentInstanceId: c.agentInstanceIds[0]!, conversationId: c.id, triggerMessageId: userMessage.id,
            messages: historyTurns(scope, c.id, userMessage.id),
        });
        return [recordRun(scope, brandId, c.id, userMessage.id, run)];
    }

    return {
        async list(brandId, filter = {}) {
            const msgs = db.all('messages').filter((m) => m.brandId === brandId);
            return scope
                .rows('conversations', brandId)
                .filter((c) => (!filter.kind || c.kind === filter.kind) && (filter.includeArchived || !c.archived))
                .map((c) => {
                    const own = msgs.filter((m) => m.conversationId === c.id);
                    return { ...c, lastMessage: own.length ? structuredClone(own[own.length - 1]!) : null, messageCount: own.length };
                })
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },

        async get(brandId, id) {
            return conv(brandId, id);
        },

        async createDirect(brandId, agentInstanceId, title) {
            scope.require(brandId, 'write');
            const agent = db.find('agentInstances', agentInstanceId);
            if (!agent || agent.brandId !== brandId) throw new ValidationError({ agentInstanceId: 'Choose an agent from this brand.' });
            const c: Conversation = {
                id: newId('cnv'), brandId, kind: 'direct', title: title?.trim() || `Chat with ${agent.displayName}`, agentInstanceIds: [agent.id], teamKey: null,
                createdBy: scope.userId, archived: false, summary: null, createdAt: db.nowIso(), updatedAt: db.nowIso(),
            };
            db.insert('conversations', c);
            return structuredClone(c);
        },

        async createGroup(brandId, { team, title }) {
            scope.require(brandId, 'write');
            if (!(team in TEAM_TITLES)) throw new ValidationError({ team: 'Unknown team.' });
            const members = teamAgents(db, brandId, team);
            if (!members.length) throw new ValidationError({ team: 'This team has no agents in this brand.' });
            const c: Conversation = {
                id: newId('cnv'), brandId, kind: 'group', title: title?.trim() || TEAM_TITLES[team], agentInstanceIds: members.map((a) => a.id), teamKey: team,
                createdBy: scope.userId, archived: false, summary: null, createdAt: db.nowIso(), updatedAt: db.nowIso(),
            };
            db.insert('conversations', c);
            return structuredClone(c);
        },

        async messages(brandId, conversationId) {
            conv(brandId, conversationId);
            return structuredClone(db.all('messages').filter((m) => m.conversationId === conversationId));
        },

        async send(brandId, conversationId, input): Promise<SendResult> {
            scope.require(brandId, 'write');
            const c = conv(brandId, conversationId);
            if (c.archived) throw new ValidationError({ body: 'This conversation is archived. Unarchive it to continue.' });
            const body = input.body.trim();
            assertValid({ body: (!body && !input.attachments?.length && 'Write a message.') || (body.length > MAX_BODY && `Messages are limited to ${MAX_BODY} characters.`) });
            const handles = new Map(db.all('agentInstances').filter((a) => a.brandId === brandId).map((a) => [a.handle, a.id]));
            const mentions = [...new Set([...body.matchAll(/@([a-z0-9-]+)/g)].map((m) => handles.get(m[1]!)).filter((x): x is string => !!x))];
            const message: Message = {
                id: newId('msg'), brandId, conversationId, author: { type: 'user', userId: scope.userId }, body, mentions, attachments: toAttachments(input.attachments),
                status: 'sent', executionId: null, mode: null, proposals: [], replyToId: null, createdAt: db.nowIso(),
            };
            db.insert('messages', message);
            const replies = await respond(brandId, c, message);
            touch(c.id);
            return { message: structuredClone(message), replies };
        },

        async retry(brandId, conversationId, failedMessageId) {
            scope.require(brandId, 'write');
            const c = conv(brandId, conversationId);
            const failed = db.find('messages', failedMessageId);
            if (!failed || failed.conversationId !== c.id || failed.status !== 'failed' || !failed.replyToId) throw new NotFoundError('Failed message');
            const original = db.find('messages', failed.replyToId)!;
            const exec = failed.executionId ? db.find('executions', failed.executionId) : undefined;
            // Retry only the agent that failed; remove the failure notice so the thread stays clean.
            db.delete('messages', (m) => m.id === failed.id);
            const run = await runAgent(scope, brandId, {
                agentInstanceId: exec?.agentInstanceId ?? c.agentInstanceIds[0]!, conversationId: c.id, triggerMessageId: original.id,
                messages: historyTurns(scope, c.id, original.id), parentExecutionId: exec?.parentExecutionId ?? null, handoffDepth: exec?.handoffDepth ?? 0,
            });
            const reply = recordRun(scope, brandId, c.id, original.id, run);
            touch(c.id);
            return { message: structuredClone(original), replies: [reply] };
        },

        async rename(brandId, id, title) {
            scope.require(brandId, 'write');
            conv(brandId, id);
            assertValid({ title: !title.trim() && 'Title is required.' });
            return structuredClone(db.patch('conversations', id, { title: title.trim().slice(0, 120) }));
        },

        async archive(brandId, id, archived) {
            scope.require(brandId, 'write');
            conv(brandId, id);
            return structuredClone(db.patch('conversations', id, { archived }));
        },

        async search(brandId, query) {
            const q = query.trim().toLowerCase();
            if (q.length < 2) return [];
            const convs = new Map(scope.rows('conversations', brandId).map((c) => [c.id, c]));
            return structuredClone(
                db.all('messages').filter((m) => m.brandId === brandId && convs.has(m.conversationId) && (m.body.toLowerCase().includes(q) || m.attachments.some((a) => a.name.toLowerCase().includes(q)))),
            )
                .reverse()
                .slice(0, 50)
                .map((message) => ({ conversationId: message.conversationId, conversationTitle: convs.get(message.conversationId)!.title, message }));
        },

        async summarize(brandId, id) {
            scope.require(brandId, 'write');
            const c = conv(brandId, id);
            return structuredClone(db.patch('conversations', id, { summary: summarizeConversation(db, c) }));
        },

        async dismissProposal(brandId, messageId, proposalId) {
            scope.require(brandId, 'write');
            const m = scope.owned('messages', brandId, messageId, 'Message');
            const p = m.proposals.find((x) => x.id === proposalId);
            if (!p) throw new NotFoundError('Proposal');
            if (p.status !== 'proposed') throw new ValidationError({ status: 'This proposal was already handled.' });
            const proposals = m.proposals.map((x) => (x.id === proposalId ? { ...x, status: 'dismissed' as const } : x));
            return structuredClone(db.patch('messages', messageId, { proposals }));
        },
    };
}
