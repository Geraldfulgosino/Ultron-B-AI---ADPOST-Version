/**
 * Local adapter for the AI provider connection manager. Access rules mirror
 * supabase/migrations/20261102000007_ai_providers.sql (change both together):
 *  - agency staff manage connections and the model catalog,
 *  - brand admins see connections usable by their brand and assign them to agents,
 *  - staff read assignments; usage is brand-wide for admins, own requests otherwise.
 *
 * Local mode stores NO credential and calls NO provider: live connection tests and live
 * agent runs need the server-side Edge Functions (Supabase mode).
 */
import type { ID } from '@/domain/types';
import type * as AI from '@/domain/aiProviders';
import { AI_PROVIDERS, MODEL_ID_RE, providerInfo, SECRET_SLOT_RE } from '@/domain/aiProviders';
import type { AiAccess, AiAssignmentInput, AiAssignmentView, AiConnectionInput, AiConnectionPatch, AiConnectionTestView, AiConnectionView, AiModelInput, AiPolicyPatch, AiProvidersApi, AiUsageRow, AiUsageSummary } from '../contracts';
import { can } from '../access';
import { AccessDeniedError, assertValid, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import type { DbSnapshot, LocalDatabase } from './db';
import type { Scope } from './scope';

const SIM_MODEL = 'sim-deterministic-1';

/** Fixture: an offline simulator (usable) and an example Anthropic connection that is configured but never verified. */
export function seedAiProviders(s: DbSnapshot, agencyId: ID, actorId: ID, at: string): void {
    const base = {
        agencyId, brandId: null, apiOrganization: null, apiProject: null, maxOutputTokens: 4000, monthlyBudgetUsd: null, maxCostPerRequestUsd: null,
        monthlyRequestLimit: null, enabled: true, lastTestedAt: null, lastErrorCategory: null, createdBy: actorId, updatedBy: actorId, createdAt: at, updatedAt: at,
    } as const;
    s.aiConnections.push(
        { ...base, id: 'aic_simulator', provider: 'simulated', displayName: 'Simulator (offline)', authenticationMethod: 'none', credentialReference: null, defaultModel: SIM_MODEL, status: 'configured', verifiedModels: [] },
        { ...base, id: 'aic_anthropic', provider: 'anthropic', displayName: 'Company Anthropic API', authenticationMethod: 'platform_secret', credentialReference: 'ANTHROPIC_API_KEY', defaultModel: null, status: 'configured', verifiedModels: [] },
    );
    s.aiModels.push({
        id: 'aim_sim', agencyId, provider: 'simulated', modelId: SIM_MODEL, displayName: 'Simulated (offline, deterministic)', capabilities: ['text'],
        contextWindow: null, maxOutputTokens: null, active: true, source: 'admin', inputUsdPerMTok: null, outputUsdPerMTok: null, pricingSource: null,
        pricingVerifiedAt: null, createdAt: at, updatedAt: at,
    });
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const bad = (cond: boolean, msg: string) => (cond ? msg : false);

export function localAi(scope: Scope): AiProvidersApi {
    const { db } = scope;

    const ctx = (brandId: ID) => {
        const f = scope.facts(brandId);
        const access: AiAccess = { canManageConnections: !!f.agencyMembership, canAssign: can(f, 'admin'), canViewAllUsage: can(f, 'admin') };
        return { f, access, agencyId: f.brand.agencyId };
    };
    const requireView = (brandId: ID) => {
        const c = ctx(brandId);
        if (!c.access.canAssign && !c.access.canManageConnections) throw new AccessDeniedError();
        return c;
    };
    const requireManage = (brandId: ID) => {
        const c = ctx(brandId);
        if (!c.access.canManageConnections) throw new AccessDeniedError('Only agency administrators manage AI provider connections.');
        return c;
    };
    const inScope = (c: AI.AiConnection, agencyId: ID, brandId: ID) => c.agencyId === agencyId && (c.brandId === null || c.brandId === brandId);
    const audit = (agencyId: ID, brandId: ID | null, action: AI.AiAuditEvent['action'], subjectType: string, subjectId: ID | null, changedColumns: string[] = []) =>
        db.insert('aiAudit', { id: newId('aia'), agencyId, brandId, actorId: scope.userId, action, subjectType, subjectId, changedColumns, createdAt: db.nowIso() });

    const view = (c: AI.AiConnection): AiConnectionView => ({
        ...structuredClone(c),
        scope: c.brandId ? 'brand' : 'organization',
        assignedAgents: db.all('aiAssignments').filter((a) => a.connectionId === c.id || a.fallbackConnectionId === c.id).map((a) => ({
            agentInstanceId: a.agentInstanceId, brandId: a.brandId, name: db.find('agentInstances', a.agentInstanceId)?.displayName ?? 'Agent',
        })),
    });
    const findConnection = (brandId: ID, id: ID, agencyId: ID) => {
        const c = db.find('aiConnections', id);
        if (!c || !inScope(c, agencyId, brandId)) throw new NotFoundError('AI connection');
        return c;
    };

    function validateConnection(provider: AI.AiProviderCode, input: AiConnectionPatch, agencyId: ID, brandId: ID | null, selfId: ID | null) {
        const name = input.displayName?.trim();
        const slot = input.credentialReference?.trim() || null;
        const info = providerInfo(provider);
        assertValid({
            displayName: input.displayName !== undefined && (!name || name.length > 80
                ? 'A display name of 1–80 characters is required.'
                : bad(db.all('aiConnections').some((c) => c.id !== selfId && c.agencyId === agencyId && c.brandId === brandId && c.displayName.toLowerCase() === name.toLowerCase()), 'Another connection in this scope already has this name.')),
            credentialReference: input.credentialReference !== undefined && (provider === 'simulated'
                ? bad(!!slot, 'The simulator uses no credential.')
                : slot && (!SECRET_SLOT_RE.test(slot) || !slot.startsWith(info.slotPrefix!)
                    ? `Use a server secret slot name such as ${info.slotPrefix} or ${info.slotPrefix}_MARKETING. Never paste an API key here.`
                    : false)),
            apiOrganization: bad(!!input.apiOrganization && !/^[A-Za-z0-9_-]{1,64}$/.test(input.apiOrganization), 'Letters, digits, - and _ only.'),
            apiProject: bad(!!input.apiProject && !/^[A-Za-z0-9_-]{1,64}$/.test(input.apiProject), 'Letters, digits, - and _ only.'),
            defaultModel: bad(!!input.defaultModel && !MODEL_ID_RE.test(input.defaultModel), 'Not a valid model id.'),
            maxOutputTokens: bad(input.maxOutputTokens !== undefined && !(Number.isInteger(input.maxOutputTokens) && input.maxOutputTokens >= 64 && input.maxOutputTokens <= 32000), 'Between 64 and 32,000.'),
            monthlyBudgetUsd: bad(input.monthlyBudgetUsd != null && !(input.monthlyBudgetUsd >= 0), 'Must be 0 or more.'),
            maxCostPerRequestUsd: bad(input.maxCostPerRequestUsd != null && !(input.maxCostPerRequestUsd >= 0), 'Must be 0 or more.'),
            monthlyRequestLimit: bad(input.monthlyRequestLimit != null && !(Number.isInteger(input.monthlyRequestLimit) && input.monthlyRequestLimit > 0), 'A whole number above 0.'),
        });
        if (slot && /^(sk-|sk_|sb_|eyJ)/.test(slot)) throw new ValidationError({ credentialReference: 'That looks like a credential. Never paste an API key here: store it with "supabase secrets set" and enter only the slot name.' });
    }

    const initialStatus = (c: Pick<AI.AiConnection, 'provider' | 'credentialReference' | 'enabled'>): AI.ConnectionStatus =>
        !c.enabled ? 'disabled' : c.provider === 'simulated' || c.credentialReference ? 'configured' : 'not_configured';

    function assignmentView(a: AI.AiAgentAssignment): AiAssignmentView {
        const c = db.find('aiConnections', a.connectionId);
        const agent = db.find('agentInstances', a.agentInstanceId);
        const warnings: string[] = [];
        if (!c || !c.enabled) warnings.push('The connection is disabled or missing; runs will fail.');
        else if (c.provider !== 'simulated' && c.status !== 'connected') warnings.push(`The connection is not verified (${c.status.replace(/_/g, ' ')}). Runs fail until a connection test passes.`);
        else if (c.provider === 'simulated') warnings.push('Simulated: replies are labelled simulated and no AI model is called.');
        if (c && c.provider !== 'simulated') {
            const m = db.all('aiModels').find((x) => x.agencyId === c.agencyId && x.provider === c.provider && x.modelId === a.modelId);
            const toolKeys = agent?.tools.filter((t) => ['audit_site', 'read_knowledge', 'create_task', 'delegate', 'request_approval', 'read_analytics', 'read_search_console'].includes(t)) ?? [];
            if (toolKeys.length && !m?.capabilities.includes('tools')) warnings.push('Tool use is not confirmed for this model in the catalog, so the agent will answer without tools.');
            if (!m || m.inputUsdPerMTok === null) warnings.push('No verified price for this model: USD budgets cannot be enforced, so a monthly token limit is required.');
        }
        return { ...structuredClone(a), agentName: agent?.displayName ?? 'Agent', connectionName: c?.displayName ?? 'Missing connection', connectionStatus: c?.status ?? 'not_configured', warnings };
    }

    const policyFor = (agencyId: ID, brandId: ID | null) => db.all('aiPolicies').find((p) => p.agencyId === agencyId && p.brandId === brandId) ?? null;

    return {
        providers: () => structuredClone(AI_PROVIDERS),

        async access(brandId) {
            return ctx(brandId).access;
        },

        async connections(brandId) {
            const { agencyId } = requireView(brandId);
            return db.all('aiConnections').filter((c) => inScope(c, agencyId, brandId)).map(view).sort((a, b) => a.displayName.localeCompare(b.displayName));
        },

        async connection(brandId, id) {
            const { agencyId } = requireView(brandId);
            return view(findConnection(brandId, id, agencyId));
        },

        async createConnection(brandId, input: AiConnectionInput) {
            const { agencyId } = requireManage(brandId);
            if (!AI_PROVIDERS.some((p) => p.code === input.provider)) throw new ValidationError({ provider: 'Choose a supported provider.' });
            const scopeBrand = input.scope === 'brand' ? brandId : null;
            validateConnection(input.provider, { ...input, displayName: input.displayName ?? '' }, agencyId, scopeBrand, null);
            const now = db.nowIso();
            const row: AI.AiConnection = {
                id: newId('aic'), agencyId, brandId: scopeBrand, provider: input.provider, displayName: input.displayName.trim(),
                authenticationMethod: input.provider === 'simulated' ? 'none' : 'platform_secret',
                credentialReference: input.provider === 'simulated' ? null : input.credentialReference?.trim() || null,
                apiOrganization: input.apiOrganization || null, apiProject: input.apiProject || null, defaultModel: input.defaultModel || null,
                maxOutputTokens: input.maxOutputTokens ?? 1024, monthlyBudgetUsd: input.monthlyBudgetUsd ?? null, maxCostPerRequestUsd: input.maxCostPerRequestUsd ?? null,
                monthlyRequestLimit: input.monthlyRequestLimit ?? null, enabled: input.enabled ?? true, status: 'not_configured', lastTestedAt: null,
                lastErrorCategory: null, verifiedModels: [], createdBy: scope.userId, updatedBy: scope.userId, createdAt: now, updatedAt: now,
            };
            row.status = initialStatus(row);
            db.insert('aiConnections', row);
            audit(agencyId, scopeBrand, 'insert', 'ai_provider_connections', row.id);
            return view(row);
        },

        async updateConnection(brandId, id, patch: AiConnectionPatch) {
            const { agencyId } = requireManage(brandId);
            const c = findConnection(brandId, id, agencyId);
            validateConnection(c.provider, patch, agencyId, c.brandId, c.id);
            const next: Partial<AI.AiConnection> = {};
            if (patch.displayName !== undefined) next.displayName = patch.displayName.trim();
            if (patch.credentialReference !== undefined && c.provider !== 'simulated') next.credentialReference = patch.credentialReference?.trim() || null;
            for (const k of ['apiOrganization', 'apiProject', 'defaultModel'] as const) if (patch[k] !== undefined) next[k] = patch[k] || null;
            for (const k of ['maxOutputTokens', 'monthlyBudgetUsd', 'maxCostPerRequestUsd', 'monthlyRequestLimit', 'enabled'] as const) {
                if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
            }
            const changed = Object.keys(next).filter((k) => JSON.stringify((next as Record<string, unknown>)[k]) !== JSON.stringify((c as unknown as Record<string, unknown>)[k]));
            if (!changed.length) return view(c);
            const merged = { ...c, ...next };
            // Same rules as the database trigger: credential or account changes, and re-enabling, need a new test.
            const resetsVerification = ['credentialReference', 'apiOrganization', 'apiProject'].some((k) => changed.includes(k)) || (merged.enabled && !c.enabled);
            if (resetsVerification) Object.assign(next, { status: initialStatus(merged), lastTestedAt: null, lastErrorCategory: null, verifiedModels: [] });
            if (!merged.enabled) next.status = 'disabled';
            db.patch('aiConnections', id, { ...next, updatedBy: scope.userId, updatedAt: db.nowIso() });
            audit(agencyId, c.brandId, 'update', 'ai_provider_connections', id, changed.map((k) => k.replace(/[A-Z]/g, (x) => '_' + x.toLowerCase())).sort());
            return view(db.find('aiConnections', id)!);
        },

        async rotateCredential(brandId, id, credentialReference) {
            if (!credentialReference?.trim()) throw new ValidationError({ credentialReference: 'A secret slot name is required.' });
            return this.updateConnection(brandId, id, { credentialReference });
        },

        async removeConnection(brandId, id) {
            const { agencyId } = requireManage(brandId);
            const c = findConnection(brandId, id, agencyId);
            const users = db.all('aiAssignments').filter((a) => a.connectionId === id);
            if (users.length) throw new ValidationError({ connection: `Reassign ${users.length} agent(s) using this connection before removing it.` });
            db.all('aiAssignments').filter((a) => a.fallbackConnectionId === id).forEach((a) => db.patch('aiAssignments', a.id, { fallbackConnectionId: null, fallbackPolicy: 'disabled', fallbackModelId: null }));
            db.all('aiPolicies').filter((p) => p.defaultConnectionId === id).forEach((p) => db.patch('aiPolicies', p.id, { defaultConnectionId: null }));
            db.delete('aiConnections', (r) => r.id === id);
            audit(agencyId, c.brandId, 'delete', 'ai_provider_connections', id);
        },

        async testConnection(brandId, id): Promise<AiConnectionTestView> {
            const { agencyId } = requireView(brandId);
            const c = findConnection(brandId, id, agencyId);
            const testedAt = db.nowIso();
            let result: AiConnectionTestView;
            if (!c.enabled) {
                result = { connectionId: id, ok: false, status: c.status, errorCategory: 'not_configured', message: 'The connection is disabled.', modelsReported: 0, latencyMs: 0, testedAt, ranOnServer: false };
            } else if (c.provider === 'simulated') {
                db.patch('aiConnections', id, { status: 'connected', lastTestedAt: testedAt, lastErrorCategory: null, verifiedModels: [SIM_MODEL] });
                result = { connectionId: id, ok: true, status: 'connected', errorCategory: null, message: 'The offline simulator is available. It never calls an AI model.', modelsReported: 1, latencyMs: 0, testedAt, ranOnServer: false };
            } else {
                // No server, no secrets, no network in local mode: report that honestly and leave the status as it is.
                result = {
                    connectionId: id, ok: false, status: c.status, errorCategory: 'not_configured', modelsReported: 0, latencyMs: 0, testedAt, ranOnServer: false,
                    message: 'Connection tests run in the server-side ai-connection-test function, which needs Supabase mode and an authorized secret in the referenced slot. Nothing was sent.',
                };
            }
            db.insert('aiHealthChecks', {
                id: newId('aih'), agencyId, brandId: c.brandId, connectionId: id, testedBy: scope.userId, result: result.ok ? 'success' : 'failure',
                failureCategory: result.errorCategory, latencyMs: result.latencyMs, modelsReported: result.modelsReported, message: result.message, createdAt: testedAt,
            });
            audit(agencyId, c.brandId, 'test', 'ai_provider_connections', id);
            return result;
        },

        async healthChecks(brandId, connectionId) {
            const { agencyId } = requireView(brandId);
            findConnection(brandId, connectionId, agencyId);
            return structuredClone(db.all('aiHealthChecks').filter((h) => h.connectionId === connectionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20));
        },

        async models(brandId) {
            scope.require(brandId, 'staff');
            const { agencyId } = ctx(brandId);
            return structuredClone(db.all('aiModels').filter((m) => m.agencyId === agencyId).sort((a, b) => a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId)));
        },

        async saveModel(brandId, input: AiModelInput) {
            const { agencyId } = requireManage(brandId);
            const priced = input.inputUsdPerMTok != null || input.outputUsdPerMTok != null;
            assertValid({
                modelId: !MODEL_ID_RE.test(input.modelId ?? '') && 'Enter the provider’s exact model id.',
                displayName: !input.displayName?.trim() && 'A display name is required.',
                inputUsdPerMTok: bad(priced && !(Number(input.inputUsdPerMTok) >= 0 && input.inputUsdPerMTok !== null), 'Enter both prices or neither.'),
                outputUsdPerMTok: bad(priced && !(Number(input.outputUsdPerMTok) >= 0 && input.outputUsdPerMTok !== null), 'Enter both prices or neither.'),
                pricingSource: bad(priced && !input.pricingSource?.trim(), 'Say where the price comes from (for example the provider’s pricing page and date).'),
                contextWindow: bad(input.contextWindow != null && !(input.contextWindow > 0), 'Must be positive.'),
                maxOutputTokens: bad(input.maxOutputTokens != null && !(input.maxOutputTokens > 0), 'Must be positive.'),
            });
            const now = db.nowIso();
            const existing = input.id ? db.all('aiModels').find((m) => m.id === input.id && m.agencyId === agencyId) : db.all('aiModels').find((m) => m.agencyId === agencyId && m.provider === input.provider && m.modelId === input.modelId);
            if (input.id && !existing) throw new NotFoundError('Model');
            const fields = {
                displayName: input.displayName.trim(), capabilities: [...new Set(input.capabilities)], contextWindow: num(input.contextWindow), maxOutputTokens: num(input.maxOutputTokens),
                active: input.active ?? true, inputUsdPerMTok: priced ? Number(input.inputUsdPerMTok) : null, outputUsdPerMTok: priced ? Number(input.outputUsdPerMTok) : null,
                pricingSource: priced ? input.pricingSource!.trim() : null, pricingVerifiedAt: priced ? now : null, updatedAt: now,
            };
            if (existing) {
                db.patch('aiModels', existing.id, fields);
                audit(agencyId, null, 'update', 'ai_provider_models', existing.id, Object.keys(fields).filter((k) => k !== 'updatedAt'));
                return structuredClone(db.find('aiModels', existing.id)!);
            }
            const row: AI.AiModel = { id: newId('aim'), agencyId, provider: input.provider, modelId: input.modelId, source: 'admin', createdAt: now, ...fields };
            db.insert('aiModels', row);
            audit(agencyId, null, 'insert', 'ai_provider_models', row.id);
            return structuredClone(row);
        },

        async assignments(brandId) {
            scope.require(brandId, 'staff');
            return db.all('aiAssignments').filter((a) => a.brandId === brandId).map(assignmentView);
        },

        async assign(brandId, agentInstanceId, input: AiAssignmentInput) {
            const { access, agencyId } = ctx(brandId);
            if (!access.canAssign) throw new AccessDeniedError('Only brand administrators assign AI models to agents.');
            const agent = db.find('agentInstances', agentInstanceId);
            if (!agent || agent.brandId !== brandId) throw new NotFoundError('Agent');
            const c = db.find('aiConnections', input.connectionId);
            if (!c || !inScope(c, agencyId, brandId)) throw new ValidationError({ connectionId: 'Choose a connection available to this brand.' });
            const fb = input.fallbackConnectionId ? db.find('aiConnections', input.fallbackConnectionId) : null;
            const crossProvider = input.fallbackPolicy === 'secondary_provider' && fb && fb.provider !== c.provider;
            const consent = !!policyFor(agencyId, null)?.allowCrossProviderFallback && !!policyFor(agencyId, brandId)?.allowCrossProviderFallback;
            const temperature = input.temperature === null || input.temperature === undefined ? undefined : Number(input.temperature);
            assertValid({
                modelId: !MODEL_ID_RE.test(input.modelId ?? '')
                    ? 'Enter a model id.'
                    : bad(c.provider !== 'simulated' && c.verifiedModels.length > 0 && !c.verifiedModels.includes(input.modelId), 'This model was not reported by the connection’s last test.'),
                temperature: bad(temperature !== undefined && !(temperature >= 0 && temperature <= 2), 'Between 0 and 2.'),
                fallbackModelId: bad((input.fallbackPolicy === 'secondary_model' || input.fallbackPolicy === 'secondary_provider') && !MODEL_ID_RE.test(input.fallbackModelId ?? ''), 'A fallback model is required for this policy.'),
                fallbackConnectionId: input.fallbackPolicy === 'secondary_provider' && (!fb || !inScope(fb, agencyId, brandId)
                    ? 'Choose a fallback connection available to this brand.'
                    : bad(!!crossProvider && !consent, 'Cross-provider fallback needs consent in both the organization and brand routing policies.')),
            });
            const now = db.nowIso();
            const fields = {
                connectionId: c.id, provider: c.provider, modelId: input.modelId, generationConfig: temperature === undefined ? {} : { temperature },
                fallbackPolicy: input.fallbackPolicy, fallbackConnectionId: input.fallbackPolicy === 'secondary_provider' ? fb!.id : null,
                fallbackModelId: input.fallbackPolicy === 'secondary_model' || input.fallbackPolicy === 'secondary_provider' ? input.fallbackModelId! : null,
                enabled: input.enabled ?? true, updatedBy: scope.userId, updatedAt: now,
            };
            const existing = db.all('aiAssignments').find((a) => a.agentInstanceId === agentInstanceId);
            if (existing) {
                const changed = Object.keys(fields).filter((k) => !['updatedAt', 'updatedBy'].includes(k) && JSON.stringify((fields as Record<string, unknown>)[k]) !== JSON.stringify((existing as unknown as Record<string, unknown>)[k]));
                db.patch('aiAssignments', existing.id, fields);
                audit(agencyId, brandId, 'update', 'ai_agent_model_assignments', existing.id, changed);
                return assignmentView(db.find('aiAssignments', existing.id)!);
            }
            const row: AI.AiAgentAssignment = { id: newId('aiz'), brandId, agentInstanceId, ...fields };
            db.insert('aiAssignments', row);
            audit(agencyId, brandId, 'insert', 'ai_agent_model_assignments', row.id);
            return assignmentView(row);
        },

        async unassign(brandId, agentInstanceId) {
            const { access, agencyId } = ctx(brandId);
            if (!access.canAssign) throw new AccessDeniedError();
            const a = db.all('aiAssignments').find((x) => x.agentInstanceId === agentInstanceId && x.brandId === brandId);
            if (!a) return;
            db.delete('aiAssignments', (r) => r.id === a.id);
            audit(agencyId, brandId, 'delete', 'ai_agent_model_assignments', a.id);
        },

        async policies(brandId) {
            const { agencyId } = requireView(brandId);
            return { organization: structuredClone(policyFor(agencyId, null)), brand: structuredClone(policyFor(agencyId, brandId)) };
        },

        async updatePolicy(brandId, level, patch: AiPolicyPatch) {
            const c = ctx(brandId);
            const allowed = level === 'organization' ? c.access.canManageConnections : c.access.canAssign;
            if (!allowed) throw new AccessDeniedError(level === 'organization' ? 'Only agency administrators change organization AI policy.' : undefined);
            const target = level === 'organization' ? null : brandId;
            if (patch.defaultConnectionId) {
                const conn = db.find('aiConnections', patch.defaultConnectionId);
                const ok = conn && conn.agencyId === c.agencyId && (level === 'organization' ? conn.brandId === null : inScope(conn, c.agencyId, brandId));
                if (!ok) throw new ValidationError({ defaultConnectionId: level === 'organization' ? 'The organization default must be an organization-wide connection.' : 'Choose a connection available to this brand.' });
            }
            assertValid({
                defaultModel: bad(!!patch.defaultModel && !MODEL_ID_RE.test(patch.defaultModel), 'Not a valid model id.'),
                monthlyBudgetUsd: bad(patch.monthlyBudgetUsd != null && !(patch.monthlyBudgetUsd >= 0), 'Must be 0 or more.'),
                perUserMonthlyBudgetUsd: bad(patch.perUserMonthlyBudgetUsd != null && !(patch.perUserMonthlyBudgetUsd >= 0), 'Must be 0 or more.'),
                maxCostPerRequestUsd: bad(patch.maxCostPerRequestUsd != null && !(patch.maxCostPerRequestUsd >= 0), 'Must be 0 or more.'),
                monthlyRequestLimit: bad(patch.monthlyRequestLimit != null && !(Number.isInteger(patch.monthlyRequestLimit) && patch.monthlyRequestLimit > 0), 'A whole number above 0.'),
                monthlyTokenLimit: bad(patch.monthlyTokenLimit != null && !(Number.isInteger(patch.monthlyTokenLimit) && patch.monthlyTokenLimit > 0), 'A whole number above 0.'),
            });
            const now = db.nowIso();
            const existing = policyFor(c.agencyId, target);
            if (existing) {
                db.patch('aiPolicies', existing.id, { ...patch, updatedBy: scope.userId, updatedAt: now });
                audit(c.agencyId, target, 'update', 'ai_routing_policies', existing.id, Object.keys(patch));
                return structuredClone(db.find('aiPolicies', existing.id)!);
            }
            const row: AI.AiRoutingPolicy = {
                id: newId('aip'), agencyId: c.agencyId, brandId: target, defaultConnectionId: null, defaultModel: null, allowCrossProviderFallback: false,
                monthlyBudgetUsd: null, perUserMonthlyBudgetUsd: null, maxCostPerRequestUsd: null, monthlyRequestLimit: null, monthlyTokenLimit: null,
                ...patch, updatedBy: scope.userId, updatedAt: now,
            };
            db.insert('aiPolicies', row);
            audit(c.agencyId, target, 'insert', 'ai_routing_policies', row.id);
            return structuredClone(row);
        },

        async usage(brandId, filters = {}) {
            scope.require(brandId, 'staff');
            const { access } = ctx(brandId);
            const to = filters.to ?? db.nowIso().slice(0, 10);
            const from = filters.from ?? new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
            const events = db.all('aiUsage').filter((e) => e.brandId === brandId && (access.canViewAllUsage || e.userId === scope.userId))
                .filter((e) => e.createdAt.slice(0, 10) >= from && e.createdAt.slice(0, 10) <= to);
            return summarize(db, events, from, to, access.canViewAllUsage ? 'brand' : 'own');
        },

        async audit(brandId) {
            const { agencyId } = requireView(brandId);
            return structuredClone(db.all('aiAudit').filter((e) => e.agencyId === agencyId && (e.brandId === null || e.brandId === brandId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
        },
    };
}

function summarize(db: LocalDatabase, events: AI.AiUsageEvent[], from: string, to: string, scope: 'brand' | 'own'): AiUsageSummary {
    const row = (key: string, label: string, list: AI.AiUsageEvent[]): AiUsageRow => {
        const priced = list.filter((e) => e.estimatedCost !== null || e.reportedCost !== null);
        return {
            key, label, requests: list.length, failures: list.filter((e) => e.executionStatus === 'failed').length,
            inputTokens: list.reduce((s, e) => s + e.inputTokens, 0), outputTokens: list.reduce((s, e) => s + e.outputTokens, 0),
            estimatedCostUsd: priced.length ? Math.round(priced.reduce((s, e) => s + (e.reportedCost ?? e.estimatedCost ?? 0), 0) * 1e6) / 1e6 : null,
            unpriced: list.filter((e) => e.executionStatus === 'succeeded' && e.provider !== 'simulated' && e.estimatedCost === null && e.reportedCost === null).length,
        };
    };
    const group = (keyOf: (e: AI.AiUsageEvent) => string, labelOf: (k: string) => string) => {
        const m = new Map<string, AI.AiUsageEvent[]>();
        for (const e of events) m.set(keyOf(e), [...(m.get(keyOf(e)) ?? []), e]);
        return [...m.entries()].map(([k, list]) => row(k, labelOf(k), list)).sort((a, b) => b.requests - a.requests);
    };
    const days = new Map<string, { requests: number; tokens: number; failures: number }>();
    for (const e of events) {
        const d = e.createdAt.slice(0, 10);
        const x = days.get(d) ?? { requests: 0, tokens: 0, failures: 0 };
        x.requests++; x.tokens += e.inputTokens + e.outputTokens; if (e.executionStatus === 'failed') x.failures++;
        days.set(d, x);
    }
    return {
        window: { from, to }, scope,
        totals: row('total', 'All requests', events),
        byProvider: group((e) => e.provider, (k) => (AI_PROVIDERS.find((p) => p.code === k)?.name ?? k)),
        byModel: group((e) => `${e.provider}:${e.modelId}`, (k) => k.split(':').slice(1).join(':')),
        byAgent: group((e) => e.agentInstanceId ?? '-', (k) => db.find('agentInstances', k)?.displayName ?? 'Unknown agent'),
        byUser: group((e) => e.userId ?? '-', (k) => db.find('users', k)?.name ?? 'Unknown user'),
        daily: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v })),
        recent: structuredClone([...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25)),
    };
}

/** Used by the local engine: the assignment (or brand/org default) that should serve an agent. */
export function localRouteFor(db: LocalDatabase, brandId: ID, agentInstanceId: ID): { connection: AI.AiConnection | null; modelId: string; source: string } | null {
    const brand = db.find('brands', brandId);
    if (!brand) return null;
    const a = db.all('aiAssignments').find((x) => x.agentInstanceId === agentInstanceId && x.enabled);
    if (a) return { connection: db.find('aiConnections', a.connectionId) ?? null, modelId: a.modelId, source: 'agent_assignment' };
    for (const [level, p] of [['brand_default', db.all('aiPolicies').find((x) => x.brandId === brandId)], ['organization_default', db.all('aiPolicies').find((x) => x.agencyId === brand.agencyId && x.brandId === null)]] as const) {
        if (p?.defaultConnectionId && p.defaultModel) return { connection: db.find('aiConnections', p.defaultConnectionId) ?? null, modelId: p.defaultModel, source: level };
    }
    return null;
}

