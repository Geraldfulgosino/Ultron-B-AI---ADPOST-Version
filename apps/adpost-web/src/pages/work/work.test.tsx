import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';
import { apiFor } from '@/data/local/backend';
import { IDS } from '@/test/helpers';

describe('work UI', () => {
    it('creates a project and a task, then moves it across the board', async () => {
        const { db } = await renderApp('/b/pod/projects', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /New project/ }));
        await userEvent.type(screen.getByLabelText(/^Name/), 'Q4 SEO');
        await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
        await userEvent.click(await screen.findByRole('button', { name: /New task/ }));
        const dialog = screen.getByRole('dialog', { name: 'New task' });
        await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Rewrite pricing titles');
        await userEvent.selectOptions(within(dialog).getByLabelText('Assignee'), 'agent:agt_pod_content_seo');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
        const todo = await screen.findByRole('region', { name: /To do/ });
        expect(await within(todo).findByText('Rewrite pricing titles')).toBeInTheDocument();
        expect(within(todo).getByText('Content SEO Agent')).toBeInTheDocument();
        await userEvent.selectOptions(screen.getByLabelText('Status of Rewrite pricing titles'), 'done');
        await waitFor(() => expect(within(screen.getByRole('region', { name: /Done/ })).getByText('Rewrite pricing titles')).toBeInTheDocument());
        expect(db.all('tasks')[0]!.status).toBe('done');
    });

    it('admin approves an agent request; requester cannot decide own request', async () => {
        const { db } = await renderApp('/b/pod/approvals', 'priya');
        const morgan = apiFor(db, IDS.users.morgan);
        await morgan.work.requestApproval(IDS.brands.pod, { kind: 'publish_content', title: 'Publish FAQ', summary: 'Ship the FAQ page' });
        const own = await apiFor(db, IDS.users.priya).work.requestApproval(IDS.brands.pod, { kind: 'deploy_change', title: 'My deploy', summary: 'Mine' });
        const list = await screen.findByRole('list', { name: 'Approval requests' });
        const ownCard = within(list).getByText('My deploy').closest('li')!;
        expect(within(ownCard).queryByRole('button', { name: 'Approve' })).toBeNull();
        const card = within(list).getByText('Publish FAQ').closest('li')!;
        await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));
        await userEvent.click(within(screen.getByRole('dialog', { name: 'Approve request' })).getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(within(screen.getByRole('list', { name: 'Approval requests' })).queryByText('Publish FAQ')).toBeNull());
        expect(db.all('approvals').find((a) => a.id !== own.id)!.status).toBe('approved');
    });

    it('reject requires a reason', async () => {
        const { db } = await renderApp('/b/pod/approvals', 'priya');
        await apiFor(db, IDS.users.morgan).work.requestApproval(IDS.brands.pod, { kind: 'run_webhook', title: 'Fire hook', summary: 'x' });
        await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
        const d = screen.getByRole('dialog', { name: 'Reject request' });
        await userEvent.click(within(d).getByRole('button', { name: 'Reject' }));
        expect(await within(d).findByText('Explain why the request is rejected.')).toBeInTheDocument();
    });
});
