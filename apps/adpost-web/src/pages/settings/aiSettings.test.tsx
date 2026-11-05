import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';

describe('AI provider settings UI', () => {
    it('brand admins see connections with honest statuses but cannot add; agency admins can', async () => {
        await renderApp('/b/pod/settings/ai-providers', 'priya');
        const table = await screen.findByRole('table', { name: 'AI provider connections' });
        expect(within(table).getByText('Company Anthropic API')).toBeInTheDocument();
        expect(within(table).getAllByText('Configured (not verified)')).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /Add connection/ })).toBeNull();
        expect(screen.getByText(/subscriptions do not provide API access/)).toBeInTheDocument();
    });

    it('managers and viewers are refused; the nav shows AI Providers only to admins', async () => {
        await renderApp('/b/pod/settings/ai-providers', 'morgan');
        expect(await screen.findByText('Access denied')).toBeInTheDocument();
        const { unmount } = await renderApp('/b/pod/dashboard', 'vic');
        expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'AI Providers' })).toBeNull();
        unmount();
    });

    it('adding a connection rejects a pasted key and saves only a slot name; local tests send nothing', async () => {
        const { db } = await renderApp('/b/pod/settings/ai-providers/new', 'alex');
        await userEvent.selectOptions(await screen.findByLabelText(/^Provider/), 'openai');
        await userEvent.type(screen.getByLabelText(/Connection display name/), 'Company OpenAI API');
        const slot = screen.getByLabelText('Server secret slot name');
        await userEvent.clear(slot);
        await userEvent.type(slot, 'sk-proj-abcdefghijklmnop');
        await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
        expect(await screen.findByText(/Never paste an API key here/)).toBeInTheDocument();
        expect(db.all('aiConnections').some((c) => c.displayName === 'Company OpenAI API')).toBe(false);

        await userEvent.clear(slot);
        await userEvent.type(slot, 'OPENAI_API_KEY');
        await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
        expect(await screen.findByRole('heading', { name: 'Company OpenAI API' })).toBeInTheDocument();
        expect(screen.getByText(/Saved but not verified/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
        expect((await screen.findAllByText(/Nothing was sent/)).length).toBeGreaterThan(0);
        const saved = db.all('aiConnections').find((c) => c.displayName === 'Company OpenAI API')!;
        expect(saved).toMatchObject({ credentialReference: 'OPENAI_API_KEY', status: 'configured' });
        expect(JSON.stringify(db.snapshot())).not.toContain('sk-proj-abcdefghijklmnop');
    });

    it('agent routing: a brand admin switches an agent to the simulator', async () => {
        const { db } = await renderApp('/b/pod/settings/ai-routing', 'priya');
        const table = await screen.findByRole('table', { name: 'Agent model assignments' });
        const row = within(table).getByRole('link', { name: 'SEO Manager' }).closest('tr')!;
        await userEvent.click(within(row).getByRole('button', { name: 'Assign' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.selectOptions(within(dialog).getByLabelText(/Provider connection/), 'aic_simulator');
        expect(within(dialog).getByLabelText(/Model id/)).toHaveValue('sim-deterministic-1');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Save assignment' }));
        expect(await within(table).findByText('Simulator (offline)')).toBeInTheDocument();
        expect(db.all('aiAssignments')).toEqual([expect.objectContaining({ agentInstanceId: 'agt_pod_seo_manager', connectionId: 'aic_simulator' })]);
        // The organization policy is read-only for brand admins.
        expect(screen.getByText('Only agency administrators change organization policy.')).toBeInTheDocument();
    });

    it('chat shows the provider/model route and the model that produced each reply', async () => {
        const { backend, router } = await renderApp('/a/adpost/c/pod/dashboard', 'priya');
        const api = backend.api();
        await api.ai.assign('brd_pod', 'agt_pod_seo_manager', { connectionId: 'aic_simulator', modelId: 'sim-deterministic-1', fallbackPolicy: 'disabled' });
        const conv = await api.chat.createDirect('brd_pod', 'agt_pod_seo_manager');
        await api.chat.send('brd_pod', conv.id, { body: 'What is good for my website?' });
        await router.navigate(`/a/adpost/c/pod/chat/${conv.id}`);
        const indicator = await screen.findByRole('list', { name: 'AI models in this conversation' });
        expect(await within(indicator).findByText((_t, el) => el?.tagName === 'LI' && /SEO Manager:\s*Simulator \(offline\) · sim-deterministic-1/.test(el.textContent ?? ''))).toBeInTheDocument();
        expect(await screen.findByText((_t, el) => el?.tagName === 'SPAN' && /^Simulated \(offline\) · sim-deterministic-1 · \d+ tokens$/.test(el.textContent ?? ''))).toBeInTheDocument();
    });

    it('usage page shows totals and labels cost as unknown without verified prices', async () => {
        await renderApp('/b/pod/settings/ai-usage', 'priya');
        expect(await screen.findByText('Requests')).toBeInTheDocument();
        expect(screen.getByText(/safeguards, not invoices/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'By provider' })).toBeInTheDocument();
    });

    it('agent detail shows its AI model section', async () => {
        await renderApp('/b/pod/agents/agt_pod_seo_manager', 'priya');
        expect(await screen.findByRole('heading', { name: 'AI model' })).toBeInTheDocument();
        expect(screen.getByText(/No AI routing assignment/)).toBeInTheDocument();
    });
});
