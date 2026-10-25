import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';
import { safeNext } from '@/pages/auth/AuthPages';

describe('auth + routing', () => {
    it('redirects signed-out users to login and back after sign-in', async () => {
        const { router } = await renderApp('/b/pod/members');
        await screen.findByRole('heading', { name: 'Sign in' });
        expect(router.state.location.search).toBe('?next=%2Fb%2Fpod%2Fmembers');

        await userEvent.type(screen.getByLabelText(/Email/), 'priya@pod.example.test');
        await userEvent.type(screen.getByLabelText(/Password/), 'wrong-password');
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('These credentials do not match our records.');

        await userEvent.clear(screen.getByLabelText(/Password/));
        await userEvent.type(screen.getByLabelText(/Password/), 'adpost-dev');
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/b/pod/members');
    });

    it('rejects open redirects in ?next', () => {
        expect(safeNext('//evil.example')).toBe('/brands');
        expect(safeNext('https://evil.example')).toBe('/brands');
        expect(safeNext('/b/pod/dashboard')).toBe('/b/pod/dashboard');
    });

    it('shows 403 for a brand the user does not belong to', async () => {
        await renderApp('/b/dmd/dashboard', 'priya');
        expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    });

    it('single-brand users skip the picker; multi-brand users choose', async () => {
        const one = await renderApp('/brands', 'priya');
        await waitFor(() => expect(one.router.state.location.pathname).toBe('/b/pod/dashboard'));
        one.unmount();

        await renderApp('/brands', 'alex');
        const list = await screen.findByRole('list');
        expect(within(list).getAllByRole('link')).toHaveLength(5);
    });

    it('client users see a reduced nav and cannot open staff pages by URL', async () => {
        await renderApp('/b/pod/members', 'casey');
        expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    });

    it('client nav excludes AI and admin sections', async () => {
        await renderApp('/b/pod/dashboard', 'casey');
        const nav = await screen.findAllByRole('navigation', { name: 'Main' });
        const labels = within(nav[0]!).getAllByRole('link').map((a) => a.textContent);
        expect(labels).toContain('Reports');
        expect(labels).not.toContain('Agents');
        expect(labels).not.toContain('Members');
    });

    it('owner can invite a member from the members page', async () => {
        await renderApp('/b/pod/members', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /Invite member/ }));
        const dialog = screen.getByRole('dialog', { name: 'Invite member' });
        await userEvent.type(within(dialog).getByLabelText(/Email/), 'newhire@example.test');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
        expect(await within(dialog).findByText(/Invitation created for newhire@example.test/)).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(await screen.findByText('newhire@example.test')).toBeInTheDocument();
    });
});

describe('accessibility landmarks', () => {
    it('brand pages have a skip link targeting the main region', async () => {
        await renderApp('/b/pod/dashboard', 'priya');
        const skip = await screen.findByRole('link', { name: 'Skip to content' });
        expect(skip).toHaveAttribute('href', '#main');
        expect(document.getElementById('main')?.tagName).toBe('MAIN');
    });
});
