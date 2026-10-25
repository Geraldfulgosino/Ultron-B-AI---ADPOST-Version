import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';

describe('chat UI', () => {
    it('starts a direct chat, sends with Enter, shows a labelled simulated reply and execution', async () => {
        const { router, db } = await renderApp('/b/pod/chat', 'priya');
        await screen.findByRole('option', { name: 'Statistics SEO Agent' });
        await userEvent.selectOptions(screen.getByLabelText('New conversation with'), 'agt_pod_statistics_seo');
        await userEvent.click(screen.getByRole('button', { name: /Start chat/ }));
        await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/b\/pod\/chat\/cnv_/));
        const composer = await screen.findByLabelText('Message');
        await userEvent.type(composer, 'Summarise our numbers{Enter}');
        const reply = await screen.findByRole('article', { name: 'Statistics SEO Agent message' });
        expect(within(reply).getByText('Simulated')).toBeInTheDocument();
        expect(within(reply).getByText(/Measurement summary for POD/)).toBeInTheDocument();
        expect(composer).toHaveValue('');
        expect(db.all('executions')).toHaveLength(1);
    });

    it('shows failures with a retry control', async () => {
        await renderApp('/b/pod/chat', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /Start chat/ }));
        await userEvent.type(await screen.findByLabelText('Message'), 'go #simulate-failure{Enter}');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Simulated provider failure');
        expect(within(alert).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    });

    it('applies a task proposal from a chat reply', async () => {
        const { db } = await renderApp('/b/pod/chat', 'priya');
        await screen.findByRole('option', { name: 'Content SEO Agent' });
        await userEvent.selectOptions(screen.getByLabelText('New conversation with'), 'agt_pod_content_seo');
        await userEvent.click(screen.getByRole('button', { name: /Start chat/ }));
        await userEvent.type(await screen.findByLabelText('Message'), 'Draft a brief{Enter}');
        const card = (await screen.findAllByTestId('proposal'))[0]!;
        await userEvent.click(within(card).getByRole('button', { name: 'Create task' }));
        expect(await within(card).findByText('Applied')).toBeInTheDocument();
        expect(db.all('tasks')).toHaveLength(1);
    });

    it('team chat: lead replies and hands off; summary can be generated', async () => {
        const { router } = await renderApp('/b/pod/team', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /^SEO Team/ }));
        await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/b\/pod\/team\/cnv_/));
        expect(await screen.findByRole('button', { name: '@technical-seo' })).toBeInTheDocument();
        await userEvent.type(await screen.findByLabelText('Message'), 'Plan the technical work{Enter}');
        expect(await screen.findByRole('article', { name: 'SEO Manager message' })).toBeInTheDocument();
        expect(await screen.findByRole('article', { name: 'Technical SEO Agent message' })).toBeInTheDocument();
        expect(screen.getAllByText('Handed off').length).toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('button', { name: /Summarize/ }));
        expect(await screen.findByLabelText('Thread summary')).toHaveTextContent(/messages from 1 person/);
    });

    it('viewers can read but get no composer; clients are blocked', async () => {
        await renderApp('/b/pod/chat', 'vic');
        expect(await screen.findByText('Pick a conversation')).toBeInTheDocument();
        const blocked = await renderApp('/b/pod/team', 'casey');
        expect(await within(blocked.container).findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    });
});
