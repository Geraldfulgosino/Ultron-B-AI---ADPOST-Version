import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';

describe('knowledge UI', () => {
    it('lists seeded docs, tests retrieval, and creates a document', async () => {
        await renderApp('/b/pod/knowledge', 'priya');
        const list = await screen.findByRole('list', { name: 'Documents' });
        expect(within(list).getByText('POD brand voice guide')).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Ask the knowledge base'), 'meta description length');
        expect(await screen.findByRole('list', { name: 'Retrieved passages' })).toHaveTextContent('POD SEO policy');
        await userEvent.click(screen.getByRole('button', { name: /New document/ }));
        const d = screen.getByRole('dialog', { name: 'New document' });
        await userEvent.type(within(d).getByLabelText(/^Title/), 'Shipping FAQ');
        await userEvent.type(within(d).getByLabelText(/^Content/), 'Free shipping over $50.');
        await userEvent.click(within(d).getByRole('button', { name: 'Save' }));
        expect(await within(screen.getByRole('list', { name: 'Documents' })).findByText('Shipping FAQ')).toBeInTheDocument();
    });

    it('viewers open documents read-only', async () => {
        await renderApp('/b/pod/knowledge', 'vic');
        await userEvent.click(await screen.findByRole('button', { name: 'POD SEO policy' }));
        expect(within(screen.getByRole('dialog')).getByLabelText(/^Title/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: /New document/ })).toBeNull();
    });
});
