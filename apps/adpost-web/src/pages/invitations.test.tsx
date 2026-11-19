/** Invitation acceptance (client and agency invitations) on the dev sample dataset, local mode. */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiFor } from '@/data/local/backend';
import type { LocalDatabase } from '@/data/local/db';
import { sampleClientId } from '@/data/local/sampleSeed';
import { renderSampleApp } from '@/test/renderApp';

const LIPSKY = sampleClientId('vca', 'lipsky');
const INVITED = 'invited.person@example.test';

async function clientInvite(db: LocalDatabase, email = INVITED) {
    const { devAcceptPath } = await apiFor(db, 'usr_vca_admin').invitations.send(LIPSKY, { email, role: 'client', permissions: ['ai_chat'] });
    return devAcceptPath!;
}

const expire = (db: LocalDatabase, table: 'invitations' | 'agencyInvitations') => {
    for (const i of db.all(table)) db.patch(table, i.id, { expiresAt: '2026-01-01T00:00:00.000Z' });
};

describe('client invitation', () => {
    it('signed out: sign-in is required, then a new account accepts and lands on the client', async () => {
        const { router, db } = await renderSampleApp('/login');
        const path = await clientInvite(db);
        await router.navigate(path);
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
        expect(router.state.location.search).toBe(`?next=${encodeURIComponent(path)}`);

        await userEvent.click(await screen.findByRole('link', { name: 'Create account' }));
        await userEvent.type(await screen.findByLabelText(/Name/), 'Invited Person');
        await userEvent.type(screen.getByLabelText(/Email/), INVITED);
        await userEvent.type(screen.getByLabelText(/Password/), 'long-enough-pw');
        await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
        await waitFor(() => expect(router.state.location.pathname).toBe(path));
        expect(await screen.findByText('LIPSKY')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca/c/lipsky/dashboard'));
        // Accepting made them a Client User: their home is that client, never the agency.
        await router.navigate('/home');
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca/c/lipsky/dashboard'));
    });

    it('an expired invitation cannot be accepted', async () => {
        const { router, db } = await renderSampleApp('/me', 'client@pod.example.test');
        const path = await clientInvite(db, 'client@pod.example.test');
        expire(db, 'invitations');
        await router.navigate(path);
        expect(await screen.findByText(/This invitation has expired/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeDisabled();
        expect(db.all('brandMemberships').some((m) => m.userId === 'usr_pod_client' && m.brandId === LIPSKY)).toBe(false);
    });

    it('another signed-in account cannot accept it (and the data layer refuses it too)', async () => {
        const { router, db } = await renderSampleApp('/me', 'client@pod.example.test');
        const path = await clientInvite(db);
        await router.navigate(path);
        expect(await screen.findByText(/You are signed in as client@pod.example.test/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeDisabled();
        await expect(apiFor(db, 'usr_pod_client').invitations.accept(path.split('/').pop()!)).rejects.toThrow('different email address');
    });

    it('an unknown token says so', async () => {
        const { router } = await renderSampleApp('/me', 'client@pod.example.test');
        await router.navigate('/invitations/not-a-token');
        expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
    });
});

describe('agency invitation', () => {
    async function agencyInvite(db: LocalDatabase) {
        const { devAcceptPath } = await apiFor(db, 'usr_platform').users.inviteAgencyUser('agy_vca', { email: 'manager@adpost.example.test', role: 'agency_admin' });
        return devAcceptPath!;
    }

    it('the invited account accepts and lands on the agency', async () => {
        const { router, db } = await renderSampleApp('/me', 'manager@adpost.example.test');
        await router.navigate(await agencyInvite(db));
        await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
        await waitFor(() => expect(router.state.location.pathname).toBe('/a/vca'));
    });

    it('an expired agency invitation is refused with a clear message', async () => {
        const { router, db } = await renderSampleApp('/me', 'manager@adpost.example.test');
        const path = await agencyInvite(db);
        expire(db, 'agencyInvitations');
        await router.navigate(path);
        await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('This invitation has expired.');
        expect(router.state.location.pathname).toBe(path);
        expect(db.all('agencyMemberships').some((m) => m.userId === 'usr_adpost_manager' && m.agencyId === 'agy_vca')).toBe(false);
    });

    it('a different account is refused', async () => {
        const { router, db } = await renderSampleApp('/me', 'client@pod.example.test');
        await router.navigate(await agencyInvite(db));
        await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('different email address');
    });
});
