/**
 * ServerData backed by Supabase (used by the Edge Functions).
 *  - `user` client: anon key + the caller's JWT. Every caller-scoped read is RLS-filtered.
 *  - `service` client: service role, server-only. Used only after the handler verified the
 *    caller, and only for the verified brand/agency (routing metadata, usage totals, and
 *    writing executions, agent messages, usage events and health checks).
 *
 * STATUS: implemented and type-checked; NOT yet run against staging (needs migration 0007
 * applied and the functions deployed, both awaiting owner approval).
 */
import type { UsageSnapshot } from './budget.ts';
import type { ConnectionTestResult } from './connectionTest.ts';
import type { ExecutionBegin, ExecutionStore, TurnOutcome, TurnRequest } from './execution.ts';
import { HttpError, type AgentRow, type CallerBrand, type CallerConversation, type CallerMessage, type HistoryRow, type RoutingData, type ServerData } from './handlers.ts';
import type { AssignmentConfig, ConnectionConfig, ModelCatalogEntry, RoutingPolicy } from './routing.ts';
import type { AIErrorCategory, Capability, ProviderCode } from './types.ts';

/** Minimal surface of supabase-js used here (kept structural so this file has no runtime import). */
// deno-lint-ignore no-explicit-any
export type Db = any;

const WRITE_ROLES = ['owner', 'admin', 'manager', 'member'];
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
const dayStart = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00.000Z';

function must<T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T {
    if (r.error) throw new HttpError(500, `Could not read ${what}.`);
    return r.data;
}

export function mapConnection(r: Record<string, any>): ConnectionConfig {
    return {
        id: r.id, agencyId: r.agency_id, brandId: r.brand_id, provider: r.provider_code as ProviderCode, displayName: r.display_name,
        credentialReference: r.credential_reference, organization: r.api_organization, project: r.api_project, enabled: r.enabled,
        status: r.connection_status, verifiedModels: r.verified_models ?? [], maxOutputTokens: r.max_output_tokens,
        monthlyBudgetUsd: r.monthly_budget_usd === null ? null : Number(r.monthly_budget_usd),
        maxCostPerRequestUsd: r.max_cost_per_request_usd === null ? null : Number(r.max_cost_per_request_usd),
        monthlyRequestLimit: r.monthly_request_limit,
    };
}

const mapPolicy = (r: Record<string, any> | null | undefined): RoutingPolicy | null => r ? {
    agencyId: r.agency_id, brandId: r.brand_id, defaultConnectionId: r.default_connection_id, defaultModel: r.default_model,
    allowCrossProviderFallback: r.allow_cross_provider_fallback, monthlyBudgetUsd: r.monthly_budget_usd === null ? null : Number(r.monthly_budget_usd),
    perUserMonthlyBudgetUsd: r.per_user_monthly_budget_usd === null ? null : Number(r.per_user_monthly_budget_usd),
    maxCostPerRequestUsd: r.max_cost_per_request_usd === null ? null : Number(r.max_cost_per_request_usd),
    monthlyRequestLimit: r.monthly_request_limit, monthlyTokenLimit: r.monthly_token_limit === null ? null : Number(r.monthly_token_limit),
} : null;

export function createSupabaseData(user: Db, service: Db, userId: string | null, now: () => Date = () => new Date()): ServerData {
    const versionByAgent = new Map<string, number>();

    const store: ExecutionStore = {
        async findByIdempotencyKey(brandId, key) {
            const r = await service.from('agent_executions').select('*').eq('brand_id', brandId).eq('idempotency_key', key).maybeSingle();
            const e = must(r, 'executions') as Record<string, any> | null;
            if (!e || e.status === 'running') return e ? duplicateRunning(e) : null;
            const m = must(await service.from('messages').select('body, proposals').eq('execution_id', e.id).maybeSingle(), 'messages') as Record<string, any> | null;
            return {
                executionId: e.id, duplicate: true, status: e.error_category === 'cancelled' ? 'cancelled' : e.status, mode: e.mode, routeSource: null,
                connectionId: e.connection_id, provider: e.provider, model: e.model, text: m?.body ?? '', proposals: (m?.proposals ?? []).map((p: any) => p.action),
                tools: [], skillResults: [], usage: { inputTokens: e.input_tokens, outputTokens: e.output_tokens }, estimatedCostUsd: null, pricingVersion: null,
                errorCategory: e.error_category, error: e.error, providerRequestId: e.provider_request_id, fallbackUsed: e.fallback_used, attempts: 0, latencyMs: 0,
            };
        },
        async begin(rec: ExecutionBegin) {
            const q = rec.request;
            const r = await service.from('agent_executions').insert({
                brand_id: q.brandId, agent_instance_id: q.agent.id, conversation_id: q.conversationId, trigger_message_id: q.triggerMessageId,
                parent_execution_id: q.parentExecutionId ?? null, handoff_depth: q.handoffDepth ?? 0, status: 'running', mode: rec.mode,
                provider: rec.target?.connection.provider ?? 'none', model: rec.target?.modelId ?? 'none', instruction_version: versionByAgent.get(q.agent.id) ?? 0,
                connection_id: rec.target?.connection.id ?? null, idempotency_key: rec.idempotencyKey,
            }).select('id').single();
            if (r.error?.code === '23505') throw new HttpError(409, 'This request is already running.');
            return (must(r, 'execution insert') as { id: string }).id;
        },
        async finish(id: string, o: TurnOutcome, q: TurnRequest) {
            const status = o.status === 'cancelled' ? 'failed' : o.status;
            must(await service.from('agent_executions').update({
                status, mode: o.mode, provider: o.provider ?? 'none', model: o.model ?? 'none', connection_id: o.connectionId,
                input_tokens: o.usage?.inputTokens ?? 0, output_tokens: o.usage?.outputTokens ?? 0, cost_usd: o.estimatedCostUsd ?? 0,
                error: o.error, error_category: o.errorCategory, provider_request_id: o.providerRequestId, fallback_used: o.fallbackUsed, finished_at: now().toISOString(),
            }).eq('id', id), 'execution update');
            const answered = o.status === 'succeeded' || (o.status === 'cancelled' && o.text);
            must(await service.from('messages').insert(answered ? {
                brand_id: q.brandId, conversation_id: q.conversationId, author_type: 'agent', author_agent_id: q.agent.id,
                body: o.status === 'cancelled' ? `${o.text}\n\n[Stopped by the user before the answer was complete.]` : o.text,
                status: 'sent', execution_id: id, mode: o.mode, reply_to_id: q.triggerMessageId,
                proposals: o.proposals.map((action) => ({ id: crypto.randomUUID(), action, status: 'proposed', resultId: null })),
            } : {
                brand_id: q.brandId, conversation_id: q.conversationId, author_type: 'system', body: `${q.agent.name}: ${o.error ?? 'The request failed.'}`,
                status: 'failed', execution_id: id, mode: o.mode, reply_to_id: q.triggerMessageId,
            }), 'message insert');
            must(await service.from('ai_usage_events').insert({
                agency_id: q.agencyId, brand_id: q.brandId, user_id: q.userId, agent_instance_id: q.agent.id, conversation_id: q.conversationId, execution_id: id,
                connection_id: o.connectionId, provider_code: o.provider ?? 'none', model_id: o.model ?? 'none', request_id: o.providerRequestId,
                input_tokens: o.usage?.inputTokens ?? 0, output_tokens: o.usage?.outputTokens ?? 0, reported_cost: null, estimated_cost: o.estimatedCostUsd,
                pricing_version: o.estimatedCostUsd !== null ? o.pricingVersion : null, execution_status: o.status, error_category: o.errorCategory, latency_ms: o.latencyMs,
            }), 'usage insert');
        },
    };

    return {
        userId,
        async message(id): Promise<CallerMessage | null> {
            const m = must(await user.from('messages').select('id, conversation_id, brand_id, author_user_id, body, mentions').eq('id', id).maybeSingle(), 'message') as Record<string, any> | null;
            return m ? { id: m.id, conversationId: m.conversation_id, brandId: m.brand_id, authorUserId: m.author_user_id, body: m.body, mentions: m.mentions ?? [] } : null;
        },
        async conversation(id): Promise<CallerConversation | null> {
            const c = must(await user.from('conversations').select('id, brand_id, kind, team_key, agent_instance_ids, archived, website_id').eq('id', id).maybeSingle(), 'conversation') as Record<string, any> | null;
            return c ? { id: c.id, brandId: c.brand_id, kind: c.kind, teamKey: c.team_key, agentInstanceIds: c.agent_instance_ids ?? [], archived: c.archived, websiteId: c.website_id ?? null } : null;
        },
        async brand(brandId): Promise<CallerBrand | null> {
            const b = must(await user.from('brands').select('id, agency_id, name').eq('id', brandId).maybeSingle(), 'brand') as Record<string, any> | null;
            if (!b || !userId) return null;
            const bm = must(await user.from('brand_memberships').select('role').eq('brand_id', brandId).eq('user_id', userId).maybeSingle(), 'membership') as { role: string } | null;
            const am = must(await user.from('agency_memberships').select('role').eq('agency_id', b.agency_id).eq('user_id', userId).maybeSingle(), 'agency membership');
            const sites = must(await user.from('websites').select('id, name, domain, website_url, status, is_demo').eq('brand_id', brandId), 'websites') as Array<Record<string, any>>;
            return {
                brandId, agencyId: b.agency_id, brandName: b.name, canWrite: !!am || WRITE_ROLES.includes(bm?.role ?? ''),
                websites: sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, websiteUrl: s.website_url, status: s.status, isDemo: !!s.is_demo })),
            };
        },
        async agents(brandId, ids): Promise<AgentRow[]> {
            if (!ids.length) return [];
            const rows = must(await user.from('agent_instances')
                .select('id, display_name, handle, template_key, active, tools, max_output_tokens, max_runs_per_day, monthly_budget_usd, agent_templates(team), agent_instruction_versions!agent_instances_active_version_fk(version, instructions)')
                .eq('brand_id', brandId).in('id', ids), 'agents') as Array<Record<string, any>>;
            return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean).map((r: any) => {
                versionByAgent.set(r.id, r.agent_instruction_versions?.version ?? 0);
                return {
                    id: r.id, name: r.display_name, handle: r.handle, templateKey: r.template_key, team: r.agent_templates?.team ?? 'seo', active: r.active,
                    instructions: r.agent_instruction_versions?.instructions ?? '', tools: r.tools ?? [],
                    limits: { maxOutputTokens: r.max_output_tokens, maxRunsPerDay: r.max_runs_per_day, monthlyBudgetUsd: Number(r.monthly_budget_usd) },
                };
            });
        },
        async history(conversationId, beforeMessageId, limit): Promise<HistoryRow[]> {
            const pivot = must(await user.from('messages').select('created_at').eq('id', beforeMessageId).single(), 'message') as { created_at: string };
            const rows = must(await user.from('messages').select('author_type, author_user_id, author_agent_id, body, profiles(name), agent_instances(display_name)')
                .eq('conversation_id', conversationId).lt('created_at', pivot.created_at).order('created_at', { ascending: false }).limit(limit), 'history') as Array<Record<string, any>>;
            return rows.reverse().map((r) => ({
                authorType: r.author_type, body: r.body, agentInstanceId: r.author_agent_id,
                authorName: r.author_type === 'user' ? r.profiles?.name ?? 'User' : r.author_type === 'agent' ? r.agent_instances?.display_name ?? 'Agent' : 'System',
            }));
        },
        async searchKnowledge(brandId, query) {
            const rows = must(await user.from('knowledge_chunks').select('text, knowledge_documents(title)').eq('brand_id', brandId)
                .textSearch('text', query, { config: 'english', type: 'websearch' }).limit(3), 'knowledge') as Array<Record<string, any>>;
            return rows.map((r) => ({ title: r.knowledge_documents?.title ?? 'Document', excerpt: String(r.text).slice(0, 400) }));
        },
        async visibleConnection(connectionId) {
            const r = must(await user.from('ai_provider_connections').select('*').eq('id', connectionId).maybeSingle(), 'connection') as Record<string, any> | null;
            return r ? mapConnection(r) : null;
        },
        async routing(brandId, agencyId): Promise<RoutingData> {
            const [a, c, m, p] = await Promise.all([
                service.from('ai_agent_model_assignments').select('*').eq('brand_id', brandId),
                service.from('ai_provider_connections').select('*').eq('agency_id', agencyId).or(`brand_id.is.null,brand_id.eq.${brandId}`),
                service.from('ai_provider_models').select('*').eq('agency_id', agencyId).eq('active', true),
                service.from('ai_routing_policies').select('*').eq('agency_id', agencyId).or(`brand_id.is.null,brand_id.eq.${brandId}`),
            ]);
            const policies = must(p, 'policies') as Array<Record<string, any>>;
            return {
                assignments: (must(a, 'assignments') as Array<Record<string, any>>).map((r): AssignmentConfig => ({
                    agentInstanceId: r.agent_instance_id, connectionId: r.connection_id, modelId: r.model_id, generationConfig: r.generation_config ?? {},
                    fallbackPolicy: r.fallback_policy, fallbackConnectionId: r.fallback_connection_id, fallbackModelId: r.fallback_model_id, enabled: r.enabled,
                })),
                connections: (must(c, 'connections') as Array<Record<string, any>>).map(mapConnection),
                models: (must(m, 'models') as Array<Record<string, any>>).map((r): ModelCatalogEntry => ({
                    provider: r.provider_code, modelId: r.provider_model_id, capabilities: (r.capability_flags ?? []) as Capability[], maxOutputTokens: r.max_output_tokens,
                    inputUsdPerMTok: r.input_usd_per_mtok === null ? null : Number(r.input_usd_per_mtok), outputUsdPerMTok: r.output_usd_per_mtok === null ? null : Number(r.output_usd_per_mtok),
                    pricingVersion: r.pricing_verified_at ? `${r.pricing_source ?? 'admin'}@${r.pricing_verified_at}` : null,
                })),
                brandPolicy: mapPolicy(policies.find((x) => x.brand_id === brandId)),
                orgPolicy: mapPolicy(policies.find((x) => x.brand_id === null)),
            };
        },
        async usage(brandId, agencyId, uid, agentId, connectionId): Promise<UsageSnapshot> {
            const since = monthStart(now());
            const rows = must(await service.from('ai_usage_events').select('brand_id, user_id, agent_instance_id, connection_id, input_tokens, output_tokens, estimated_cost, reported_cost, execution_status, created_at')
                .eq('agency_id', agencyId).gte('created_at', since).neq('execution_status', 'limited').limit(50_000), 'usage') as Array<Record<string, any>>;
            const cost = (r: Record<string, any>) => Number(r.reported_cost ?? r.estimated_cost ?? 0);
            const tokens = (r: Record<string, any>) => r.input_tokens + r.output_tokens;
            const brand = rows.filter((r) => r.brand_id === brandId);
            const agent = rows.filter((r) => r.agent_instance_id === agentId);
            const conn = rows.filter((r) => connectionId && r.connection_id === connectionId);
            const sum = (list: Array<Record<string, any>>, f: (r: Record<string, any>) => number) => list.reduce((s, r) => s + f(r), 0);
            return {
                orgMonthCostUsd: sum(rows, cost), orgMonthRequests: rows.length, orgMonthTokens: sum(rows, tokens),
                brandMonthCostUsd: sum(brand, cost), brandMonthRequests: brand.length, brandMonthTokens: sum(brand, tokens),
                userMonthCostUsd: sum(rows.filter((r) => r.user_id === uid), cost), agentMonthCostUsd: sum(agent, cost),
                agentRunsToday: agent.filter((r) => r.created_at >= dayStart(now())).length,
                connectionMonthCostUsd: sum(conn, cost), connectionMonthRequests: conn.length,
            };
        },
        async requestsInLastMinute(uid) {
            const r = await service.from('ai_usage_events').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', new Date(now().getTime() - 60_000).toISOString());
            if (r.error) throw new HttpError(500, 'Could not check the rate limit.');
            return r.count ?? 0;
        },
        store,
        async recordConnectionTest(result: ConnectionTestResult, conn: ConnectionConfig, testedBy: string) {
            must(await service.from('ai_provider_connections').update({
                connection_status: result.status, last_tested_at: result.testedAt, last_error_category: result.errorCategory as AIErrorCategory | null,
                ...(result.ok ? { verified_models: result.models.map((m) => m.id).slice(0, 500) } : {}),
            }).eq('id', conn.id), 'connection update');
            must(await service.from('ai_provider_health_checks').insert({
                agency_id: conn.agencyId, brand_id: conn.brandId, connection_id: conn.id, tested_by: testedBy, result: result.ok ? 'success' : 'failure',
                failure_category: result.errorCategory, latency_ms: result.latencyMs, models_reported: result.models.length,
            }), 'health check insert');
            if (result.ok && result.models.length) {
                // Catalog entries from the provider: ids and names only. Capabilities and prices stay unset until an admin verifies them.
                must(await service.from('ai_provider_models').upsert(result.models.slice(0, 500).map((m) => ({
                    agency_id: conn.agencyId, provider_code: conn.provider, provider_model_id: m.id, display_name: m.displayName, source: 'provider_api',
                })), { onConflict: 'agency_id,provider_code,provider_model_id', ignoreDuplicates: true }), 'model catalog upsert');
            }
        },
    };
}

function duplicateRunning(e: Record<string, any>): TurnOutcome {
    return {
        executionId: e.id, duplicate: true, status: 'failed', mode: e.mode, routeSource: null, connectionId: e.connection_id, provider: e.provider, model: e.model,
        text: '', proposals: [], tools: [], skillResults: [], usage: null, estimatedCostUsd: null, pricingVersion: null, errorCategory: 'unknown',
        error: 'This request is still running. Wait for it to finish instead of resending.', providerRequestId: null, fallbackUsed: false, attempts: 0, latencyMs: 0,
    };
}
