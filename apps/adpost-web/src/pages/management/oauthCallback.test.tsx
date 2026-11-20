import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/routes';
import { BackendProvider } from '@/app/backend';
import type { Backend, BrandApi } from '@/data/contracts';
import { AuthError } from '@/data/errors';
import { LocalBackend } from '@/data/local/backend';
import { DEV_PASSWORD } from '@/data/local/fixtures';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { renderApp } from '@/test/renderApp';
import { testDb } from '@/test/helpers';

const CALLBACK = '/oauth/google/callback?state=a1b2c3&code=4/one-time-code&scope=analytics.readonly';

/** A signed-in LocalBackend whose Google callback is answered by `complete`. */
async function withCallback(complete: BrandApi['integrations']['completeGoogleAuthorization']) {
    const local = new LocalBackend(testDb());
    await local.auth.signIn('priya@pod.example.test', DEV_PASSWORD);
    const calls: unknown[] = [];
    const backend: Backend = {
        auth: local.auth,
        subscribe: (l) => local.subscribe(l),
        api: () => {
            const api = local.api();
            return { ...api, integrations: { ...api.integrations, completeGoogleAuthorization: (q) => (calls.push(q), complete(q)) } };
        },
    };
    const router = createMemoryRouter(routes, { initialEntries: [CALLBACK] });
    render(
        <ThemeProvider>
            <BackendProvider backend={backend}>
                <RouterProvider router={router} />
            </BackendProvider>
        </ThemeProvider>,
    );
    return { router, calls };
}

describe('Google OAuth callback page', () => {
    it('signed out: sign-in first, keeping the callback as the return URL', async () => {
        const { router } = await renderApp(CALLBACK);
        await screen.findByRole('heading', { name: 'Sign in' });
        expect(router.state.location.search).toContain('next=%2Foauth%2Fgoogle%2Fcallback');
    });

    it('mock mode says Google sign-in needs live mode', async () => {
        await renderApp(CALLBACK, 'priya');
        expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in is not available in local mode');
    });

    it('forwards state, code and error once, then continues at the website without the code in the URL', async () => {
        const { router, calls } = await withCallback(async () => ({ websiteId: 'web_1', provider: 'google_analytics', returnPath: '/a/adpost/c/pod/websites/web_1' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/adpost/c/pod/websites/web_1'));
        expect(router.state.location.search).toBe('?connected=google_analytics');
        expect(calls).toEqual([{ state: 'a1b2c3', code: '4/one-time-code', error: null }]);
        expect(JSON.stringify(router.state.location)).not.toContain('one-time-code');
    });

    it('a refused callback shows the reason and drops the code from the URL', async () => {
        const { router } = await withCallback(async () => {
            throw new AuthError('Unknown OAuth state. Start the connection again.');
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('Unknown OAuth state');
        await waitFor(() => expect(router.state.location.search).toBe(''));
        expect(screen.getByRole('link', { name: 'Back to my workspace' })).toHaveAttribute('href', '/home');
    });
});
