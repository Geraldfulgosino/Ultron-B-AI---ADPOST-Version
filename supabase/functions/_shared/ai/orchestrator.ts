/**
 * Team orchestration (master prompt v5.0, section 11), provider-independent.
 *
 * Flow: the lead (or @mentioned agents) answers first. Its `delegate` proposals queue
 * specialists breadth-first. When specialists ran, the lead consolidates their results in
 * a final turn. Each agent runs through executeAgentTurn with its OWN route, so specialists
 * may use different authorized providers.
 *
 * Bounds: max agent turns, max handoff depth, max total tokens, max estimated cost,
 * wall-clock timeout, cancellation, each agent at most once per round (+ the lead's
 * consolidation), and duplicate prevention through per-turn idempotency keys.
 */
import type { TurnOutcome } from './execution.ts';
import type { ChatMessage } from './types.ts';

export const TEAM_LIMITS = { maxTurns: 6, maxDepth: 3, maxTotalTokens: 24_000, maxCostUsd: 2, timeoutMs: 180_000 } as const;
export type TeamLimits = { maxTurns: number; maxDepth: number; maxTotalTokens: number; maxCostUsd: number; timeoutMs: number };

export interface TeamMember {
    agentId: string;
    handle: string;
    name: string;
    active: boolean;
}

export interface TeamTurnInput {
    agentId: string;
    depth: number;
    parentExecutionId: string | null;
    idempotencyKey: string;
    history: ChatMessage[];
}

export interface TeamStep {
    agentId: string;
    handle: string;
    depth: number;
    role: 'lead' | 'specialist' | 'consolidation';
    outcome: TurnOutcome;
}

export interface TeamResult {
    steps: TeamStep[];
    notices: string[];
    stoppedBy: 'completed' | 'turn_limit' | 'token_limit' | 'cost_limit' | 'timeout' | 'cancelled' | 'no_agents';
    totalTokens: number;
    totalCostUsd: number;
    unpricedSteps: number;
}

export interface TeamRequest {
    baseKey: string;
    members: TeamMember[];
    leadAgentId: string | null;
    mentionedAgentIds: string[];
    history: ChatMessage[];
    limits?: Partial<TeamLimits>;
    signal?: AbortSignal;
    now?: () => number;
    runTurn: (input: TeamTurnInput) => Promise<TurnOutcome>;
}

interface Job {
    agentId: string;
    depth: number;
    parentExecutionId: string | null;
    brief: string | null;
    from: string | null;
}

export async function orchestrateTeam(req: TeamRequest): Promise<TeamResult> {
    const limits: TeamLimits = { ...TEAM_LIMITS, ...req.limits };
    const now = req.now ?? (() => Date.now());
    const started = now();
    const result: TeamResult = { steps: [], notices: [], stoppedBy: 'completed', totalTokens: 0, totalCostUsd: 0, unpricedSteps: 0 };
    const byId = new Map(req.members.map((m) => [m.agentId, m]));
    const active = req.members.filter((m) => m.active);

    const mentioned = req.mentionedAgentIds.map((id) => byId.get(id)).filter((m): m is TeamMember => !!m);
    for (const m of mentioned.filter((x) => !x.active)) result.notices.push(`@${m.handle} is inactive and was skipped.`);
    const outsiders = req.mentionedAgentIds.filter((id) => !byId.has(id)).length;
    if (outsiders) result.notices.push(`${outsiders} mentioned agent(s) are not part of this team and were skipped.`);

    let first = mentioned.filter((m) => m.active);
    if (!first.length && !mentioned.length) {
        const lead = active.find((m) => m.agentId === req.leadAgentId) ?? active[0];
        if (lead) first = [lead];
    }
    if (!first.length) {
        result.stoppedBy = 'no_agents';
        if (!active.length) result.notices.push('No active agents in this team.');
        return result;
    }
    const leadId = first.length === 1 ? first[0]!.agentId : null;

    const queue: Job[] = first.map((m) => ({ agentId: m.agentId, depth: 0, parentExecutionId: null, brief: null, from: null }));
    const ran = new Set<string>();
    const specialistNotes: string[] = [];
    let turns = 0;
    let leadExecutionId: string | null = null;

    const stop = (): TeamResult['stoppedBy'] | null => {
        if (req.signal?.aborted) return 'cancelled';
        if (now() - started > limits.timeoutMs) return 'timeout';
        if (turns >= limits.maxTurns) return 'turn_limit';
        if (result.totalTokens >= limits.maxTotalTokens) return 'token_limit';
        if (result.totalCostUsd >= limits.maxCostUsd) return 'cost_limit';
        return null;
    };
    const account = (o: TurnOutcome) => {
        result.totalTokens += (o.usage?.inputTokens ?? 0) + (o.usage?.outputTokens ?? 0);
        if (o.estimatedCostUsd !== null) result.totalCostUsd += o.estimatedCostUsd;
        else if (o.status === 'succeeded' && o.mode === 'live') result.unpricedSteps++;
    };

    while (queue.length) {
        const reason = stop();
        if (reason) {
            result.stoppedBy = reason;
            result.notices.push(`${label(reason)} ${queue.length} pending handoff(s) were not run.`);
            return result;
        }
        const job = queue.shift()!;
        if (ran.has(job.agentId)) continue;
        ran.add(job.agentId);
        const member = byId.get(job.agentId)!;

        const history = [...req.history];
        if (job.brief) history.push({ role: 'user', content: `Handoff from ${job.from}: ${job.brief}` });
        const outcome = await req.runTurn({
            agentId: job.agentId, depth: job.depth, parentExecutionId: job.parentExecutionId,
            idempotencyKey: `${req.baseKey}:${job.agentId}:${job.depth}`, history,
        });
        turns++;
        account(outcome);
        result.steps.push({ agentId: job.agentId, handle: member.handle, depth: job.depth, role: job.depth === 0 ? 'lead' : 'specialist', outcome });
        if (job.depth === 0 && job.agentId === leadId) leadExecutionId = outcome.executionId;
        if (job.depth > 0 && outcome.status === 'succeeded') specialistNotes.push(`@${member.handle} (${member.name}):\n${outcome.text}`);
        if (outcome.status !== 'succeeded') continue;

        for (const p of outcome.proposals) {
            if (p.type !== 'delegate') continue;
            const target = active.find((m) => m.handle === p.handle);
            if (!target) { result.notices.push(`@${p.handle} is not an active member of this team; the handoff was skipped.`); continue; }
            if (ran.has(target.agentId) || queue.some((q) => q.agentId === target.agentId)) continue;
            if (job.depth + 1 > limits.maxDepth) { result.notices.push(`Handoff to @${p.handle} exceeds the depth limit (${limits.maxDepth}).`); continue; }
            queue.push({ agentId: target.agentId, depth: job.depth + 1, parentExecutionId: outcome.executionId, brief: p.brief, from: member.name });
        }
    }

    // Consolidation by the lead, only when specialists contributed and limits allow.
    if (leadId && specialistNotes.length) {
        const reason = stop();
        if (reason) {
            result.stoppedBy = reason;
            result.notices.push(`${label(reason)} The lead's consolidation was not run.`);
            return result;
        }
        const history: ChatMessage[] = [...req.history, {
            role: 'user',
            content: `Specialist results for you to consolidate into one answer with priorities and proposed tasks:\n\n${specialistNotes.join('\n\n')}`,
        }];
        const outcome = await req.runTurn({ agentId: leadId, depth: 0, parentExecutionId: leadExecutionId, idempotencyKey: `${req.baseKey}:${leadId}:consolidate`, history });
        turns++;
        account(outcome);
        result.steps.push({ agentId: leadId, handle: byId.get(leadId)!.handle, depth: 0, role: 'consolidation', outcome });
    }
    return result;
}

function label(reason: TeamResult['stoppedBy']): string {
    switch (reason) {
        case 'turn_limit': return 'Turn limit reached.';
        case 'token_limit': return 'Token budget for this request reached.';
        case 'cost_limit': return 'Cost limit for this request reached.';
        case 'timeout': return 'Time limit for this request reached.';
        case 'cancelled': return 'Stopped by the user.';
        default: return '';
    }
}
