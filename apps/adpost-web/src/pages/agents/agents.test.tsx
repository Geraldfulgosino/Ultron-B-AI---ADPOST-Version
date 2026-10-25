import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';

describe('agents UI', () => {
    it('registry lists six agents; admin deactivates one', async () => {
        const { db } = await renderApp('/b/pod/agents', 'priya');
        expect(await screen.findByRole('link', { name: 'SEO Manager' })).toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: 'Configure' })).toHaveLength(6);
        await userEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]!);
        expect(await screen.findByText('Inactive')).toBeInTheDocument();
        expect(db.find('agentInstances', 'agt_pod_seo_manager')!.active).toBe(false);
    });

    it('publishes a new instruction version from the detail page', async () => {
        await renderApp('/b/pod/agents/agt_pod_content_seo', 'priya');
        const box = await screen.findByLabelText('System instructions');
        await userEvent.clear(box);
        await userEvent.type(box, 'Write in British English.');
        await userEvent.type(screen.getByLabelText(/Change note/), 'Locale');
        await userEvent.click(screen.getByRole('button', { name: 'Publish new version' }));
        expect(await screen.findByText('v2 active')).toBeInTheDocument();
        const history = screen.getByText('Version history').parentElement!;
        expect(within(history).getByText('Locale')).toBeInTheDocument();
    });

    it('warns when a live model is selected', async () => {
        await renderApp('/b/pod/agents/agt_pod_content_seo', 'priya');
        await userEvent.selectOptions(await screen.findByLabelText('Model'), '1');
        expect(screen.getByText(/Live models only run through the server-side/)).toBeInTheDocument();
    });

    it('managers see configuration read-only', async () => {
        await renderApp('/b/pod/agents/agt_pod_content_seo', 'morgan');
        expect(await screen.findByLabelText(/Display name/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save configuration' })).toBeNull();
    });

    it('executions page shows empty state before any runs', async () => {
        await renderApp('/b/pod/executions', 'priya');
        expect(await screen.findByText('No executions yet')).toBeInTheDocument();
    });
});
