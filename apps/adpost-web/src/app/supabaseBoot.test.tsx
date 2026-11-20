import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConfigError } from '@/data/supabase/config';
import type { SupabaseBackend } from '@/data/supabase/backend';
import { bootSupabase, edgeServerActions, SupabaseRoot } from './supabaseBoot';

const ENV = { VITE_DATA_PROVIDER: 'supabase', VITE_SUPABASE_URL: 'https://ppwkxlwxzutigepaizob.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_key' };
const USER = '00000000-0000-4000-8000-000000000001';

/** Minimal supabase-js stand-in: a stored session, a profiles row and table reads, all recorded. */
function stubClient(opts: { session: boolean; suspended?: boolean; platformAdmin?: boolean }) {
    const reads: string[] = [];
    let signedOut = false;
    const rows: Record<string, unknown[]> = {
        profiles: [{ id: USER, name: 'Test User', email: 'user@example.test', deactivated_at: opts.suspended ? '2026-11-01T00:00:00Z' : null }],
        platform_admins: opts.platformAdmin ? [{ user_id: USER }] : [],
        agency_memberships: [], brand_memberships: [], agencies: [], brands: [],
    };
    const builder = (table: string) => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'neq', 'order', 'range', 'is', 'ilike', 'lt', 'gt', 'gte', 'lte']) b[m] = () => b;
        b.maybeSingle = async () => ({ data: rows[table]![0] ?? null, error: null });
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null, count: (rows[table] ?? []).length }).then(resolve);
        return b;
    };
    const client = {
        from: (table: string) => (reads.push(table), builder(table)),
        auth: {
            getSession: async () => ({ data: { session: opts.session && !signedOut ? { user: { id: USER }, access_token: 'synthetic-access-token' } : null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signOut: async () => {
                signedOut = true;
                return { error: null };
            },
        },
    } as unknown as SupabaseClient;
    return { client, reads, isSignedOut: () => signedOut };
}

describe('bootSupabase', () => {
    it('refuses an invalid configuration before creating any client', async () => {
        const create = vi.fn();
        await expect(bootSupabase({ env: { VITE_DATA_PROVIDER: 'supabase' }, origin: 'http://127.0.0.1:5173', createClient: create })).rejects.toBeInstanceOf(ConfigError);
        expect(create).not.toHaveBeenCalled();
    });

    it('restores the session and resolves the user’s roles before the app mounts', async () => {
        const s = stubClient({ session: true, platformAdmin: true });
        const backend = await bootSupabase({ env: ENV, origin: 'http://127.0.0.1:5173', createClient: () => s.client });
        expect(backend.auth.currentSession()?.user.id).toBe(USER);
        expect(s.reads).toEqual(expect.arrayContaining(['profiles', 'platform_admins', 'agency_memberships', 'brand_memberships']));
    });

    it('drops a stored session of a suspended account', async () => {
        const s = stubClient({ session: true, suspended: true });
        const backend = await bootSupabase({ env: ENV, origin: 'http://127.0.0.1:5173', createClient: () => s.client });
        expect(backend.auth.currentSession()).toBeNull();
        expect(s.isSignedOut()).toBe(true);
        expect(s.reads).not.toContain('platform_admins');
    });

    it('calls agent-execute and user-invite with the session token in the header only', async () => {
        const s = stubClient({ session: true });
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const fetcher = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response('{}', { status: 200 }))) as unknown as typeof fetch;
        const actions = edgeServerActions({ url: ENV.VITE_SUPABASE_URL, publishableKey: ENV.VITE_SUPABASE_PUBLISHABLE_KEY, projectRef: 'ppwkxlwxzutigepaizob' }, s.client, 'http://127.0.0.1:5173', fetcher);
        await actions.runAgents!('msg-1');
        await actions.deliverInvitation!({ kind: 'client', invitationId: 'inv-1', token: 'invite-token' });
        expect(calls.map((c) => c.url)).toEqual([`${ENV.VITE_SUPABASE_URL}/functions/v1/agent-execute`, `${ENV.VITE_SUPABASE_URL}/functions/v1/user-invite`]);
        expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer synthetic-access-token');
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ messageId: 'msg-1', idempotencyKey: 'msg-1' });
        expect(String(calls[0]!.init.body)).not.toContain('synthetic-access-token');
        expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ kind: 'client', invitationId: 'inv-1', token: 'invite-token', appOrigin: 'http://127.0.0.1:5173' });
    });
});

describe('SupabaseRoot', () => {
    it('renders no route while the session is restoring', async () => {
        render(<SupabaseRoot boot={() => new Promise<SupabaseBackend>(() => {})} />);
        expect(await screen.findByText('Restoring your session…')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
        expect(screen.queryByRole('navigation')).toBeNull();
    });

    it('shows a generic error (never raw details) and retries', async () => {
        const boot = vi.fn().mockRejectedValueOnce(new Error('relation "secret_table" does not exist')).mockReturnValue(new Promise(() => {}));
        render(<SupabaseRoot boot={boot} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('ULTRON-B AI could not start.');
        expect(screen.queryByText(/secret_table/)).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(boot).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('Restoring your session…')).toBeInTheDocument();
    });

    it('shows configuration problems as they are (they name the missing variable, never a value)', async () => {
        render(<SupabaseRoot boot={() => Promise.reject(new ConfigError('Supabase mode needs VITE_SUPABASE_URL in apps/adpost-web/.env.local.'))} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL');
    });
});
