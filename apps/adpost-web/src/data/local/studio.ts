import type { ChecklistItem, ID, WebChange, WebChangeStage } from '@/domain/types';
import type { StudioApi } from '../contracts';
import { AccessDeniedError, assertValid, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import type { Scope } from './scope';
import { runAgent } from './engine';
import { assertFeature } from './entitlements';

export const RELEASE_CHECKLIST: Array<Omit<ChecklistItem, 'done'>> = [
    { key: 'design_reviewed', label: 'Design reviewed by a person' },
    { key: 'accessibility', label: 'Accessibility checked (contrast, focus states, alt text)' },
    { key: 'responsive', label: 'Tested on mobile and desktop' },
    { key: 'seo', label: 'SEO metadata and structured data validated' },
    { key: 'rollback', label: 'Rollback plan written' },
];

const OPEN: WebChangeStage[] = ['brief', 'design', 'development', 'review'];
const stageText = (s: WebChangeStage) => s.replace('_', ' ');

export function localStudio(scope: Scope): StudioApi {
    const { db } = scope;
    const touch = (id: ID, patch: Partial<WebChange>) => structuredClone(db.patch('webChanges', id, { ...patch, updatedAt: db.nowIso() }));
    const agentFor = (brandId: ID, key: 'web_design' | 'web_development') => {
        const a = db.all('agentInstances').find((x) => x.brandId === brandId && x.templateKey === key);
        if (!a) throw new ValidationError({ agent: `This brand has no ${key === 'web_design' ? 'Web Design' : 'Web Development'} agent.` });
        return a;
    };
    const site = (c: WebChange) => db.find('websites', c.websiteId);

    async function runStep(brandId: ID, id: ID, step: 'design' | 'development'): Promise<WebChange> {
        scope.require(brandId, 'write');
        const c = scope.owned('webChanges', brandId, id, 'Change');
        if (!OPEN.includes(c.stage)) throw new ValidationError({ stage: `This change is ${stageText(c.stage)}.` });
        if (step === 'development' && !c.designProposal) throw new ValidationError({ stage: 'Run the design step first.' });
        const agent = agentFor(brandId, step === 'design' ? 'web_design' : 'web_development');
        const w = site(c);
        const prompt =
            step === 'design'
                ? `Design brief for ${w?.domain ?? 'the website'} (${w?.primaryConversion ?? 'primary conversion'}): ${c.title}\n${c.brief}\nPropose the layout and UX changes.`
                : `Implement this design for ${w?.domain ?? 'the website'} as a reviewable proposal: ${c.title}\nBrief: ${c.brief}\nDesign proposal:\n${c.designProposal}`;
        const run = await runAgent(scope, brandId, { agentInstanceId: agent.id, conversationId: null, triggerMessageId: null, messages: [{ role: 'user', name: 'Web Studio', content: prompt }] });
        if (!run.response) throw new ValidationError({ agent: run.execution.error ?? 'The agent did not respond.' });
        scope.audit(brandId, `web_change.${step}_drafted`, 'web_change', id);
        return step === 'design'
            ? touch(id, { designProposal: run.response.text, designExecutionId: run.execution.id, stage: 'development' })
            : touch(id, { devProposal: run.response.text, devExecutionId: run.execution.id, stage: 'review' });
    }

    return {
        async list(brandId, f = {}) {
            return scope
                .rows('webChanges', brandId)
                .filter((c) => (!f.stage || c.stage === f.stage) && (!f.websiteId || c.websiteId === f.websiteId))
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },

        async get(brandId, id) {
            return scope.row('webChanges', brandId, id, { label: 'Change' });
        },

        async create(brandId, input) {
            scope.require(brandId, 'write');
            assertFeature(db, brandId, 'web_studio');
            assertValid({
                websiteId: !db.all('websites').some((w) => w.id === input.websiteId && w.brandId === brandId) && 'Choose a website from this brand.',
                title: !input.title?.trim() && 'Title is required.',
                brief: (!input.brief?.trim() && 'Describe the change.') || (input.brief.length > 4000 && 'Briefs are limited to 4,000 characters.'),
            });
            const c: WebChange = {
                id: newId('wch'), brandId, websiteId: input.websiteId, title: input.title.trim(), brief: input.brief.trim(), stage: 'design',
                designProposal: null, designExecutionId: null, devProposal: null, devExecutionId: null,
                checklist: RELEASE_CHECKLIST.map((i) => ({ ...i, done: false })), approvalId: null, createdBy: scope.userId, releasedAt: null,
                createdAt: db.nowIso(), updatedAt: db.nowIso(),
            };
            db.insert('webChanges', c);
            scope.audit(brandId, 'web_change.created', 'web_change', c.id);
            return structuredClone(c);
        },

        runDesign: (brandId, id) => runStep(brandId, id, 'design'),
        runDevelopment: (brandId, id) => runStep(brandId, id, 'development'),

        async toggleChecklist(brandId, id, key) {
            scope.require(brandId, 'write');
            const c = scope.owned('webChanges', brandId, id, 'Change');
            if (c.stage !== 'review') throw new ValidationError({ stage: 'The checklist is completed during review.' });
            if (!c.checklist.some((i) => i.key === key)) throw new ValidationError({ key: 'Unknown checklist item.' });
            return touch(id, { checklist: c.checklist.map((i) => (i.key === key ? { ...i, done: !i.done } : i)) });
        },

        async requestRelease(brandId, id) {
            scope.require(brandId, 'write');
            const c = scope.owned('webChanges', brandId, id, 'Change');
            if (c.stage !== 'review') throw new ValidationError({ stage: 'Only changes in review can be sent for release approval.' });
            const missing = c.checklist.filter((i) => !i.done);
            if (missing.length) throw new ValidationError({ checklist: `Complete the checklist first: ${missing.map((i) => i.label).join('; ')}.` });
            const approval = {
                id: newId('apr'), brandId, kind: 'deploy_change' as const, title: `Release: ${c.title}`,
                summary: `Deploy the reviewed change to ${site(c)?.domain ?? 'the website'}. The development proposal and completed release checklist are attached in Web Studio.`,
                payload: { webChangeId: c.id }, requestedBy: { type: 'user' as const, userId: scope.userId }, status: 'pending' as const,
                decidedBy: null, decidedAt: null, decisionNote: null, taskId: null, executionId: c.devExecutionId, createdAt: db.nowIso(),
            };
            db.insert('approvals', approval);
            scope.audit(brandId, 'approval.requested', 'approval_request', approval.id);
            return touch(id, { stage: 'awaiting_approval', approvalId: approval.id });
        },

        async markReleased(brandId, id) {
            scope.require(brandId, 'admin');
            const c = scope.owned('webChanges', brandId, id, 'Change');
            const approval = c.approvalId ? db.find('approvals', c.approvalId) : undefined;
            if (c.stage !== 'awaiting_approval' || !approval) throw new ValidationError({ stage: 'Request release approval first.' });
            if (approval.status !== 'approved') throw new AccessDeniedError(`The release approval is ${approval.status}. It must be approved before release.`);
            scope.audit(brandId, 'web_change.released', 'web_change', id);
            return touch(id, { stage: 'released', releasedAt: db.nowIso() });
        },

        async cancel(brandId, id) {
            scope.require(brandId, 'write');
            const c = scope.owned('webChanges', brandId, id, 'Change');
            if (c.stage === 'released' || c.stage === 'cancelled') throw new ValidationError({ stage: `This change is already ${c.stage}.` });
            if (c.approvalId) {
                const a = db.find('approvals', c.approvalId);
                if (a?.status === 'pending') db.patch('approvals', a.id, { status: 'cancelled', decidedBy: scope.userId, decidedAt: db.nowIso() });
            }
            return touch(id, { stage: 'cancelled' });
        },
    };
}
