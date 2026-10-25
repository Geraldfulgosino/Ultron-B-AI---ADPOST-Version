import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';
import { as, IDS, testDb } from '@/test/helpers';
import { AccessDeniedError, ValidationError } from '@/data/errors';
import { apiFor } from '@/data/local/backend';

const { pod, dmd } = IDS.brands;

describe('web studio (data)', () => {
    it('runs brief → design → development → review → approval → release', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        let c = await priya.studio.create(pod, { websiteId: 'web_pod_1', title: 'New pricing page', brief: 'Clearer tiers and one CTA' });
        await expect(priya.studio.runDevelopment(pod, c.id)).rejects.toBeInstanceOf(ValidationError);
        c = await priya.studio.runDesign(pod, c.id);
        expect(c).toMatchObject({ stage: 'development' });
        expect(c.designProposal).toContain('Design recommendations for POD');
        c = await priya.studio.runDevelopment(pod, c.id);
        expect(c.stage).toBe('review');
        await expect(priya.studio.requestRelease(pod, c.id)).rejects.toBeInstanceOf(ValidationError);
        for (const i of c.checklist) c = await priya.studio.toggleChecklist(pod, c.id, i.key);
        c = await priya.studio.requestRelease(pod, c.id);
        expect(c.stage).toBe('awaiting_approval');
        await expect(priya.studio.markReleased(pod, c.id)).rejects.toBeInstanceOf(AccessDeniedError); // not approved yet
        await expect(priya.work.decideApproval(pod, c.approvalId!, 'approved', '')).rejects.toBeInstanceOf(AccessDeniedError); // self-approval
        await as('alex', db).api.work.decideApproval(pod, c.approvalId!, 'approved', 'Ship it');
        c = await priya.studio.markReleased(pod, c.id);
        expect(c.stage).toBe('released');
        expect(db.all('executions').filter((e) => e.agentInstanceId.startsWith('agt_pod_web'))).toHaveLength(2);
    });

    it('is brand-isolated and role-gated', async () => {
        const db = testDb();
        const c = await as('priya', db).api.studio.create(pod, { websiteId: 'web_pod_1', title: 'x', brief: 'y' });
        await expect(as('dana', db).api.studio.get(pod, c.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('dana', db).api.studio.create(dmd, { websiteId: 'web_pod_1', title: 'x', brief: 'y' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('vic', db).api.studio.runDesign(pod, c.id)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('casey', db).api.studio.list(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('cancelling cancels a pending release approval', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        let c = await api.studio.create(pod, { websiteId: 'web_pod_1', title: 'x', brief: 'y' });
        c = await api.studio.runDesign(pod, c.id);
        c = await api.studio.runDevelopment(pod, c.id);
        for (const i of c.checklist) c = await api.studio.toggleChecklist(pod, c.id, i.key);
        c = await api.studio.requestRelease(pod, c.id);
        await api.studio.cancel(pod, c.id);
        expect(db.find('approvals', c.approvalId!)!.status).toBe('cancelled');
    });
});

describe('web studio (UI)', () => {
    it('creates a change and drafts design then implementation', async () => {
        const { router } = await renderApp('/b/pod/studio', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /New change/ }));
        const d = screen.getByRole('dialog', { name: 'New website change' });
        await userEvent.type(within(d).getByLabelText(/^Title/), 'Hero refresh');
        await userEvent.type(within(d).getByLabelText(/^Brief/), 'Make the hero CTA obvious');
        await userEvent.click(within(d).getByRole('button', { name: 'Create' }));
        await waitFor(() => expect(router.state.location.pathname).toMatch(/\/b\/pod\/studio\/wch_/));
        await userEvent.click(await screen.findByRole('button', { name: 'Draft design' }));
        expect(await screen.findByText(/Design recommendations for POD/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Draft implementation' }));
        expect(await screen.findByText(/Implementation proposal for POD/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Request release approval' })).toBeDisabled();
        expect(within(screen.getByRole('list', { name: 'Pipeline' })).getByText('Review').closest('li')).toHaveAttribute('aria-current', 'step');
    });

    it('admin can mark released after another admin approves', async () => {
        const { db } = await renderApp('/b/pod/studio', 'priya');
        const api = apiFor(db, IDS.users.priya);
        let c = await api.studio.create(pod, { websiteId: 'web_pod_1', title: 'Release me', brief: 'b' });
        c = await api.studio.runDesign(pod, c.id);
        c = await api.studio.runDevelopment(pod, c.id);
        for (const i of c.checklist) c = await api.studio.toggleChecklist(pod, c.id, i.key);
        c = await api.studio.requestRelease(pod, c.id);
        await apiFor(db, IDS.users.alex).work.decideApproval(pod, c.approvalId!, 'approved', 'ok');
        await userEvent.click(await screen.findByRole('link', { name: /Release me/ }));
        await userEvent.click(await screen.findByRole('button', { name: 'Mark as released' }));
        expect(await screen.findByText(/Local mode records the release only/)).toBeInTheDocument();
    });
});
