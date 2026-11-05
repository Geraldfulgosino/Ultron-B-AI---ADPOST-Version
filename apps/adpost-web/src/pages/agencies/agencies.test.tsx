import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSampleApp } from '@/test/renderApp';

const PLATFORM = 'platform@ultron.example.test';
const ADPOST = 'admin@adpost.example.test';
const MANAGER = 'manager@adpost.example.test';
const VCA = 'admin@vca.example.test';
const POD_SEO = 'seo@pod.example.test';

describe('agency directory (sample dataset)', () => {
    it('platform admins see exactly three agencies, platform totals and can add an agency', async () => {
        const { router } = await renderSampleApp('/agencies', PLATFORM);
        const list = await screen.findByRole('list', { name: 'Agencies' });
        expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('a span span')?.textContent)).toEqual(['ADPOST', 'Lugenix Digital Services', 'VCA']);
        expect(within(list).getAllByText('Directory only')).toHaveLength(3);
        const totals = await screen.findByRole('region', { name: 'Platform overview' });
        expect(within(totals).getByText('3')).toBeInTheDocument();
        expect(within(totals).getByText('10')).toBeInTheDocument();
        expect(within(totals).getByText('None connected')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Add agency/ }));
        const dialog = screen.getByRole('dialog', { name: 'Add agency' });
        await userEvent.type(within(dialog).getByLabelText(/^Agency name/), 'North Agency');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create agency' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/north-agency'));
    });

    it('agency admins see only their agency with real counts; other agencies are denied', async () => {
        await renderSampleApp('/agencies', ADPOST);
        const list = await screen.findByRole('list', { name: 'Agencies' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(1);
        expect(within(list).getByText('5 clients · 0 websites')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Add agency/ })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Platform overview' })).toBeNull();
    });

    it('cross-agency deep links are refused', async () => {
        await renderSampleApp('/a/adpost/clients', VCA);
        expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    });
});

describe('agency clients (sample dataset)', () => {
    it('lists exactly ADPOST’s five clients with empty website and integration states', async () => {
        await renderSampleApp('/a/adpost/clients', ADPOST);
        const table = await screen.findByRole('table', { name: 'ADPOST clients' });
        const names = within(table).getAllByRole('link').filter((a) => a.getAttribute('href')?.endsWith('/dashboard')).map((a) => a.textContent);
        expect(names).toEqual(['DSP', 'FMF', 'POD', 'STUDIO PILATES', 'TRADE BAGS']);
        expect(within(table).getAllByRole('link', { name: 'Add website' })).toHaveLength(5);
        expect(within(table).getAllByText('Not connected')).toHaveLength(5);
    });

    it('VCA and Lugenix show their exact clients', async () => {
        const vca = await renderSampleApp('/a/vca/clients', VCA);
        const table = await screen.findByRole('table', { name: 'VCA clients' });
        expect(within(table).getAllByRole('link').filter((a) => a.getAttribute('href')?.endsWith('/dashboard')).map((a) => a.textContent)).toEqual(['CMS', 'HAMPTONS', 'LIPSKY', 'LOOP19']);
        vca.unmount();
        await renderSampleApp('/a/lugenix-digital-services/clients', 'admin@lugenix.example.test');
        const t2 = await screen.findByRole('table', { name: 'Lugenix Digital Services clients' });
        expect(within(t2).getAllByRole('link').filter((a) => a.getAttribute('href')?.endsWith('/dashboard')).map((a) => a.textContent)).toEqual(['GoldStar ATM']);
    });

    it('adds a client, rejects a duplicate slug, archives and restores', async () => {
        const { db } = await renderSampleApp('/a/adpost/clients', ADPOST);
        await userEvent.click(await screen.findByRole('button', { name: /Add client/ }));
        let dialog = screen.getByRole('dialog', { name: 'Add client to ADPOST' });
        await userEvent.type(within(dialog).getByLabelText(/^Client name/), 'POD');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
        expect(await within(dialog).findByText(/already exists in this agency/)).toBeInTheDocument();
        await userEvent.clear(within(dialog).getByLabelText(/^Client name/));
        await userEvent.type(within(dialog).getByLabelText(/^Client name/), 'Northwind');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
        const table = screen.getByRole('table', { name: 'ADPOST clients' });
        expect(await within(table).findByRole('link', { name: 'Northwind' })).toBeInTheDocument();
        expect(db.all('agentInstances').filter((a) => db.find('brands', a.brandId)?.name === 'Northwind')).toHaveLength(6);

        await userEvent.click(within(table).getByRole('button', { name: 'Archive DSP' }));
        await waitFor(() => expect(within(table).queryByRole('link', { name: 'DSP' })).toBeNull());
        await userEvent.selectOptions(screen.getByLabelText('Status'), 'archived');
        await userEvent.click(await screen.findByRole('button', { name: 'Restore DSP' }));
        await waitFor(() => expect(db.all('brands').find((b) => b.slug === 'dsp')!.status).toBe('active'));
        dialog = screen.queryByRole('dialog')!;
        expect(dialog).toBeNull();
    });

    it('agency managers cannot add, edit or archive clients', async () => {
        await renderSampleApp('/a/adpost/clients', MANAGER);
        const table = await screen.findByRole('table', { name: 'ADPOST clients' });
        expect(within(table).getAllByText(/Agency manager/).length).toBe(5);
        expect(screen.queryByRole('button', { name: /Add client/ })).toBeNull();
        expect(within(table).queryByRole('button', { name: /Archive/ })).toBeNull();
    });

    it('a client member sees only their client', async () => {
        await renderSampleApp('/a/adpost/clients', POD_SEO);
        const table = await screen.findByRole('table', { name: 'ADPOST clients' });
        expect(within(table).getAllByRole('link').filter((a) => a.getAttribute('href')?.endsWith('/dashboard')).map((a) => a.textContent)).toEqual(['POD']);
    });
});

describe('workspace selector and website management (sample dataset)', () => {
    it('agency → client → website: switching resets scope and never leaks the previous client', async () => {
        const { router } = await renderSampleApp('/a/adpost/c/pod/dashboard', ADPOST);
        const client = (await screen.findAllByLabelText('Client'))[0]! as HTMLSelectElement;
        expect([...client.options].map((o) => o.textContent)).toEqual(['DSP', 'FMF', 'POD', 'STUDIO PILATES', 'TRADE BAGS']);
        const site = screen.getAllByLabelText('Website scope')[0]! as HTMLSelectElement;
        expect(site).toBeDisabled();
        expect(site.options[0]!.textContent).toBe('No websites yet');
        expect(await screen.findByText('No analytics data yet')).toBeInTheDocument();
        await userEvent.selectOptions(client, 'dsp');
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/adpost/c/dsp/dashboard'));
        await waitFor(() => expect((screen.getAllByLabelText('Client')[0] as HTMLSelectElement).value).toBe('dsp'));
    });

    it('adds websites (draft and production), sets primary, and scopes the selector to one website', async () => {
        const { router, db } = await renderSampleApp('/a/adpost/c/pod/websites', ADPOST);
        expect(await screen.findByText(/Add POD's first website/)).toBeInTheDocument();
        await userEvent.click(await screen.findByRole('button', { name: /Add website/ }));
        const dialog = screen.getByRole('dialog', { name: 'Add website to POD' });
        await userEvent.type(within(dialog).getByLabelText(/^Website name/), 'POD staging');
        await userEvent.selectOptions(within(dialog).getByLabelText('Environment'), 'staging');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));
        const table = await screen.findByRole('table', { name: 'POD websites' });
        expect(within(table).getByText(/No URL yet \(draft\)/)).toBeInTheDocument();
        await userEvent.click(within(table).getByRole('button', { name: 'Make POD staging primary' }));
        await waitFor(() => expect(db.all('websites')[0]!.isPrimary).toBe(true));

        const site = screen.getAllByLabelText('Website scope')[0]! as HTMLSelectElement;
        await waitFor(() => expect(site).not.toBeDisabled());
        await userEvent.selectOptions(site, db.all('websites')[0]!.id);
        await waitFor(() => expect(router.state.location.search).toBe(`?website=${db.all('websites')[0]!.id}`));
    });

    it('website detail shows honest empty states and refuses audits without a URL', async () => {
        const { backend, router } = await renderSampleApp('/a/adpost/c/pod/dashboard', ADPOST);
        const w = await backend.api().websites.create('brd_adpost_pod', { name: 'Draft site' });
        await router.navigate(`/a/adpost/c/pod/websites/${w.id}`);
        expect(await screen.findByText(/will not be crawled, audited or monitored/)).toBeInTheDocument();
        expect(screen.getByText(/Not connected\. Analytics and Search Console data appear here only after a real integration syncs\./)).toBeInTheDocument();
        expect(screen.getByText(/an active website with a URL is required before any audit can run/)).toBeInTheDocument();
    });

    it('legacy /b/ links redirect to the canonical agency path', async () => {
        const { router } = await renderSampleApp('/b/goldstar-atm/dashboard', 'admin@lugenix.example.test');
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/lugenix-digital-services/c/goldstar-atm/dashboard'));
    });
});
