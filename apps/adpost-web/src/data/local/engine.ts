/**
 * Agent execution engine: the local stand-in for the `agent-execute` Edge
 * Function. Every agent run, from any chat or orchestration, passes through
 * here, so limits, tool permissions and cost accounting live in one place.
 */
import type { AgentExecution, AgentInstance, ID, ToolKey } from '@/domain/types';
import { addDays, latestDate, totals } from '@/domain/analytics';
import { ALL_TOOLS, estimateCost, modelOption } from '@/domain/agents';
import { retrieve } from '@/domain/knowledge';
import { ProviderError, SimulatedProvider, type BrandContext, type ChatTurn, type CompletionResponse, type LlmProvider } from '@/ai/provider';
import { AccessDeniedError } from '../errors';
import { newId } from '@/lib/utils';
import type { LocalDatabase } from './db';
import type { Scope } from './scope';
import { planForBrand, runQuotaExceeded } from './entitlements';

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
export function brandContext(scope: Scope, brandId: ID, query: string, tools: readonly ToolKey[] = ALL_TOOLS): BrandContext {
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
    const docs = db.all('knowledgeDocuments').filter((d) => d.brandId === brandId);
    // Retrieval, with the brand voice guide as standing memory when nothing matches.
    const hits = retrieve(docs, db.all('knowledgeChunks').filter((c) => c.brandId === brandId), query, 3);
    const guide = docs.find((d) => d.kind === 'brand_guide');
    const knowledge = (hits.length ? hits.map((h) => ({ title: h.title, excerpt: h.text.slice(0, 400) })) : guide ? [{ title: guide.title, excerpt: guide.content.slice(0, 400) }] : []);
    const canAnalytics = tools.includes('read_analytics');
    const canGsc = tools.includes('read_search_console');
    const sev = { high: 0, medium: 1, low: 2 } as const;
    return {
        // Context is limited to what the agent's tools allow it to read.
        kpis: canAnalytics || canGsc
            ? { sessions: canAnalytics ? t.sessions : 0, clicks: canGsc ? t.clicks : 0, impressions: canGsc ? t.impressions : 0, conversions: canAnalytics ? t.conversions : 0, window: end ? `the 28 days ending ${end}` : null }
            : { sessions: 0, clicks: 0, impressions: 0, conversions: 0, window: null },
        insights: !(canAnalytics || canGsc) ? [] : db
            .all('seoInsights')
            .filter((i) => i.brandId === brandId && (i.status === 'pending' || i.status === 'reviewed'))
            .sort((a, b) => sev[a.severity] - sev[b.severity])
            .slice(0, 6)
            .map((i) => ({ title: i.title, type: i.type, severity: i.severity })),
        topQueries: !canGsc ? [] : [...qAgg.entries()].map(([query, a]) => ({ query, ...a })).sort((a, b) => b.clicks - a.clicks).slice(0, 8),
        knowledge: tools.includes('read_knowledge') ? knowledge : [],
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
    const quota = runQuotaExceeded(db, brandId);
    if (quota) return finish({ status: 'limited', error: quota });
    if (agent.model.provider !== 'simulated' && !planForBrand(db, brandId).features.includes('live_models')) return finish({ status: 'limited', error: 'Live AI models are not included in this plan.' });
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
            context: brandContext(scope, brandId, last, agent.tools),
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
