import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSampleApp } from '@/test/renderApp';

const VCA = 'admin@vca.example.test';
const tileValue = (label: string) => screen.getByText(label).parentElement!.querySelector('p:nth-of-type(2)')!.getAttribute('title') ?? screen.getByText(label).parentElement!.textContent;

describe('VCA demo workspace (sample dataset)', () => {
    it('dashboard is labelled simulated, recalculates on range change and is replaced on client switch', async () => {
        const { router } = await renderSampleApp('/a/vca/c/cms/dashboard', VCA);
        expect(await screen.findByText(/Demo dataset: the analytics, search and integration data/)).toBeInTheDocument();
        expect(await screen.findByText('Sessions (GA4)')).toBeInTheDocument();
        const cms28 = tileValue('Sessions (GA4)');
        await userEvent.click(screen.getByRole('button', { name: '7d' }));
        await waitFor(() => expect(tileValue('Sessions (GA4)')).not.toBe(cms28));
        expect(screen.getAllByText(/vs previous 7 days/).length).toBeGreaterThan(0);
        expect(screen.getByRole('list', { name: 'Sessions by channel (GA4)' })).toBeInTheDocument();

        await router.navigate('/a/vca/c/lipsky/dashboard');
        await waitFor(() => expect(screen.getAllByText(/vs previous 28 days/).length).toBeGreaterThan(0));
        expect(tileValue('Sessions (GA4)')).not.toBe(cms28);
        // Range state was reset by the client switch (no stale CMS filter).
        expect(screen.getByRole('button', { name: '28d' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('integrations show simulated connections with history; intelligence shows the explained score', async () => {
        const { router } = await renderSampleApp('/a/vca/c/loop19/integrations', VCA);
        expect((await screen.findAllByText('Simulated')).length).toBeGreaterThan(1);
        expect(screen.getAllByRole('button', { name: 'Sync now (simulated)' }).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/staging property has no data stream yet/).length).toBeGreaterThan(0);
        await router.navigate('/a/vca/c/loop19/seo/intelligence');
        expect(await screen.findByText(/Site health:/)).toBeInTheDocument();
        expect(screen.getByText(/How it is calculated:/)).toBeInTheDocument();
        expect(screen.getByRole('list', { name: /Competitor comparison \(simulated\)/ })).toBeInTheDocument();
    });

    it('reports show the demo notice, technical findings and tasks', async () => {
        await renderSampleApp('/a/vca/c/hamptons/reports', VCA);
        expect(await screen.findByText(/exports carry a DEMO \/ SYNTHETIC DATA notice/)).toBeInTheDocument();
        expect(await screen.findByText('Technical findings')).toBeInTheDocument();
        expect(screen.getByText('Tasks and action items')).toBeInTheDocument();
    });

    it('agent chat lists the simulated demo conversations with Simulated replies', async () => {
        const { router } = await renderSampleApp('/a/vca/c/cms/chat', VCA);
        await router.navigate('/a/vca/c/cms/chat/vd_cms_cnv_1');
        const msg = await screen.findByText(/Organic clicks declined/);
        expect(msg).toBeInTheDocument();
        expect(screen.getAllByText('Simulated').length).toBeGreaterThan(0);
        await router.navigate('/a/vca/c/cms/team/vd_cms_cnv_7');
        expect(await screen.findByText(/I am delegating the analysis/)).toBeInTheDocument();
        void within;
    });
});
