import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppShell } from './AppShell';
import { NAV_GROUPS, activeNavPath } from '@/app/navigation';
import { ThemeProvider } from '@/theme/ThemeProvider';

describe('activeNavPath', () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);

    it('prefers the longest matching path', () => {
        expect(activeNavPath('/seo/insights', items)).toBe('seo/insights');
        expect(activeNavPath('/seo/insights/abc', items)).toBe('seo/insights');
        expect(activeNavPath('/seo', items)).toBe('seo');
    });

    it('returns null when nothing matches', () => {
        expect(activeNavPath('/nope', items)).toBeNull();
        expect(activeNavPath('', items)).toBeNull();
    });
});

describe('AppShell', () => {
    const brands = [
        { slug: 'adpost', name: 'ADPOST' },
        { slug: 'pod', name: 'POD' },
    ];

    function renderShell(path: string, onSwitchBrand = vi.fn()) {
        render(
            <ThemeProvider>
            <MemoryRouter initialEntries={[path]}>
                <AppShell
                    brand={brands[0]!}
                    brands={brands}
                    roleLabel="Owner"
                    navGroups={NAV_GROUPS}
                    user={{ name: 'Dev User', email: 'dev@example.test' }}
                    onSignOut={vi.fn()}
                    onSwitchBrand={onSwitchBrand}
                >
                    <p>page body</p>
                </AppShell>
            </MemoryRouter>
            </ThemeProvider>,
        );
        return { onSwitchBrand };
    }

    it('marks the active nav item and scopes links to the brand', () => {
        renderShell('/b/adpost/seo/insights');
        const active = screen.getAllByRole('link', { current: 'page' });
        expect(active.map((a) => a.textContent)).toEqual(['SEO Insights']);
        expect(screen.getAllByRole('link', { name: 'Dashboard' })[0]).toHaveAttribute('href', '/b/adpost/dashboard');
        expect(screen.getByText('page body')).toBeInTheDocument();
    });

    it('switches brand through the selector', async () => {
        const { onSwitchBrand } = renderShell('/b/adpost/dashboard');
        await userEvent.selectOptions(screen.getAllByLabelText('Brand')[0]!, 'pod');
        expect(onSwitchBrand).toHaveBeenCalledWith('pod');
    });

    it('puts a keyboard-operable dark-mode switch directly above the user profile', async () => {
        renderShell('/b/adpost/dashboard');
        const toggle = screen.getAllByRole('switch', { name: 'Dark mode' })[0]!;
        const signOut = screen.getAllByRole('button', { name: 'Sign out' })[0]!;
        const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
        // nav → theme switch → profile, in document (and tab) order.
        expect(nav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(toggle.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(toggle).toHaveAttribute('aria-checked', 'false');

        toggle.focus();
        await userEvent.keyboard(' ');
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement.dataset.theme).toBe('dark');
        await userEvent.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(document.documentElement.dataset.theme).toBe('light');
    });
});
