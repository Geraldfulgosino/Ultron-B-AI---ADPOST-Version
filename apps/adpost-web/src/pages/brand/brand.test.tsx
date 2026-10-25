import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';
import { as, IDS, testDb } from '@/test/helpers';
import { AccessDeniedError, ValidationError } from '@/data/errors';

describe('brand workspaces (data)', () => {
    it('a newly created brand is isolated: empty, visible to agency staff only', async () => {
        const db = testDb();
        const brand = await as('alex', db).api.workspace.createBrand({ name: 'Northwind', color: '#123456' });
        expect(await as('alex', db).api.clients.list(brand.id)).toEqual([]);
        expect((await as('priya', db).api.workspace.listBrands()).map((b) => b.brand.slug)).toEqual(['pod']);
        await expect(as('priya', db).api.clients.list(brand.id)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('rejects duplicate names and bad colors', async () => {
        const alex = as('alex').api;
        await expect(alex.workspace.createBrand({ name: 'POD' })).rejects.toBeInstanceOf(ValidationError);
        await expect(alex.workspace.createBrand({ name: 'X', color: 'red' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('only admins update brand settings; slug is stable', async () => {
        const db = testDb();
        await expect(as('vic', db).api.workspace.updateBrand(IDS.brands.pod, { name: 'Hacked' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('priya', db).api.workspace.updateBrand(IDS.brands.dmd, { name: 'Hacked' })).rejects.toBeInstanceOf(AccessDeniedError);
        const updated = await as('priya', db).api.workspace.updateBrand(IDS.brands.pod, { name: 'POD Global' });
        expect(updated).toMatchObject({ name: 'POD Global', slug: 'pod' });
    });
});

describe('brand workspaces (UI)', () => {
    it('agency owner creates a brand from the picker and lands on its settings', async () => {
        const { router } = await renderApp('/brands', 'alex');
        await userEvent.click(await screen.findByRole('button', { name: /New brand/ }));
        const dialog = screen.getByRole('dialog', { name: 'New brand' });
        await userEvent.type(within(dialog).getByLabelText(/Brand name/), 'Northwind Labs');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create brand' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/b/northwind-labs/settings'));
        expect(await screen.findByLabelText(/^Name/)).toHaveValue('Northwind Labs');
    });

    it('brand owner saves settings; shell reflects the new name', async () => {
        await renderApp('/b/pod/settings', 'priya');
        const name = await screen.findByLabelText(/^Name/);
        await userEvent.clear(name);
        await userEvent.type(name, 'POD Global');
        await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(await screen.findByText('Brand settings saved.')).toBeInTheDocument();
        expect((await screen.findAllByText('POD Global')).length).toBeGreaterThan(0);
    });

    it('viewer sees settings read-only', async () => {
        await renderApp('/b/pod/settings', 'vic');
        expect(await screen.findByLabelText(/^Name/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    });

    it('switching brand in the shell navigates to that brand', async () => {
        const { router } = await renderApp('/b/adpost/settings', 'morgan');
        const switcher = (await screen.findAllByLabelText('Brand'))[0]!;
        await userEvent.selectOptions(switcher, 'pod');
        await waitFor(() => expect(router.state.location.pathname).toBe('/b/pod/dashboard'));
    });
});
