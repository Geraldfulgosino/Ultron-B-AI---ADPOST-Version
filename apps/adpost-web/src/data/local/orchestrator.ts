/**
 * Group-chat orchestration (ADR-008): the local stand-in for the
 * `orchestrate-group` Edge Function. A bounded loop with:
 *  - at most MAX_TURNS agent runs per human message,
 *  - handoff depth at most MAX_DEPTH,
 *  - a token budget per orchestration round,
 *  - each agent at most once per round (no ping-pong loops).
 * Delegation between agents is internal and runs automatically; anything with
 * an external effect stays a proposal for a human to apply.
 */
import type { AgentInstance, Conversation, ID, Message, TeamKey } from '@/domain/types';
import { templateByKey } from '@/domain/agents';
import { newId } from '@/lib/utils';
import type { LocalDatabase } from './db';
import type { Scope } from './scope';
import { runAgent } from './engine';
import { historyTurns, recordRun } from './chat';

export const ORCHESTRATION_LIMITS = { maxTurns: 6, maxDepth: 3, maxRoundTokens: 12_000 } as const;

const LEADS: Record<TeamKey, Array<AgentInstance['templateKey']>> = {
    seo: ['seo_manager'],
    web: ['web_design'],
    all: ['seo_manager'],
};

export function teamAgents(db: LocalDatabase, brandId: ID, team: TeamKey): AgentInstance[] {
    return db.all('agentInstances').filter((a) => a.brandId === brandId && (team === 'all' || templateByKey(a.templateKey).team === team));
}

interface Job {
    agentId: ID;
    depth: number;
    parentExecutionId: ID | null;
    brief: string | null;
    from: string | null;
}

export async function orchestrateGroup(scope: Scope, brandId: ID, c: Conversation, userMessage: Message): Promise<Message[]> {
    const { db } = scope;
    const out: Message[] = [];
    const members = c.agentInstanceIds.map((id) => db.find('agentInstances', id)).filter((a): a is AgentInstance => !!a);
    const active = members.filter((a) => a.active);
    const note = (body: string) => {
        const m: Message = {
            id: newId('msg'), brandId, conversationId: c.id, author: { type: 'system' }, body, mentions: [], attachments: [], status: 'sent',
            executionId: null, mode: null, proposals: [], replyToId: userMessage.id, createdAt: db.nowIso(),
        };
        db.insert('messages', m);
        out.push(structuredClone(m));
    };

    // Who answers first: @mentioned members, else the team lead.
    const mentioned = userMessage.mentions.map((id) => members.find((a) => a.id === id)).filter((a): a is AgentInstance => !!a);
    for (const a of mentioned.filter((x) => !x.active)) note(`@${a.handle} is inactive and was skipped.`);
    const outsiders = userMessage.mentions.filter((id) => !members.some((a) => a.id === id));
    if (outsiders.length) note(`${outsiders.length} mentioned agent(s) are not part of this team and were skipped.`);

    let first = mentioned.filter((a) => a.active);
    if (!first.length && !mentioned.length) {
        const lead = active.find((a) => LEADS[c.teamKey ?? 'all'].includes(a.templateKey)) ?? active[0];
        if (lead) first = [lead];
    }
    if (!first.length) {
        if (!active.length) note('No active agents in this team. Activate agents on the Agents page.');
        return out;
    }

    const queue: Job[] = first.map((a) => ({ agentId: a.id, depth: 0, parentExecutionId: null, brief: null, from: null }));
    const ran = new Set<ID>();
    let turns = 0;
    let tokens = 0;

    while (queue.length) {
        if (turns >= ORCHESTRATION_LIMITS.maxTurns) {
            note(`Turn limit reached (${ORCHESTRATION_LIMITS.maxTurns} agent replies). ${queue.length} pending handoff(s) were not run.`);
            break;
        }
        if (tokens >= ORCHESTRATION_LIMITS.maxRoundTokens) {
            note(`Token budget for this round reached (${ORCHESTRATION_LIMITS.maxRoundTokens.toLocaleString('en-US')} tokens). ${queue.length} pending handoff(s) were not run.`);
            break;
        }
        const job = queue.shift()!;
        if (ran.has(job.agentId)) continue;
        ran.add(job.agentId);

        const messages = historyTurns(scope, c.id);
        if (job.brief) messages.push({ role: 'user', name: job.from ?? 'Team', content: `Handoff from ${job.from}: ${job.brief}` });
        const run = await runAgent(scope, brandId, {
            agentInstanceId: job.agentId, conversationId: c.id, triggerMessageId: userMessage.id, messages,
            parentExecutionId: job.parentExecutionId, handoffDepth: job.depth,
        });
        turns++;
        tokens += run.execution.inputTokens + run.execution.outputTokens;
        const reply = recordRun(scope, brandId, c.id, userMessage.id, run);
        out.push(reply);
        if (!run.response) continue;

        // Auto-run internal handoffs within limits; mark the delegate proposals accordingly.
        const fromName = db.find('agentInstances', job.agentId)?.displayName ?? 'Agent';
        let changed = false;
        const proposals = reply.proposals.map((p) => {
            if (p.action.type !== 'delegate') return p;
            const handle = p.action.handle;
            const target = active.find((a) => a.handle === handle);
            if (!target || ran.has(target.id) || queue.some((q) => q.agentId === target.id)) return p;
            if (job.depth + 1 > ORCHESTRATION_LIMITS.maxDepth) return p;
            queue.push({ agentId: target.id, depth: job.depth + 1, parentExecutionId: run.execution.id, brief: p.action.brief, from: fromName });
            changed = true;
            return { ...p, status: 'applied' as const, resultId: target.id };
        });
        if (changed) {
            db.patch('messages', reply.id, { proposals });
            reply.proposals = proposals;
        }
    }
    return out;
}

/**
 * Deterministic thread summary (no model call): participants, activity and
 * open proposals. Stored on the conversation.
 */
export function summarizeConversation(db: LocalDatabase, c: Conversation): string {
    const msgs = db.all('messages').filter((m) => m.conversationId === c.id);
    const humans = new Set(msgs.filter((m) => m.author.type === 'user').map((m) => (m.author.type === 'user' ? m.author.userId : '')));
    const agents = new Map<string, number>();
    for (const m of msgs) if (m.author.type === 'agent') agents.set(m.author.agentInstanceId, (agents.get(m.author.agentInstanceId) ?? 0) + 1);
    const open = msgs.flatMap((m) => m.proposals.filter((p) => p.status === 'proposed').map((p) => p.action));
    const failed = msgs.filter((m) => m.status === 'failed').length;
    const lastAsk = [...msgs].reverse().find((m) => m.author.type === 'user')?.body;

    const lines = [
        `${msgs.length} messages from ${humans.size} ${humans.size === 1 ? 'person' : 'people'} and ${agents.size} agent${agents.size === 1 ? '' : 's'}.`,
        ...[...agents.entries()].map(([id, n]) => `- ${db.find('agentInstances', id)?.displayName ?? 'Agent'}: ${n} repl${n === 1 ? 'y' : 'ies'}`),
    ];
    if (lastAsk) lines.push(`Latest request: "${lastAsk.slice(0, 160)}${lastAsk.length > 160 ? '…' : ''}"`);
    if (open.length) {
        lines.push(`${open.length} open proposal${open.length === 1 ? '' : 's'}:`);
        for (const a of open.slice(0, 8)) lines.push(`- ${a.type === 'create_task' ? `Task: ${a.title}` : a.type === 'request_approval' ? `Approval: ${a.title}` : `Handoff to @${a.handle}`}`);
    } else lines.push('No open proposals.');
    if (failed) lines.push(`${failed} failed repl${failed === 1 ? 'y needs' : 'ies need'} a retry.`);
    return lines.join('\n');
}
