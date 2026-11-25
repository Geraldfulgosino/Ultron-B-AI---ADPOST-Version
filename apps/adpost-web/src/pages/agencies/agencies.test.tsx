import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSampleApp } from '@/test/renderApp';

const SUPER = 'platform@ultron.example.test';
const ADPOST = 'admin@adpost.example.test';
const MANAGER = 'manager@adpost.example.test';
const VCA = 'admin@vca.example.test';
const GOLDSTAR = 'admin@lugenix.example.test';
const LIPSKY_CLIENT = 'user@lipsky.example.test';
const POD_CLIENT = 'client@pod.example.test';

const clientNames = (table: HTMLElement) =>
    within(table).getAllByRole('link').filter((a) => a.getAttribute('href')?.endsWith('/dashboard')).map((a) => a.textContent);

type Router = Awaited<ReturnType<typeof renderSampleApp>>['router'];

/**
 * Navigates and asserts the new route is refused. A 403 left over from the previous route
 * must unmount first; otherwise `findByRole` can match that stale heading before React
 * commits the new route, and the assertion would not be about `path` at all.
 */
async function expectDenied(router: Router, path: string) {
    const stale = screen.queryAllByRole('heading', { name: 'Access denied' });
    await router.navigate(path);
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    await waitFor(() => stale.forEach((h) => expect(h).not.toBeInTheDocument()));
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
}

describe('Super Admin (sample dataset)', () => {
    it('lands on /platform with platform metrics; demo websites are labelled', async () => {
        const { router } = await renderSampleApp('/home', SUPER);
        await waitFor(() => expect(router.state.location.pathname).toBe('/platform'));
        const metrics = await screen.findByRole('region', { name: 'Platform metrics' });
        expect(within(metrics).getByText('Managed clients').parentElement!.textContent).toContain('12');
        expect(within(metrics).getByText('24 demo records (not live websites)')).toBeInTheDocument();
    });

    it('agency directory: three agencies with real counts; suspend and restore an agency', async () => {
        await renderSampleApp('/platform/agencies', SUPER);
        const list = await screen.findByRole('list', { name: 'Agencies' });
        expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('a span span')?.textContent)).toEqual(['ADPOST', 'GoldStarATM', 'VCA']);
        expect(within(list).getAllByText('4 clients · 8 websites (8 demo)')).toHaveLength(3);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await userEvent.click(within(list).getByRole('button', { name: 'Suspend VCA' }));
        await userEvent.selectOptions(screen.getByLabelText('Status'), 'suspended');
        expect(await within(await screen.findByRole('list', { name: 'Agencies' })).findByRole('button', { name: 'Restore VCA' })).toBeInTheDocument();
        confirmSpy.mockRestore();
    });

    it('users page lists every user with roles; an agency’s users page offers agency-admin invitations', async () => {
        const { router } = await renderSampleApp('/platform/users', SUPER);
        const table = await screen.findByRole('table', { name: 'Users' });
        expect(within(table).getByText('user@lipsky.example.test')).toBeInTheDocument();
        expect(within(table).getByText('Super Admin')).toBeInTheDocument();
        expect(within(table).getAllByText(/Client User/).length).toBeGreaterThanOrEqual(2);
        await router.navigate('/a/vca/users');
        expect(await screen.findByRole('button', { name: 'Invite agency admin' })).toBeInTheDocument();
    });
});

describe('Admin (sample dataset)', () => {
    it('lands on its agency; sees only it; cross-agency deep links are refused', async () => {
        const { router } = await renderSampleApp('/home', VCA);
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca'));
        await router.navigate('/agencies');
        const list = await screen.findByRole('list', { name: 'Agencies' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(1);
        expect(within(list).getByText('4 clients · 8 websites (8 demo)')).toBeInTheDocument();
        await expectDenied(router, '/a/adpost/clients');
    });

    it('exact target clients per agency; archived clients are preserved under the Archived filter', async () => {
        const ad = await renderSampleApp('/a/adpost/clients', ADPOST);
        const table = await screen.findByRole('table', { name: 'ADPOST clients' });
        expect(clientNames(table)).toEqual(['CAR MAGNETS', 'DYNAMIC SCREEN PRINTING', 'FMF', 'POD']);
        await userEvent.selectOptions(screen.getByLabelText('Status'), 'archived');
        await waitFor(() => expect(clientNames(screen.getByRole('table', { name: 'ADPOST clients' }))).toEqual(['STUDIO PILATES', 'TRADE BAGS']));
        ad.unmount();
        const v = await renderSampleApp('/a/vca/clients', VCA);
        expect(clientNames(await screen.findByRole('table', { name: 'VCA clients' }))).toEqual(['CMS', 'HLDC', 'LIPSKY', 'LOOP19']);
        v.unmount();
        await renderSampleApp('/a/lugenix-digital-services/clients', GOLDSTAR);
        expect(clientNames(await screen.findByRole('table', { name: 'GoldStarATM clients' }))).toEqual(['ATM FLORIDA', 'ATM HAWAII', 'ATM NEBRASKA', 'ATM OHIO']);
    });

    it('adds a client, rejects a duplicate slug, archives and restores', async () => {
        const { db } = await renderSampleApp('/a/adpost/clients', ADPOST);
        await userEvent.click(await screen.findByRole('button', { name: /Add client/ }));
        const dialog = screen.getByRole('dialog', { name: 'Add client to ADPOST' });
        await userEvent.type(within(dialog).getByLabelText(/^Client name/), 'POD');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
        expect(await within(dialog).findByText(/already exists in this agency/)).toBeInTheDocument();
        await userEvent.clear(within(dialog).getByLabelText(/^Client name/));
        await userEvent.type(within(dialog).getByLabelText(/^Client name/), 'Northwind');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
        const table = screen.getByRole('table', { name: 'ADPOST clients' });
        expect(await within(table).findByRole('link', { name: 'Northwind' })).toBeInTheDocument();
        await userEvent.click(within(table).getByRole('button', { name: 'Archive DYNAMIC SCREEN PRINTING' }));
        await waitFor(() => expect(db.all('brands').find((b) => b.slug === 'dsp')!.status).toBe('archived'));
        await userEvent.selectOptions(screen.getByLabelText('Status'), 'archived');
        await userEvent.click(await screen.findByRole('button', { name: 'Restore DYNAMIC SCREEN PRINTING' }));
        await waitFor(() => expect(db.all('brands').find((b) => b.slug === 'dsp')!.status).toBe('active'));
    });

    it('agency managers cannot add, edit or archive clients', async () => {
        await renderSampleApp('/a/adpost/clients', MANAGER);
        const table = await screen.findByRole('table', { name: 'ADPOST clients' });
        expect(within(table).getAllByText(/Agency manager/).length).toBe(4);
        expect(screen.queryByRole('button', { name: /Add client/ })).toBeNull();
        expect(within(table).queryByRole('button', { name: /Archive/ })).toBeNull();
    });

    it('invites a Client User with permissions from the agency Users page; cannot invite agency admins', async () => {
        const { db } = await renderSampleApp('/a/vca/users', VCA);
        const table = await screen.findByRole('table', { name: 'Users' });
        expect(within(table).getByText('user@lipsky.example.test')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Invite agency admin' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: /Invite client user/ }));
        const dialog = screen.getByRole('dialog', { name: 'Invite client user' });
        await userEvent.type(within(dialog).getByLabelText(/^Email/), 'new.client@hldc.example.test');
        await userEvent.selectOptions(within(dialog).getByLabelText(/^Client/), 'brd_vca_hamptons');
        await userEvent.click(within(dialog).getByLabelText('Download reports'));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create invitation' }));
        expect(await within(dialog).findByText(/Local mode sends no email/)).toBeInTheDocument();
        expect(db.all('invitations')).toEqual([expect.objectContaining({ email: 'new.client@hldc.example.test', role: 'client', brandId: 'brd_vca_hamptons', permissions: ['download_reports'], status: 'pending' })]);
    });
});

describe('Client User portal (sample dataset)', () => {
    it('lands on its client; restricted navigation; AI chat creates a client-shared conversation', async () => {
        const { router, db } = await renderSampleApp('/home', LIPSKY_CLIENT);
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca/c/lipsky/dashboard'));
        const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
        for (const label of ['Dashboard', 'Websites', 'Reports', 'Agent Chat', 'Projects & Tasks']) expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
        for (const label of ['Agents', 'Members', 'Settings', 'AI Providers', 'Team Chat', 'Knowledge']) expect(within(nav).queryByRole('link', { name: label })).toBeNull();
        await router.navigate('/a/vca/c/lipsky/chat');
        await userEvent.click(await screen.findByRole('button', { name: /Start chat/ }));
        await waitFor(() => expect(router.state.location.pathname).toMatch(/\/chat\/cnv_/));
        expect(db.all('conversations').filter((c) => c.createdBy === 'usr_lipsky_client')).toEqual([expect.objectContaining({ visibility: 'client_shared' })]);
        await expectDenied(router, '/a/vca/c/cms/dashboard');
    });

    it('a read-only Client User has no chat, no report downloads and no admin pages', async () => {
        const { router } = await renderSampleApp('/a/adpost/c/pod/reports', POD_CLIENT);
        await screen.findByRole('heading', { name: 'Reports' });
        expect(screen.queryByRole('button', { name: /Export PDF/ })).toBeNull();
        await expectDenied(router, '/a/adpost/c/pod/chat');
        await expectDenied(router, '/a/adpost/c/pod/members');
        // Agency administration is not part of the client portal (Decision A): the agency
        // workspace sends a Client User back to their client, with no user list or invitations.
        for (const path of ['/a/adpost/users', '/a/adpost', '/a/adpost/clients', '/a/adpost/settings', '/agencies']) {
            await router.navigate(path);
            await waitFor(() => expect(router.state.location.pathname).toBe('/a/adpost/c/pod/dashboard'));
            expect(screen.queryByRole('table', { name: 'Users' })).toBeNull();
            expect(screen.queryByRole('button', { name: /Invite/ })).toBeNull();
        }
    });
});

describe('workspace selector and websites (sample dataset)', () => {
    it('agency → client → website: switching resets scope and never leaks the previous client', async () => {
        const { router } = await renderSampleApp('/a/adpost/c/pod/dashboard', ADPOST);
        const client = (await screen.findAllByLabelText('Client'))[0]! as HTMLSelectElement;
        expect([...client.options].map((o) => o.textContent)).toEqual(['CAR MAGNETS', 'DYNAMIC SCREEN PRINTING', 'FMF', 'POD']);
        const site = screen.getAllByLabelText('Website scope')[0]! as HTMLSelectElement;
        await waitFor(() => expect(site.options.length).toBe(3));
        await userEvent.selectOptions(site, 'web_demo_adpost_pod_stg');
        await waitFor(() => expect(router.state.location.search).toBe('?website=web_demo_adpost_pod_stg'));
        await userEvent.selectOptions(client, 'dsp');
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/adpost/c/dsp/dashboard'));
        expect(router.state.location.search).toBe('');
        await waitFor(() => expect([...(screen.getAllByLabelText('Website scope')[0] as HTMLSelectElement).options].map((o) => o.textContent))
            .toEqual(['All DYNAMIC SCREEN PRINTING websites', 'DYNAMIC SCREEN PRINTING — Production (Demo)', 'DYNAMIC SCREEN PRINTING — Staging (Demo)']));
    });

    it('VCA → HLDC shows exactly its two demo websites', async () => {
        await renderSampleApp('/a/vca/c/hamptons/websites', VCA);
        const site = (await screen.findAllByLabelText('Website scope'))[0]! as HTMLSelectElement;
        await waitFor(() => expect([...site.options].map((o) => o.textContent)).toEqual(['All HLDC websites', 'HLDC — Production (Demo)', 'HLDC — Staging (Demo)']));
        const table = await screen.findByRole('table', { name: 'HLDC websites' });
        expect(within(table).getAllByText('Demo')).toHaveLength(2);
        expect(within(table).getAllByText('Primary')).toHaveLength(1);
    });

    it('adds a website draft, makes it primary and scopes the selector to it', async () => {
        const { router, db } = await renderSampleApp('/a/adpost/c/pod/websites', ADPOST);
        await screen.findByRole('table', { name: 'POD websites' });
        await userEvent.click(await screen.findByRole('button', { name: /Add website/ }));
        const dialog = screen.getByRole('dialog', { name: 'Add website to POD' });
        await userEvent.type(within(dialog).getByLabelText(/^Website name/), 'POD staging');
        await userEvent.selectOptions(within(dialog).getByLabelText('Environment'), 'staging');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));
        const table = await screen.findByRole('table', { name: 'POD websites' });
        const mine = () => db.all('websites').find((w) => w.name === 'POD staging')!;
        await userEvent.click(within(table).getByRole('button', { name: 'Make POD staging primary' }));
        await waitFor(() => expect(mine().isPrimary).toBe(true));
        expect(db.all('websites').filter((w) => w.brandId === 'brd_adpost_pod' && w.isPrimary).map((w) => w.name)).toEqual(['POD staging']);
        const site = screen.getAllByLabelText('Website scope')[0]! as HTMLSelectElement;
        await waitFor(() => expect([...site.options].some((o) => o.value === mine().id)).toBe(true));
        await userEvent.selectOptions(site, mine().id);
        await waitFor(() => expect(router.state.location.search).toBe(`?website=${mine().id}`));
    });

    it('a demo website detail page says it is a demo and disables audits', async () => {
        await renderSampleApp('/a/lugenix-digital-services/c/atm-ohio/websites/web_demo_lugenix_atm_ohio_prod', GOLDSTAR);
        expect(await screen.findByText(/atm-ohio\.example is a reserved example domain, not a real or verified website/)).toBeInTheDocument();
        expect(screen.getByText('Disabled: demo records are never crawled or audited.')).toBeInTheDocument();
    });

    it('legacy /b/ links redirect to the canonical agency path', async () => {
        const { router } = await renderSampleApp('/b/atm-ohio/dashboard', GOLDSTAR);
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/lugenix-digital-services/c/atm-ohio/dashboard'));
    });
});

describe('My profile', () => {
    it('changes the display name; memberships are listed, not editable', async () => {
        await renderSampleApp('/me', LIPSKY_CLIENT);
        const name = await screen.findByLabelText(/^Name/);
        await userEvent.clear(name);
        await userEvent.type(name, 'Lee Lipsky');
        await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
        expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: 'LIPSKY' })).toBeInTheDocument();
        expect(screen.getByText(/Client · Use client-facing AI chat, Comment on shared tasks/)).toBeInTheDocument();
    });
});
