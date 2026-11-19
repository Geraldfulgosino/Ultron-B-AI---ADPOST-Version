/**
 * Role-aware landing and route access (Phase 17E, owner Decision A of 2026-11-20) on the dev
 * sample dataset: Super Admin → /platform, Admin → their agency, Client User → their client
 * (or a picker), no membership → /access-pending. The UI gates are UX only; the matching data
 * layer refusals are tested in src/data/local/agencies.test.ts and roles.db.test.ts.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSampleApp } from '@/test/renderApp';
import { sampleClientId } from '@/data/local/sampleSeed';

const SUPER = 'platform@ultron.example.test';
const ADPOST = 'admin@adpost.example.test';
const VCA = 'admin@vca.example.test';
const LIPSKY_CLIENT = 'user@lipsky.example.test';
const POD_CLIENT = 'client@pod.example.test';

type Router = Awaited<ReturnType<typeof renderSampleApp>>['router'];

const loading = () => screen.queryAllByRole('status').filter((el) => el.textContent?.includes('Loading'));

/**
 * Navigates and asserts the route is refused once it has settled. React may reuse the 403 of
 * the previous route (same layout, same gate), so instead of waiting for it to unmount this
 * waits until nothing is loading and checks the heading again: a page that would have been
 * allowed has replaced it by then.
 */
const expectDenied = async (router: Router, path: string) => {
    await router.navigate(path);
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    await waitFor(() => expect(loading()).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument());
    expect(loading()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
};

describe('landing after sign-in', () => {
    it.each([
        [SUPER, '/platform'],
        [ADPOST, '/a/adpost'],
        [VCA, '/a/vca'],
        [LIPSKY_CLIENT, '/a/vca/c/lipsky/dashboard'],
        [POD_CLIENT, '/a/adpost/c/pod/dashboard'],
    ])('%s lands on %s', async (email, path) => {
        const { router } = await renderSampleApp('/home', email);
        await waitFor(() => expect(router.state.location.pathname).toBe(path));
    });

    it('signing in from the login page goes to the role home', async () => {
        const { router } = await renderSampleApp('/login');
        await userEvent.type(await screen.findByLabelText(/Email/), LIPSKY_CLIENT);
        await userEvent.type(screen.getByLabelText(/Password/), 'adpost-dev');
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca/c/lipsky/dashboard'));
    });

    it('a Client User of several clients chooses among exactly those clients', async () => {
        const { router, db } = await renderSampleApp('/login');
        db.insert('brandMemberships', { id: 'bm_lipsky_cms', brandId: sampleClientId('vca', 'cms'), userId: 'usr_lipsky_client', role: 'client', clientId: null, department: null, permissions: [], joinedAt: db.nowIso() });
        await userEvent.type(await screen.findByLabelText(/Email/), LIPSKY_CLIENT);
        await userEvent.type(screen.getByLabelText(/Password/), 'adpost-dev');
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/brands'));
        const links = within(await screen.findByRole('list')).getAllByRole('link');
        expect(links.map((a) => a.getAttribute('href')).sort()).toEqual(['/a/vca/c/cms/dashboard', '/a/vca/c/lipsky/dashboard']);
        await userEvent.click(links.find((a) => a.textContent?.includes('CMS'))!);
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca/c/cms/dashboard'));
    });

    it('a new account with no membership gets the access-pending screen, not an empty workspace', async () => {
        const { router } = await renderSampleApp('/register');
        await userEvent.type(await screen.findByLabelText(/Name/), 'New Person');
        await userEvent.type(screen.getByLabelText(/Email/), 'new.person@example.test');
        await userEvent.type(screen.getByLabelText(/Password/), 'long-enough-pw');
        await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/access-pending'));
        expect(await screen.findByRole('heading', { name: 'Your account has no workspace yet' })).toBeInTheDocument();
        // Every workspace URL is refused, and the directory sends them back here.
        await expectDenied(router, '/a/adpost');
        await expectDenied(router, '/a/adpost/c/pod/dashboard');
        await expectDenied(router, '/platform');
        await router.navigate('/agencies');
        await waitFor(() => expect(router.state.location.pathname).toBe('/access-pending'));
    });

    it('users with access are sent home from /access-pending', async () => {
        const { router } = await renderSampleApp('/access-pending', VCA);
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca'));
    });
});

describe('route access by role', () => {
    it('Super Admin opens the platform and every agency', async () => {
        const { router } = await renderSampleApp('/platform', SUPER);
        await waitFor(() => expect(router.state.location.pathname).toBe('/platform'));
        for (const [slug, name] of [['adpost', 'ADPOST'], ['vca', 'VCA'], ['lugenix-digital-services', 'GoldStarATM']] as const) {
            await router.navigate(`/a/${slug}`);
            await waitFor(() => expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(name));
        }
    });

    it('Admin: own agency and its user administration; no platform, no other agency', async () => {
        const { router } = await renderSampleApp('/a/adpost/users', ADPOST);
        expect(await screen.findByRole('table', { name: 'Users' })).toBeInTheDocument();
        await expectDenied(router, '/platform');
        await expectDenied(router, '/a/vca');
        await expectDenied(router, '/a/vca/c/lipsky/dashboard');
    });

    it('Client User: own client only; agency pages send them back; platform and other tenants refused', async () => {
        const { router } = await renderSampleApp('/a/vca/c/lipsky/dashboard', LIPSKY_CLIENT);
        await screen.findByRole('heading', { name: 'Dashboard' });
        for (const path of ['/a/vca', '/a/vca/clients', '/a/vca/settings', '/a/vca/users', '/agencies']) {
            await router.navigate(path);
            await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca/c/lipsky/dashboard'));
        }
        await expectDenied(router, '/platform');
        await expectDenied(router, '/a/adpost'); // another agency
        await expectDenied(router, '/a/vca/c/cms/dashboard'); // another client of the same agency
        await expectDenied(router, '/a/vca/c/lipsky/members');
        await expectDenied(router, '/a/vca/c/lipsky/settings/ai-providers');
    });

    it('the Client User sidebar names the agency without linking to the agency workspace', async () => {
        await renderSampleApp('/a/vca/c/lipsky/dashboard', LIPSKY_CLIENT);
        await screen.findByRole('heading', { name: 'Dashboard' });
        const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
        const sidebar = nav.parentElement!;
        await waitFor(() => expect(within(sidebar).getByText('VCA', { exact: false })).toBeInTheDocument());
        expect(within(sidebar).queryAllByRole('link').filter((a) => a.getAttribute('href') === '/a/vca')).toHaveLength(0);
    });
});

describe('access removed while signed in', () => {
    it('a revoked client membership denies the open page; "my workspace" leads to access pending', async () => {
        const { router, db } = await renderSampleApp('/a/vca/c/lipsky/dashboard', LIPSKY_CLIENT);
        await screen.findByRole('heading', { name: 'Dashboard' });
        act(() => void db.delete('brandMemberships', (m) => m.userId === 'usr_lipsky_client'));
        expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('link', { name: 'Go to my workspace' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/access-pending'));
    });

    it('a revoked agency role denies the agency workspace', async () => {
        const { db } = await renderSampleApp('/a/vca', VCA);
        await screen.findByRole('navigation', { name: 'Agency' });
        act(() => void db.delete('agencyMemberships', (m) => m.userId === 'usr_vca_admin'));
        expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    });
});

describe('403 accessibility', () => {
    it('inside the client shell: one main landmark, a working skip link, focus on the heading', async () => {
        await renderSampleApp('/a/adpost/c/pod/members', POD_CLIENT);
        const heading = await screen.findByRole('heading', { name: 'Access denied', level: 1 });
        const mains = screen.getAllByRole('main');
        expect(mains).toHaveLength(1);
        expect(mains[0]).toHaveAttribute('id', 'main');
        expect(mains[0]).toContainElement(heading);
        const skip = screen.getByRole('link', { name: 'Skip to content' });
        expect(document.querySelector(skip.getAttribute('href')!)).toBe(mains[0]);
        await waitFor(() => expect(heading).toHaveFocus());
        // Keyboard: the recovery link is reachable and goes home.
        expect(screen.getByRole('link', { name: 'Go to my workspace' })).toHaveAttribute('href', '/home');
    });

    it('stand-alone (no shell): a main landmark and a focused heading', async () => {
        await renderSampleApp('/a/vca/c/cms/dashboard', POD_CLIENT);
        const heading = await screen.findByRole('heading', { name: 'Access denied', level: 1 });
        expect(screen.getAllByRole('main')).toHaveLength(1);
        await waitFor(() => expect(heading).toHaveFocus());
    });

    it('sign-in, 404 and access-pending pages have a main landmark', async () => {
        const login = await renderSampleApp('/login');
        await screen.findByRole('heading', { name: 'Sign in' });
        expect(screen.getAllByRole('main')).toHaveLength(1);
        login.unmount();
        const missing = await renderSampleApp('/no-such-page');
        await screen.findByRole('heading', { name: 'Page not found' });
        expect(screen.getAllByRole('main')).toHaveLength(1);
        missing.unmount();
    });
});
