/**
 * Phase 17E authentication UI: sign-in notices, registration with email confirmation, password
 * reset request and completion, session expiry and sign-out. A scripted backend stands in for
 * Supabase Auth where local mode has no equivalent (recovery sessions, confirmation emails).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/routes';
import { BackendProvider } from '@/app/backend';
import type { AuthApi, Backend, Session } from '@/data/contracts';
import { AuthError, PendingConfirmationError } from '@/data/errors';
import { LocalBackend } from '@/data/local/backend';
import { DEV_PASSWORD, FIXTURE_IDS } from '@/data/local/fixtures';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { renderApp } from '@/test/renderApp';
import { testDb } from '@/test/helpers';

/** LocalBackend with overridable auth methods, a recovery flag and the ability to emit session changes. */
function scripted(overrides: Partial<AuthApi> = {}) {
    const local = new LocalBackend(testDb());
    const listeners = new Set<(s: Session | null) => void>();
    let recovery = false;
    const auth: AuthApi = {
        ...local.auth,
        inRecovery: () => recovery,
        onSessionChange: (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        ...overrides,
    };
    const backend: Backend = { auth, api: () => local.api(), subscribe: (l) => local.subscribe(l) };
    return {
        local,
        backend,
        setRecovery: (v: boolean) => (recovery = v),
        emit: (s: Session | null) => act(() => listeners.forEach((l) => l(s))),
    };
}

function renderWith(backend: Backend, path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
        <ThemeProvider>
            <BackendProvider backend={backend}>
                <RouterProvider router={router} />
            </BackendProvider>
        </ThemeProvider>,
    );
    return router;
}

const PRIYA = 'priya@pod.example.test';

describe('sign-in page', () => {
    it('shows a fixed message for an expired confirmation link and never the raw description', async () => {
        await renderApp('/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
        expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid or has expired. Request a new one.');
        expect(screen.queryByText(/Email link is invalid/)).toBeNull();
    });

    it('shows only known notices from the URL', async () => {
        const first = await renderApp('/login?notice=password-reset');
        expect(await screen.findByRole('status')).toHaveTextContent('Your password was changed.');
        first.unmount();
        await renderApp('/login?notice=Your+account+was+hacked');
        await screen.findByRole('heading', { name: 'Sign in' });
        expect(screen.queryByText(/hacked/)).toBeNull();
    });

    it('reports an unconfirmed email with its own message', async () => {
        const { backend } = scripted({ signIn: async () => { throw new AuthError('Confirm your email address first, then sign in.'); } });
        renderWith(backend, '/login');
        await userEvent.type(await screen.findByLabelText(/Email/), PRIYA);
        await userEvent.type(screen.getByLabelText(/Password/), DEV_PASSWORD);
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your email address first');
    });

    it.each([
        ['an external URL', 'https%3A%2F%2Fevil.example%2F'],
        ['the login page itself', '%2Flogin%3Fnext%3D%252Flogin'],
    ])('ignores %s in ?next and lands on the role home', async (_label, next) => {
        const { router } = await renderApp(`/login?next=${next}`);
        await userEvent.type(await screen.findByLabelText(/Email/), PRIYA);
        await userEvent.type(screen.getByLabelText(/Password/), DEV_PASSWORD);
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/adpost/c/pod/dashboard'));
    });

    it('carries a validated ?next to the registration page', async () => {
        await renderApp('/login?next=%2Finvitations%2Ftok_1');
        expect(await screen.findByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register?next=%2Finvitations%2Ftok_1');
    });
});

describe('registration', () => {
    it('asks for email confirmation without signing in or revealing whether the address exists', async () => {
        const { backend } = scripted({ register: async () => { throw new PendingConfirmationError(); } });
        const router = renderWith(backend, '/register?next=%2Finvitations%2Ftok_1');
        await userEvent.type(await screen.findByLabelText(/Name/), 'New Person');
        await userEvent.type(screen.getByLabelText(/Email/), 'new.person@example.test');
        await userEvent.type(screen.getByLabelText(/Password/), 'long-enough-pw');
        await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
        expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('If this address can be registered');
        expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login?next=%2Finvitations%2Ftok_1');
        expect(router.state.location.pathname).toBe('/register');
        expect(backend.auth.currentSession()).toBeNull();
    });

    it('links field errors to their inputs for assistive technology', async () => {
        await renderApp('/register');
        await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
        const email = screen.getByLabelText(/Email/);
        await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
        expect(email).toHaveAccessibleDescription('Enter a valid email address.');
        expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription(/At least 8 characters\..*Password must be at least 8 characters\./);
    });
});

describe('forgot password', () => {
    it('validates the address, then gives the same answer for known and unknown accounts', async () => {
        const requests: string[] = [];
        const { backend, local } = scripted({
            requestPasswordReset: async (email) => {
                requests.push(email);
                return local.auth.requestPasswordReset(email);
            },
        });
        renderWith(backend, '/forgot-password');
        await userEvent.type(await screen.findByLabelText(/Email/), 'not-an-email');
        await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
        expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText(/Email/));
        await userEvent.type(screen.getByLabelText(/Email/), 'nobody@example.test');
        await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
        const answer = (await screen.findByRole('status')).textContent;
        expect(answer).toContain('If an account exists for that email');
        expect(requests).toEqual(['not-an-email', 'nobody@example.test']);
    });

    it('reports rate limiting', async () => {
        const { backend } = scripted({ requestPasswordReset: async () => { throw new AuthError('Too many attempts. Wait a minute and try again.'); } });
        renderWith(backend, '/forgot-password');
        await userEvent.type(await screen.findByLabelText(/Email/), PRIYA);
        await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    });
});

describe('reset password', () => {
    it('refuses without a recovery session', async () => {
        await renderApp('/reset-password');
        expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is invalid or has expired.');
        expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
    });

    it('explains an expired link from its error code', async () => {
        await renderApp('/reset-password#error=access_denied&error_code=otp_expired');
        expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid or has expired.');
    });

    it('does not open the form for a normal (non-recovery) session', async () => {
        await renderApp('/reset-password', 'priya');
        expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is invalid or has expired.');
        expect(screen.queryByLabelText(/New password/)).toBeNull();
    });

    it('waits for the recovery session, checks the confirmation, sets the password and signs out', async () => {
        const changed: string[] = [];
        const s = scripted({
            completePasswordReset: async (pw) => {
                changed.push(pw);
                return s.local.auth.currentSession()!;
            },
        });
        const router = renderWith(s.backend, '/reset-password#access_token=redacted&type=recovery');
        expect(await screen.findByText('Checking your reset link…')).toBeInTheDocument();

        // What the SDK does once it has exchanged the link: PASSWORD_RECOVERY with a session.
        await s.local.auth.signIn(PRIYA, DEV_PASSWORD);
        s.setRecovery(true);
        s.emit(s.local.auth.currentSession());
        expect(await screen.findByText(`Choose a new password for ${PRIYA}.`)).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText(/^New password/), 'brand-new-pass');
        await userEvent.type(screen.getByLabelText(/Confirm new password/), 'different-pass');
        await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
        expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
        expect(changed).toEqual([]);

        await userEvent.clear(screen.getByLabelText(/Confirm new password/));
        await userEvent.type(screen.getByLabelText(/Confirm new password/), 'brand-new-pass');
        await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
        expect(changed).toEqual(['brand-new-pass']);
        expect(await screen.findByText('Your password was changed. Sign in with your new password.')).toBeInTheDocument();
        expect(s.backend.auth.currentSession()).toBeNull();
    });
});

describe('session lifecycle', () => {
    it('restores before routes render: a stored session opens a protected page directly', async () => {
        const { router } = await renderApp('/a/adpost/c/pod/dashboard', 'priya');
        expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/a/adpost/c/pod/dashboard');
        expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    });

    it('a suspension while signed in ends the session; the login page says so and keeps the page', async () => {
        const { router, db } = await renderApp('/a/adpost/c/pod/dashboard', 'priya');
        await screen.findByRole('heading', { name: 'Dashboard' });
        act(() => void db.patch('users', FIXTURE_IDS.users.priya, { deactivatedAt: db.nowIso() }));
        expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again to continue.');
        expect(router.state.location.search).toBe('?next=%2Fa%2Fadpost%2Fc%2Fpod%2Fdashboard');

        await userEvent.type(screen.getByLabelText(/Email/), PRIYA);
        await userEvent.type(screen.getByLabelText(/Password/), DEV_PASSWORD);
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('This account is suspended.');
    });

    it('an expired session reported by the backend returns to sign-in', async () => {
        const s = scripted();
        await s.local.auth.signIn(PRIYA, DEV_PASSWORD);
        const router = renderWith(s.backend, '/a/adpost/c/pod/dashboard');
        await screen.findByRole('heading', { name: 'Dashboard' });
        s.emit(null);
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
        expect(screen.getByRole('status')).toHaveTextContent('Your session ended.');
    });

    it('an explicit sign-out clears the session without the "session ended" notice', async () => {
        const { router, backend } = await renderApp('/a/adpost/c/pod/dashboard', 'priya');
        await screen.findByRole('heading', { name: 'Dashboard' });
        await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!);
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
        expect(backend.auth.currentSession()).toBeNull();
        expect(() => backend.api()).toThrow(AuthError);
        expect(screen.queryByText(/Your session ended/)).toBeNull();
        // Back to the protected page: sign-in is required again.
        // The old sign-in heading unmounts when the route changes; wait for the new one.
        const stale = await screen.findByRole('heading', { name: 'Sign in' });
        await router.navigate('/a/adpost/c/pod/dashboard');
        await waitFor(() => expect(router.state.location.search).toBe('?next=%2Fa%2Fadpost%2Fc%2Fpod%2Fdashboard'));
        await waitFor(() => expect(stale).not.toBeInTheDocument());
        expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });

    it('sign-out still clears the UI when the backend call fails', async () => {
        const s = scripted({ signOut: async () => { throw new Error('network down'); } });
        await s.local.auth.signIn(PRIYA, DEV_PASSWORD);
        const router = renderWith(s.backend, '/me');
        await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    });
});
