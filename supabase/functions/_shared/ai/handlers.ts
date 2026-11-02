/**
 * Edge Function request handlers (pure; the Deno entry files only wire clients and env).
 *
 * agent-execute: pipeline steps 1–4 happen here with the CALLER's JWT (RLS-filtered reads):
 * authenticated user → message authored by the caller → conversation in a brand the caller
 * can write → agents of that conversation. Steps 5–16 run in executeAgentTurn /
 * orchestrateTeam. Connection metadata and usage totals are read with the service role only
 * after those checks, and only for the verified brand and agency.
 *
 * ai-connection-test: the connection must be visible to the caller under RLS (agency staff
 * or brand admin). The result and health check are written with the service role.
 */
import type { UsageSnapshot } from './budget.ts';
import { testConnection, type ConnectionTestResult } from './connectionTest.ts';
import { executeAgentTurn, type AgentProfile, type ExecutionStore, type TurnEvent, type TurnOutcome } from './execution.ts';
import { orchestrateTeam, type TeamMember } from './orchestrator.ts';
import type { AIProviderRegistry, EnvReader } from './registry.ts';
import type { AssignmentConfig, ConnectionConfig, ModelCatalogEntry, RoutingPolicy } from './routing.ts';
import type { FetchDeps } from './seoTools.ts';
import type { AIToolGateway } from './tools.ts';
import type { ChatMessage } from './types.ts';

export interface CallerMessage { id: string; conversationId: string; brandId: string; authorUserId: string | null; body: string; mentions: string[] }
export interface CallerConversation { id: string; brandId: string; kind: 'direct' | 'group'; teamKey: 'seo' | 'web' | 'all' | null; agentInstanceIds: string[]; archived: boolean }
export interface CallerBrand { brandId: string; agencyId: string; brandName: string; canWrite: boolean; websiteHosts: string[] }
export interface AgentRow extends AgentProfile { templateKey: string; team: 'seo' | 'web' }
export interface RoutingData { assignments: AssignmentConfig[]; connections: ConnectionConfig[]; models: ModelCatalogEntry[]; brandPolicy: RoutingPolicy | null; orgPolicy: RoutingPolicy | null }
export interface HistoryRow { authorType: 'user' | 'agent' | 'system'; authorName: string; body: string; agentInstanceId: string | null }

export interface ServerData {
    /** From the verified JWT; null when unauthenticated. */
    userId: string | null;
    // Caller-scoped (RLS) reads
    message(id: string): Promise<CallerMessage | null>;
    conversation(id: string): Promise<CallerConversation | null>;
    brand(brandId: string): Promise<CallerBrand | null>;
    agents(brandId: string, ids: string[]): Promise<AgentRow[]>;
    history(conversationId: string, beforeMessageId: string, limit: number): Promise<HistoryRow[]>;
    searchKnowledge(brandId: string, query: string): Promise<Array<{ title: string; excerpt: string }>>;
    visibleConnection(connectionId: string): Promise<ConnectionConfig | null>;
    // Service reads/writes, only after the checks above
    routing(brandId: string, agencyId: string): Promise<RoutingData>;
    usage(brandId: string, agencyId: string, userId: string, agentId: string, connectionId: string | null): Promise<UsageSnapshot>;
    requestsInLastMinute(userId: string): Promise<number>;
    store: ExecutionStore;
    recordConnectionTest(result: ConnectionTestResult, conn: ConnectionConfig, testedBy: string): Promise<void>;
}

export interface HandlerDeps {
    data: ServerData;
    registry: AIProviderRegistry;
    gateway: AIToolGateway;
    env: EnvReader;
    fetch: typeof fetch;
    resolveDns: FetchDeps['resolve'] | null;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

export const USER_REQUESTS_PER_MINUTE = 20;
const HISTORY_LIMIT = 30;
const LEADS: Record<'seo' | 'web' | 'all', string[]> = { seo: ['seo_manager'], web: ['web_design'], all: ['seo_manager'] };

export interface ExecuteInput {
    messageId: string;
    idempotencyKey: string;
}

export interface ExecuteResult {
    conversationId: string;
    steps: Array<{ agentInstanceId: string; role: 'direct' | 'lead' | 'specialist' | 'consolidation'; outcome: TurnOutcome }>;
    notices: string[];
    stoppedBy: string;
}

function toHistory(rows: HistoryRow[], selfAgentId: string): ChatMessage[] {
    return rows.filter((r) => r.authorType !== 'system' && r.body.trim()).map((r): ChatMessage =>
        r.authorType === 'agent' && r.agentInstanceId === selfAgentId
            ? { role: 'assistant', content: r.body }
            : { role: 'user', content: r.authorType === 'agent' ? `[${r.authorName}]: ${r.body}` : `${r.authorName}: ${r.body}` });
}

export async function handleAgentExecute(input: ExecuteInput, deps: HandlerDeps, signal?: AbortSignal, emit?: (agentId: string, e: TurnEvent) => void): Promise<ExecuteResult> {
    const d = deps.data;
    if (!d.userId) throw new HttpError(401, 'Sign in required.');
    if (!/^[A-Za-z0-9:._-]{8,200}$/.test(input.idempotencyKey ?? '')) throw new HttpError(400, 'A valid idempotencyKey is required.');
    const msg = await d.message(input.messageId);
    if (!msg) throw new HttpError(404, 'Message not found.');
    if (msg.authorUserId !== d.userId) throw new HttpError(403, 'Only the author of a message can run agents on it.');
    const conv = await d.conversation(msg.conversationId);
    if (!conv || conv.brandId !== msg.brandId) throw new HttpError(404, 'Conversation not found.');
    if (conv.archived) throw new HttpError(409, 'This conversation is archived.');
    const brand = await d.brand(conv.brandId);
    if (!brand?.canWrite) throw new HttpError(403, 'You cannot run agents in this brand.');
    if ((await d.requestsInLastMinute(d.userId)) >= USER_REQUESTS_PER_MINUTE) throw new HttpError(429, 'Too many AI requests. Wait a minute and try again.');

    const agents = await d.agents(brand.brandId, conv.agentInstanceIds);
    const routing = await d.routing(brand.brandId, brand.agencyId);
    const rows = await d.history(conv.id, msg.id, HISTORY_LIMIT);
    const teammates = agents.filter((a) => a.active).map((a) => ({ handle: a.handle, name: a.name }));
    const fetchDeps = deps.resolveDns ? { resolve: deps.resolveDns, fetch: deps.fetch } : null;

    const runTurn = async (agentId: string, depth: number, parentExecutionId: string | null, key: string, extra: ChatMessage[]): Promise<TurnOutcome> => {
        const agent = agents.find((a) => a.id === agentId)!;
        const assignment = routing.assignments.find((x) => x.agentInstanceId === agentId) ?? null;
        const conn = assignment ? routing.connections.find((c) => c.id === assignment.connectionId) ?? null : null;
        const history = [...toHistory(rows, agentId), { role: 'user' as const, content: msg.body }, ...extra];
        return executeAgentTurn({ registry: deps.registry, gateway: deps.gateway, env: deps.env, fetch: deps.fetch, store: d.store, now: deps.now, sleep: deps.sleep }, {
            idempotencyKey: key, agencyId: brand.agencyId, brandId: brand.brandId, brandName: brand.brandName, userId: d.userId!, conversationId: conv.id,
            triggerMessageId: msg.id, parentExecutionId, handoffDepth: depth, agent, history,
            routing: { assignment, connections: routing.connections, models: routing.models, brandPolicy: routing.brandPolicy, orgPolicy: routing.orgPolicy },
            toolContext: { brandId: brand.brandId, allowedHosts: brand.websiteHosts, fetchDeps, teammates: teammates.filter((t) => t.handle !== agent.handle), searchKnowledge: (q) => d.searchKnowledge(brand.brandId, q), metrics: async () => null },
            usage: await d.usage(brand.brandId, brand.agencyId, d.userId!, agentId, conn?.id ?? null),
            signal, onEvent: emit ? (e) => emit(agentId, e) : undefined,
        });
    };

    if (conv.kind === 'direct') {
        const agent = agents[0];
        if (!agent) throw new HttpError(404, 'The agent of this conversation is not available.');
        const outcome = await runTurn(agent.id, 0, null, `${input.idempotencyKey}:${agent.id}`, []);
        return { conversationId: conv.id, steps: [{ agentInstanceId: agent.id, role: 'direct', outcome }], notices: [], stoppedBy: 'completed' };
    }

    const members: TeamMember[] = agents.map((a) => ({ agentId: a.id, handle: a.handle, name: a.name, active: a.active }));
    const lead = agents.find((a) => a.active && LEADS[conv.teamKey ?? 'all'].includes(a.templateKey));
    const team = await orchestrateTeam({
        baseKey: input.idempotencyKey, members, leadAgentId: lead?.id ?? null, mentionedAgentIds: msg.mentions, history: [], signal, now: deps.now,
        runTurn: (t) => runTurn(t.agentId, t.depth, t.parentExecutionId, t.idempotencyKey, t.history),
    });
    return {
        conversationId: conv.id, notices: team.notices, stoppedBy: team.stoppedBy,
        steps: team.steps.map((s) => ({ agentInstanceId: s.agentId, role: s.role, outcome: s.outcome })),
    };
}

export async function handleConnectionTest(input: { connectionId: string }, deps: Pick<HandlerDeps, 'data' | 'registry' | 'env' | 'fetch' | 'now'>): Promise<ConnectionTestResult> {
    const d = deps.data;
    if (!d.userId) throw new HttpError(401, 'Sign in required.');
    // RLS decides visibility: only agency staff and admins of the scoped brand see the row.
    const conn = await d.visibleConnection(input.connectionId);
    if (!conn) throw new HttpError(404, 'Connection not found.');
    const result = await testConnection({ registry: deps.registry, env: deps.env, fetch: deps.fetch, now: deps.now }, conn);
    await d.recordConnectionTest(result, conn, d.userId);
    return result;
}

/** JSON-safe outcome for the browser: no prompts, no tool payloads beyond findings, never a credential. */
export function publicOutcome(o: TurnOutcome) {
    return {
        executionId: o.executionId, duplicate: o.duplicate, status: o.status, mode: o.mode, provider: o.provider, model: o.model, routeSource: o.routeSource,
        text: o.text, proposals: o.proposals, tools: o.tools, usage: o.usage, estimatedCostUsd: o.estimatedCostUsd, errorCategory: o.errorCategory,
        error: o.error, fallbackUsed: o.fallbackUsed, latencyMs: o.latencyMs,
    };
}
