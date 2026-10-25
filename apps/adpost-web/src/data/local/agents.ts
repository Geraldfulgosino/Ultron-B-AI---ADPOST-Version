import type { AgentInstance, AgentTemplateKey, ID, InstructionVersion, ToolKey } from '@/domain/types';
import type { AgentsApi } from '../contracts';
import { AGENT_TEMPLATES, ALL_TOOLS, DEFAULT_LIMITS, DEFAULT_MODEL, modelOption, renderInstructions, templateByKey } from '@/domain/agents';
import { assertValid, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import type { DbSnapshot, LocalDatabase } from './db';
import type { Scope } from './scope';
import { agentSpend } from './engine';

const MAX_INSTRUCTIONS = 8000;

/** Builds an instance + its v1 instructions. Shared by the API and the fixtures. */
export function buildAgentInstance(brandId: ID, brandName: string, key: AgentTemplateKey, createdBy: ID, now: string, ids?: { agent: ID; version: ID }) {
    const t = templateByKey(key);
    const agentId = ids?.agent ?? newId('agt');
    const version: InstructionVersion = {
        id: ids?.version ?? newId('ivr'), brandId, agentInstanceId: agentId, version: 1,
        instructions: renderInstructions(t.defaultInstructions, brandName), note: 'Initial template instructions', createdBy, createdAt: now,
    };
    const agent: AgentInstance = {
        id: agentId, brandId, templateKey: key, displayName: t.name, handle: t.handle, active: true, model: { ...DEFAULT_MODEL },
        activeInstructionVersionId: version.id, tools: [...t.defaultTools], limits: { ...DEFAULT_LIMITS }, createdAt: now, updatedAt: now,
    };
    return { agent, version };
}

export function seedAgents(s: DbSnapshot, brandId: ID, brandName: string, createdBy: ID, now: string): void {
    for (const t of AGENT_TEMPLATES) {
        const slug = brandId.slice(4);
        const { agent, version } = buildAgentInstance(brandId, brandName, t.key, createdBy, now, { agent: `agt_${slug}_${t.key}`, version: `ivr_${slug}_${t.key}_1` });
        s.agentInstances.push(agent);
        s.instructionVersions.push(version);
    }
}

function versionsOf(db: LocalDatabase, agentId: ID) {
    return db.all('instructionVersions').filter((v) => v.agentInstanceId === agentId);
}

export function localAgents(scope: Scope): AgentsApi {
    const { db } = scope;
    const touch = (id: ID, patch: Partial<AgentInstance>) => structuredClone(db.patch('agentInstances', id, { ...patch, updatedAt: db.nowIso() }));

    return {
        templates() {
            return structuredClone(AGENT_TEMPLATES);
        },

        async list(brandId) {
            const order = AGENT_TEMPLATES.map((t) => t.key);
            return scope.rows('agentInstances', brandId).sort((a, b) => order.indexOf(a.templateKey) - order.indexOf(b.templateKey));
        },

        async get(brandId, id) {
            return scope.row('agentInstances', brandId, id, { label: 'Agent' });
        },

        async provision(brandId, templateKey) {
            scope.require(brandId, 'admin');
            if (!AGENT_TEMPLATES.some((t) => t.key === templateKey)) throw new ValidationError({ templateKey: 'Unknown agent template.' });
            if (db.all('agentInstances').some((a) => a.brandId === brandId && a.templateKey === templateKey)) {
                throw new ValidationError({ templateKey: 'This brand already has that agent.' });
            }
            const { agent, version } = buildAgentInstance(brandId, db.find('brands', brandId)!.name, templateKey, scope.userId, db.nowIso());
            db.insert('instructionVersions', version);
            db.insert('agentInstances', agent);
            scope.audit(brandId, 'agent.provisioned', 'agent_instance', agent.id);
            return structuredClone(agent);
        },

        async update(brandId, id, patch) {
            scope.require(brandId, 'admin');
            const agent = scope.owned('agentInstances', brandId, id, 'Agent');
            const limits = { ...agent.limits, ...patch.limits };
            assertValid({
                displayName: patch.displayName !== undefined && !patch.displayName.trim() && 'Name is required.',
                model: patch.model && !modelOption(patch.model) && 'Unknown model.',
                tools: patch.tools && patch.tools.some((t: ToolKey) => !ALL_TOOLS.includes(t)) && 'Unknown tool.',
                maxOutputTokens: (limits.maxOutputTokens < 64 || limits.maxOutputTokens > 16384 || !Number.isInteger(limits.maxOutputTokens)) && 'Output tokens must be a whole number between 64 and 16,384.',
                maxRunsPerDay: (limits.maxRunsPerDay < 1 || limits.maxRunsPerDay > 10000 || !Number.isInteger(limits.maxRunsPerDay)) && 'Runs per day must be between 1 and 10,000.',
                monthlyBudgetUsd: (limits.monthlyBudgetUsd < 0 || limits.monthlyBudgetUsd > 10000 || Number.isNaN(limits.monthlyBudgetUsd)) && 'Budget must be between $0 and $10,000.',
            });
            const updated = touch(id, {
                ...(patch.displayName !== undefined && { displayName: patch.displayName.trim() }),
                ...(patch.active !== undefined && { active: patch.active }),
                ...(patch.model && { model: { ...patch.model } }),
                ...(patch.tools && { tools: [...new Set(patch.tools)] }),
                limits,
            });
            scope.audit(brandId, 'agent.updated', 'agent_instance', id);
            return updated;
        },

        async instructionVersions(brandId, id) {
            scope.row('agentInstances', brandId, id, { label: 'Agent' });
            return structuredClone(versionsOf(db, id)).sort((a, b) => b.version - a.version);
        },

        async publishInstructions(brandId, id, input) {
            scope.require(brandId, 'admin');
            scope.owned('agentInstances', brandId, id, 'Agent');
            const text = input.instructions.trim();
            assertValid({
                instructions: !text ? 'Instructions cannot be empty.' : text.length > MAX_INSTRUCTIONS && `Instructions are limited to ${MAX_INSTRUCTIONS} characters.`,
                note: !input.note.trim() && 'Describe what changed in this version.',
            });
            const next = Math.max(0, ...versionsOf(db, id).map((v) => v.version)) + 1;
            const version: InstructionVersion = {
                id: newId('ivr'), brandId, agentInstanceId: id, version: next, instructions: text, note: input.note.trim(), createdBy: scope.userId, createdAt: db.nowIso(),
            };
            db.insert('instructionVersions', version);
            touch(id, { activeInstructionVersionId: version.id });
            scope.audit(brandId, 'agent.instructions_published', 'agent_instance', id);
            return structuredClone(version);
        },

        async activateVersion(brandId, id, versionId) {
            scope.require(brandId, 'admin');
            scope.owned('agentInstances', brandId, id, 'Agent');
            if (!versionsOf(db, id).some((v) => v.id === versionId)) throw new NotFoundError('Instruction version');
            const updated = touch(id, { activeInstructionVersionId: versionId });
            scope.audit(brandId, 'agent.instructions_activated', 'agent_instance', id);
            return updated;
        },

        async usage(brandId) {
            return scope.rows('agentInstances', brandId).map((a) => {
                const s = agentSpend(db, a.id);
                return { agentInstanceId: a.id, ...s, budgetRemainingUsd: Math.max(0, Math.round((a.limits.monthlyBudgetUsd - s.costMonthUsd) * 100) / 100) };
            });
        },

        async executions(brandId, filters = {}) {
            return scope
                .rows('executions', brandId)
                .filter((e) =>
                    (!filters.agentInstanceId || e.agentInstanceId === filters.agentInstanceId) &&
                    (!filters.status || e.status === filters.status) &&
                    (!filters.mode || e.mode === filters.mode) &&
                    (!filters.conversationId || e.conversationId === filters.conversationId),
                )
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .slice(0, 500);
        },
    };
}
