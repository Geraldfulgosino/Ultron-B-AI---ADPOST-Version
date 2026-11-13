import { screen, within } from '@testing-library/react';
import { renderApp, renderSampleApp } from '@/test/renderApp';

describe('Integrations page (v7, mock mode is honest)', () => {
    it('demo websites: marked, no Connect buttons, live connectors disabled', async () => {
        await renderSampleApp('/a/vca/c/lipsky/integrations', 'admin@vca.example.test');
        const cards = (await screen.findAllByText('Demo record')).map((b) => b.closest('div.bg-surface') as HTMLElement);
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
            expect(within(card).queryByRole('button', { name: 'Connect' })).toBeNull();
            expect(within(card).getAllByText('Disabled (demo)')).toHaveLength(2);
            expect(within(card).getByText(/Live integrations and crawls are disabled/)).toBeInTheDocument();
        }
        expect(screen.getByText(/no request is sent to WordPress, Google or any website/)).toBeInTheDocument();
    });

    it('live websites show WordPress and crawl rows as staging-only, never as connected; mock sync is labelled simulated', async () => {
        await renderApp('/b/pod/integrations', 'priya');
        const card = (await screen.findAllByText('POD Store'))[0]!.closest('div.bg-surface') as HTMLElement;
        expect(within(card).getByText('WordPress')).toBeInTheDocument();
        expect(within(card).getByText('Technical SEO crawl')).toBeInTheDocument();
        expect(within(card).getAllByText('Not connected · staging mode only')).toHaveLength(2);
        expect(within(card).getAllByRole('button', { name: 'Sync (simulated)' }).length).toBeGreaterThan(0);
        expect(within(card).queryByRole('button', { name: 'Sync now' })).toBeNull();
    });
});
