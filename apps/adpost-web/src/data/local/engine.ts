/**
 * Agent execution engine: the local stand-in for the `agent-execute` Edge
 * Function. Every agent run, from any chat or orchestration, passes through
 * here, so limits, tool permissions and cost accounting live in one place.
 */
import type { AgentExecution, AgentInstance, ID } from '@/domain/types';
import { addDays, latestDate, totals } from '@/domain/analytics';
import { estimateCost, modelOption } from '@/domain/agents';
import { ProviderError, SimulatedProvider, type BrandContext, type ChatTurn, type CompletionResponse, type LlmProvider } from '@/ai/provider';
import { AccessDeniedError } from '../errors';
import { newId } from '@/lib/utils';
import type { LocalDatabase } from './db';
import type { Scope } from './scope';

export interface RunInput {
    agentInstanceId: ID;
    conversationId: ID | null;
    triggerMessageId: ID | null;
    messages: ChatTurn[];
    parentExecutionId?: ID | null;
    handoffDepth?: number;
}

export interface RunResult {
    execution: AgentExecution;
    response: CompletionResponse | null;
}

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
const dayStart = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00.000Z';

export function agentSpend(db: LocalDatabase, agentId: ID) {
    const now = db.now();
    const runs = db.all('executions').filter((e) => e.agentInstanceId === agentId);
    const month = runs.filter((e) => e.startedAt >= monthStart(now));
    return {
        runsToday: runs.filter((e) => e.startedAt >= dayStart(now) && e.status !== 'limited').length,
        runsMonth: month.filter((e) => e.status !== 'limited').length,
        tokensMonth: month.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0),
        costMonthUsd: Math.round(month.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6,
        unpricedRunsMonth: month.filter((e) => e.status === 'succeeded' && !modelOption({ provider: e.provider, model: e.model })?.outputPer1k).length,
    };
}

/** Brand facts the agent may ground its answer in. Read-only and brand-scoped. */
export function brandContext(scope: Scope, brandId: ID, query: string): BrandContext {
    const { db } = scope;
    const metrics = db.all('dailyMetrics').filter((m) => m.brandId === brandId);
    const end = latestDate(metrics);
    const from = end ? addDays(end, -27) : null;
    const t = totals(end ? metrics.filter((m) => m.date >= from! && m.date <= end) : []);
    const qAgg = new Map<string, { clicks: number; impressions: number }>();
    for (const q of db.all('searchQueries')) {
        if (q.brandId !== brandId || !from || q.date < addDays(from, -6)) continue;
        const a = qAgg.get(q.query) ?? { clicks: 0, impressions: 0 };
        a.clicks += q.clicks;
        a.impressions += q.impressions;
        qAgg.set(q.query, a);
    }
    const words = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const knowledge = db
        .all('knowledgeDocuments')
        .filter((d) => d.brandId === brandId)
        .map((d) => ({ d, score: [...words].filter((w) => (d.title + ' ' + d.content + ' ' + d.tags.join(' ')).toLowerCase().includes(w)).length + (d.kind === 'brand_guide' ? 0.5 : 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ d }) => ({ title: d.title, excerpt: d.content.slice(0, 280) }));
    const sev = { high: 0, medium: 1, low: 2 } as const;
    return {
        kpis: { sessions: t.sessions, clicks: t.clicks, impressions: t.impressions, conversions: t.conversions, window: end ? `the 28 days ending ${end}` : null },
        insights: db
            .all('seoInsights')
            .filter((i) => i.brandId === brandId && (i.status === 'pending' || i.status === 'reviewed'))
            .sort((a, b) => sev[a.severity] - sev[b.severity])
            .slice(0, 6)
            .map((i) => ({ title: i.title, type: i.type, severity: i.severity })),
        topQueries: [...qAgg.entries()].map(([query, a]) => ({ query, ...a })).sort((a, b) => b.clicks - a.clicks).slice(0, 8),
        knowledge,
        teammates: db.all('agentInstances').filter((a) => a.brandId === brandId).map((a) => ({ handle: a.handle, name: a.displayName, active: a.active })),
    };
}

export async function runAgent(scope: Scope, brandId: ID, input: RunInput, provider: LlmProvider = new SimulatedProvider()): Promise<RunResult> {
    const { db } = scope;
    scope.require(brandId, 'write');
    const agent = db.find('agentInstances', input.agentInstanceId) as AgentInstance | undefined;
    if (!agent || agent.brandId !== brandId) throw new AccessDeniedError('Agent not found in this brand.');
    const version = db.find('instructionVersions', agent.activeInstructionVersionId);
    const brand = db.find('brands', brandId)!;

    const base: AgentExecution = {
        id: newId('exe'), brandId, agentInstanceId: agent.id, conversationId: input.conversationId, triggerMessageId: input.triggerMessageId,
        parentExecutionId: input.parentExecutionId ?? null, handoffDepth: input.handoffDepth ?? 0, status: 'running',
        mode: provider.mode, provider: agent.model.provider, model: agent.model.model, instructionVersion: version?.version ?? 0,
        inputTokens: 0, outputTokens: 0, costUsd: 0, error: null, startedAt: db.nowIso(), finishedAt: null,
    };
    const finish = (patch: Partial<AgentExecution>): RunResult => {
        const execution = { ...base, ...patch, finishedAt: db.nowIso() };
        db.insert('executions', execution);
        return { execution: structuredClone(execution), response: null };
    };

    if (!agent.active) return finish({ status: 'limited', error: `${agent.displayName} is inactive.` });
    const spend = agentSpend(db, agent.id);
    if (spend.runsToday >= agent.limits.maxRunsPerDay) return finish({ status: 'limited', error: `Daily run limit reached (${agent.limits.maxRunsPerDay}).` });
    if (spend.costMonthUsd >= agent.limits.monthlyBudgetUsd) return finish({ status: 'limited', error: `Monthly budget reached ($${agent.limits.monthlyBudgetUsd}).` });
    if (agent.model.provider !== 'simulated' && provider.mode === 'simulated') {
        return finish({ status: 'failed', error: `${modelOption(agent.model)?.label ?? agent.model.model} needs the server-side agent-execute function (Phase 17). Switch the agent to the simulated model for local use.` });
    }

    const last = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    try {
        const response = await provider.complete({
            agent: { templateKey: agent.templateKey, displayName: agent.displayName, handle: agent.handle },
            brandName: brand.name,
            instructions: version?.instructions ?? '',
            context: brandContext(scope, brandId, last),
            messages: input.messages,
            maxOutputTokens: agent.limits.maxOutputTokens,
            allowedTools: agent.tools,
        });
        const cost = estimateCost(agent.model, response.inputTokens, response.outputTokens) ?? 0;
        const execution: AgentExecution = {
            ...base, status: 'succeeded', mode: response.mode, model: response.model, inputTokens: response.inputTokens,
            outputTokens: response.outputTokens, costUsd: cost, finishedAt: db.nowIso(),
        };
        db.insert('executions', execution);
        return { execution: structuredClone(execution), response };
    } catch (e) {
        return finish({ status: 'failed', error: e instanceof ProviderError ? e.message : 'Unexpected provider error.' });
    }
}
