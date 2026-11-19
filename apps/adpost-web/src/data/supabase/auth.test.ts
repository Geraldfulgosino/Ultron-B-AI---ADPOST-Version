import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PendingConfirmationError, ValidationError } from '@/data/errors';
import { SupabaseAuth } from './auth';
import { supabaseAuthPort, type AuthEvent, type AuthPort, type PortError, type ProfileRow } from './authPort';

const ORIGIN = 'http://127.0.0.1:5173';

/** In-memory Supabase Auth: confirmed accounts, profiles, one stored session, auth events. */
class FakePort implements AuthPort {
    accounts = new Map<string, { id: string; password: string; confirmed: boolean }>();
    profiles = new Map<string, ProfileRow>();
    stored: string | null = null;
    listeners = new Set<(event: AuthEvent, userId: string | null) => void>();
    calls: string[] = [];
    resetRequests: Array<{ email: string; redirectTo: string }> = [];
    /** Optional failure injection, keyed by method name. */
    fail: Partial<Record<'signIn' | 'signUp' | 'updatePassword' | 'sendPasswordReset' | 'updateProfileName', PortError>> = {};
    confirmationRequired = true;

    addUser(id: string, email: string, password: string, extra: Partial<ProfileRow> = {}) {
        this.accounts.set(email, { id, password, confirmed: true });
        this.profiles.set(id, { id, name: id.toUpperCase(), email, deactivatedAt: null, ...extra });
    }

    emit(event: AuthEvent, userId: string | null) {
        for (const l of this.listeners) l(event, userId);
    }

    async signInWithPassword(email: string, password: string) {
        this.calls.push(`signIn:${email}`);
        if (this.fail.signIn) return { userId: null, error: this.fail.signIn };
        const a = this.accounts.get(email);
        if (!a || a.password !== password) return { userId: null, error: { code: 'invalid_credentials', status: 400 } };
        if (!a.confirmed) return { userId: null, error: { code: 'email_not_confirmed', status: 400 } };
        this.stored = a.id;
        this.emit('SIGNED_IN', a.id);
        return { userId: a.id, error: null };
    }

    async signUp({ email, password, name }: { email: string; password: string; name: string; redirectTo: string }) {
        this.calls.push(`signUp:${email}`);
        if (this.fail.signUp) return { hasSession: false, userId: null, error: this.fail.signUp };
        if (this.accounts.has(email)) return { hasSession: false, userId: null, error: { code: 'user_already_exists', status: 422 } };
        const id = `usr_${this.accounts.size + 1}`;
        this.accounts.set(email, { id, password, confirmed: !this.confirmationRequired });
        this.profiles.set(id, { id, name, email, deactivatedAt: null });
        if (this.confirmationRequired) return { hasSession: false, userId: id, error: null };
        this.stored = id;
        return { hasSession: true, userId: id, error: null };
    }

    async signOut() {
        this.calls.push('signOut');
        this.stored = null;
    }

    async sessionUserId() {
        return this.stored;
    }

    onAuthEvent(listener: (event: AuthEvent, userId: string | null) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async updatePassword(newPassword: string) {
        this.calls.push('updatePassword');
        if (this.fail.updatePassword) return { error: this.fail.updatePassword };
        const entry = [...this.accounts.values()].find((a) => a.id === this.stored);
        if (!entry) return { error: { code: 'session_not_found', status: 401 } };
        if (entry.password === newPassword) return { error: { code: 'same_password', status: 422 } };
        entry.password = newPassword;
        return { error: null };
    }

    async sendPasswordReset(email: string, redirectTo: string) {
        this.resetRequests.push({ email, redirectTo });
        return { error: this.fail.sendPasswordReset ?? null };
    }

    async loadProfile(userId: string) {
        const p = this.profiles.get(userId);
        return p ? { ...p } : null;
    }

    async updateProfileName(userId: string, name: string) {
        if (this.fail.updateProfileName) return { error: this.fail.updateProfileName };
        this.profiles.get(userId)!.name = name;
        return { error: null };
    }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(configure?: (port: FakePort) => void) {
    const port = new FakePort();
    port.addUser('usr_admin', 'admin@agency.example.test', 'correct-horse');
    port.addUser('usr_suspended', 'gone@agency.example.test', 'correct-horse', { deactivatedAt: '2026-11-01T00:00:00Z' });
    configure?.(port);
    const auth = await SupabaseAuth.create(port, { origin: ORIGIN });
    return { port, auth };
}

describe('SupabaseAuth: session restore', () => {
    it('restores an active stored session before the app mounts', async () => {
        const { auth } = await setup((p) => (p.stored = 'usr_admin'));
        expect(auth.currentSession()).toEqual({ user: { id: 'usr_admin', name: 'USR_ADMIN', email: 'admin@agency.example.test' } });
    });

    it('drops a stored session of a suspended account and signs it out', async () => {
        const { auth, port } = await setup((p) => (p.stored = 'usr_suspended'));
        expect(auth.currentSession()).toBeNull();
        expect(port.calls).toContain('signOut');
        expect(port.stored).toBeNull();
    });

    it('drops a stored session whose profile is not readable', async () => {
        const { auth } = await setup((p) => (p.stored = 'usr_unknown'));
        expect(auth.currentSession()).toBeNull();
    });

    it('starts signed out without a stored session', async () => {
        const { auth } = await setup();
        expect(auth.currentSession()).toBeNull();
    });
});

describe('SupabaseAuth: sign-in', () => {
    it('signs in with a normalized email and exposes only id, name and email', async () => {
        const { auth } = await setup();
        const session = await auth.signIn('  Admin@Agency.example.test ', 'correct-horse');
        expect(session).toEqual({ user: { id: 'usr_admin', name: 'USR_ADMIN', email: 'admin@agency.example.test' } });
        expect(Object.keys(session.user).sort()).toEqual(['email', 'id', 'name']);
        expect(auth.currentSession()).toEqual(session);
    });

    it('gives the same message for an unknown email and a wrong password', async () => {
        const { auth } = await setup();
        const unknown = await auth.signIn('nobody@agency.example.test', 'correct-horse').catch((e: Error) => e);
        const wrong = await auth.signIn('admin@agency.example.test', 'nope').catch((e: Error) => e);
        expect(unknown).toBeInstanceOf(AuthError);
        expect((unknown as Error).message).toBe((wrong as Error).message);
        expect(auth.currentSession()).toBeNull();
    });

    it('refuses a suspended account and leaves no session behind', async () => {
        const { auth, port } = await setup();
        await expect(auth.signIn('gone@agency.example.test', 'correct-horse')).rejects.toThrow('This account is suspended. Contact your administrator.');
        await flush();
        expect(auth.currentSession()).toBeNull();
        expect(port.stored).toBeNull();
    });

    it('asks for email confirmation and reports rate limiting', async () => {
        const { auth, port } = await setup((p) => p.accounts.set('new@agency.example.test', { id: 'usr_new', password: 'correct-horse', confirmed: false }));
        await expect(auth.signIn('new@agency.example.test', 'correct-horse')).rejects.toThrow('Confirm your email address first, then sign in.');
        port.fail.signIn = { status: 429, code: 'over_request_rate_limit' };
        await expect(auth.signIn('admin@agency.example.test', 'correct-horse')).rejects.toThrow('Too many attempts');
    });

    it('never surfaces raw provider messages', async () => {
        const { auth, port } = await setup();
        port.fail.signIn = { status: 500, code: 'unexpected_failure' };
        await expect(auth.signIn('admin@agency.example.test', 'correct-horse')).rejects.toThrow('These credentials do not match our records.');
    });
});

describe('SupabaseAuth: registration', () => {
    it('validates input before calling Supabase', async () => {
        const { auth, port } = await setup();
        const err = await auth.register({ name: ' ', email: 'bad', password: 'short' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).fields).toEqual({ name: 'Name is required.', email: 'Enter a valid email address.', password: 'Password must be at least 8 characters.' });
        expect(port.calls.filter((c) => c.startsWith('signUp'))).toEqual([]);
    });

    it('answers a new and an existing email the same way when confirmation is required', async () => {
        const { auth } = await setup();
        const fresh = await auth.register({ name: 'New', email: 'fresh@agency.example.test', password: 'long-enough' }).catch((e: unknown) => e);
        const existing = await auth.register({ name: 'Dup', email: 'admin@agency.example.test', password: 'long-enough' }).catch((e: unknown) => e);
        expect(fresh).toBeInstanceOf(PendingConfirmationError);
        expect(existing).toBeInstanceOf(PendingConfirmationError);
        expect((fresh as Error).message).toBe((existing as Error).message);
        expect(auth.currentSession()).toBeNull();
    });

    it('signs in directly when the project does not require confirmation', async () => {
        const { auth } = await setup((p) => (p.confirmationRequired = false));
        const session = await auth.register({ name: 'New', email: 'fresh@agency.example.test', password: 'long-enough' });
        expect(session.user).toMatchObject({ name: 'New', email: 'fresh@agency.example.test' });
    });

    it('maps a weak password to a field error', async () => {
        const { auth, port } = await setup();
        port.fail.signUp = { code: 'weak_password', status: 422 };
        await expect(auth.register({ name: 'New', email: 'fresh@agency.example.test', password: 'long-enough' })).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('SupabaseAuth: profile and password', () => {
    it('updates the display name only for the signed-in user', async () => {
        const { auth, port } = await setup();
        await expect(auth.updateProfile({ name: 'Nope' })).rejects.toBeInstanceOf(AuthError);
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        await expect(auth.updateProfile({ name: '  ' })).rejects.toBeInstanceOf(ValidationError);
        const session = await auth.updateProfile({ name: ' Agency Admin ' });
        expect(session.user.name).toBe('Agency Admin');
        expect(port.profiles.get('usr_admin')!.name).toBe('Agency Admin');
        port.fail.updateProfileName = { code: '42501' };
        await expect(auth.updateProfile({ name: 'Other' })).rejects.toThrow('Your profile could not be saved');
    });

    it('re-authenticates with the current password before changing it', async () => {
        const { auth, port } = await setup();
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        const wrong = await auth.changePassword('not-it', 'brand-new-pass').catch((e: unknown) => e);
        expect((wrong as ValidationError).fields).toEqual({ currentPassword: 'Your current password is incorrect.' });
        expect(port.calls).not.toContain('updatePassword');
        await expect(auth.changePassword('correct-horse', 'short')).rejects.toBeInstanceOf(ValidationError);
        await expect(auth.changePassword('correct-horse', 'correct-horse')).rejects.toBeInstanceOf(ValidationError);
        await auth.changePassword('correct-horse', 'brand-new-pass');
        expect(port.accounts.get('admin@agency.example.test')!.password).toBe('brand-new-pass');
        // Every re-authentication used the session's own email, never caller input.
        expect(new Set(port.calls.filter((c) => c.startsWith('signIn:')))).toEqual(new Set(['signIn:admin@agency.example.test']));
    });

    it('signs out locally', async () => {
        const { auth, port } = await setup();
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        await auth.signOut();
        expect(auth.currentSession()).toBeNull();
        expect(port.stored).toBeNull();
    });
});

describe('SupabaseAuth: password recovery', () => {
    it('sends reset links to /reset-password and answers unknown emails identically', async () => {
        const { auth, port } = await setup();
        await expect(auth.requestPasswordReset('admin@agency.example.test')).resolves.toBeUndefined();
        port.fail.sendPasswordReset = { code: 'user_not_found', status: 404 };
        await expect(auth.requestPasswordReset('Nobody@Agency.example.test')).resolves.toBeUndefined();
        expect(port.resetRequests).toEqual([
            { email: 'admin@agency.example.test', redirectTo: `${ORIGIN}/reset-password` },
            { email: 'nobody@agency.example.test', redirectTo: `${ORIGIN}/reset-password` },
        ]);
    });

    it('validates the email and reports rate limiting only', async () => {
        const { auth, port } = await setup();
        await expect(auth.requestPasswordReset('not-an-email')).rejects.toBeInstanceOf(ValidationError);
        port.fail.sendPasswordReset = { status: 429, code: 'over_email_send_rate_limit' };
        await expect(auth.requestPasswordReset('admin@agency.example.test')).rejects.toThrow('Too many attempts');
    });

    it('sets a new password only inside a recovery session', async () => {
        const { auth, port } = await setup();
        await expect(auth.completePasswordReset('brand-new-pass')).rejects.toThrow('This reset link is invalid or has expired');
        const seen: unknown[] = [];
        auth.onSessionChange((s) => seen.push(s?.user.id ?? null));
        port.stored = 'usr_admin';
        port.emit('PASSWORD_RECOVERY', 'usr_admin');
        await flush();
        expect(auth.inRecovery()).toBe(true);
        expect(seen).toEqual(['usr_admin']);
        await expect(auth.completePasswordReset('short')).rejects.toBeInstanceOf(ValidationError);
        const session = await auth.completePasswordReset('brand-new-pass');
        expect(session.user.id).toBe('usr_admin');
        expect(port.accounts.get('admin@agency.example.test')!.password).toBe('brand-new-pass');
        expect(auth.inRecovery()).toBe(false);
        await expect(auth.completePasswordReset('another-pass')).rejects.toBeInstanceOf(AuthError);
    });

    it('refuses a recovery session for a suspended account', async () => {
        const { auth, port } = await setup();
        port.stored = 'usr_suspended';
        port.emit('PASSWORD_RECOVERY', 'usr_suspended');
        await flush();
        expect(auth.inRecovery()).toBe(false);
        expect(auth.currentSession()).toBeNull();
        expect(port.stored).toBeNull();
    });
});

describe('SupabaseAuth: session changes from outside the app', () => {
    it('publishes a sign-out from another tab', async () => {
        const { auth, port } = await setup();
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        const seen: unknown[] = [];
        auth.onSessionChange((s) => seen.push(s));
        port.emit('SIGNED_OUT', null);
        await flush();
        expect(seen).toEqual([null]);
        expect(auth.currentSession()).toBeNull();
    });

    it('signs out a user suspended while signed in, on the next token refresh', async () => {
        const { auth, port } = await setup();
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        const seen: unknown[] = [];
        auth.onSessionChange((s) => seen.push(s));
        port.profiles.get('usr_admin')!.deactivatedAt = '2026-11-19T00:00:00Z';
        port.emit('TOKEN_REFRESHED', 'usr_admin');
        await flush();
        expect(seen).toEqual([null]);
        expect(auth.currentSession()).toBeNull();
        expect(port.stored).toBeNull();
    });

    it('does not notify for a refresh that changes nothing', async () => {
        const { auth, port } = await setup();
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        await flush();
        const seen: unknown[] = [];
        auth.onSessionChange((s) => seen.push(s));
        port.emit('TOKEN_REFRESHED', 'usr_admin');
        await flush();
        expect(seen).toEqual([]);
    });

    it('a slow profile load cannot bring back a session after sign-out', async () => {
        const { auth, port } = await setup();
        await auth.signIn('admin@agency.example.test', 'correct-horse');
        let release!: () => void;
        const original = port.loadProfile.bind(port);
        port.loadProfile = (id) => new Promise((r) => (release = () => r(original(id))));
        port.emit('TOKEN_REFRESHED', 'usr_admin');
        await auth.signOut();
        release();
        await flush();
        await flush();
        expect(auth.currentSession()).toBeNull();
    });

    it('stops notifying after unsubscribe', async () => {
        const { auth, port } = await setup();
        const seen: unknown[] = [];
        const off = auth.onSessionChange((s) => seen.push(s));
        off();
        port.emit('SIGNED_OUT', null);
        await flush();
        expect(seen).toEqual([]);
    });
});

describe('supabaseAuthPort: no tokens cross the boundary', () => {
    const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-access-token.sig';
    const session = { access_token: TOKEN, refresh_token: 'refresh-secret', user: { id: 'usr_1' } };

    function stubClient() {
        const calls: Array<[string, unknown]> = [];
        let handler: ((event: string, s: typeof session | null) => void) | null = null;
        const query = {
            select: () => query,
            eq: () => query,
            maybeSingle: async () => ({ data: { id: 'usr_1', name: 'One', email: 'one@x.test', deactivated_at: null, extra: 'ignored' }, error: null }),
        };
        const client = {
            auth: {
                signInWithPassword: async (args: unknown) => (calls.push(['signIn', args]), { data: { user: session.user, session }, error: null }),
                signUp: async (args: unknown) => (calls.push(['signUp', args]), { data: { user: session.user, session: null }, error: null }),
                signOut: async (args: unknown) => (calls.push(['signOut', args]), { error: null }),
                getSession: async () => ({ data: { session }, error: null }),
                onAuthStateChange: (cb: typeof handler) => ((handler = cb), { data: { subscription: { unsubscribe: () => calls.push(['unsubscribe', null]) } } }),
                updateUser: async (args: unknown) => (calls.push(['updateUser', args]), { data: {}, error: { code: 'weak_password', status: 422, message: 'raw provider text' } }),
                resetPasswordForEmail: async (email: string, opts: unknown) => (calls.push(['reset', [email, opts]]), { data: {}, error: null }),
            },
            from: () => query,
        };
        return { client: client as unknown as SupabaseClient, calls, fire: (e: string, s: typeof session | null) => handler?.(e, s) };
    }

    it('returns ids and error codes only', async () => {
        const { client, calls, fire } = stubClient();
        const port = supabaseAuthPort(client);
        const results = [
            await port.signInWithPassword('one@x.test', 'pw'),
            await port.signUp({ email: 'one@x.test', password: 'pw', name: 'One', redirectTo: `${ORIGIN}/login` }),
            await port.sessionUserId(),
            await port.updatePassword('new-pass'),
            await port.loadProfile('usr_1'),
        ];
        expect(JSON.stringify(results)).not.toMatch(/token|secret|raw provider text/);
        expect(results[0]).toEqual({ userId: 'usr_1', error: null });
        expect(results[3]).toEqual({ error: { code: 'weak_password', status: 422 } });
        expect(results[4]).toEqual({ id: 'usr_1', name: 'One', email: 'one@x.test', deactivatedAt: null });

        const events: unknown[] = [];
        const off = port.onAuthEvent((event, userId) => events.push([event, userId]));
        fire('TOKEN_REFRESHED', session);
        fire('MFA_CHALLENGE_VERIFIED', session);
        fire('SIGNED_OUT', null);
        off();
        expect(events).toEqual([['TOKEN_REFRESHED', 'usr_1'], ['OTHER', 'usr_1'], ['SIGNED_OUT', null]]);

        await port.signOut();
        await port.sendPasswordReset('one@x.test', `${ORIGIN}/reset-password`);
        expect(calls).toContainEqual(['signOut', { scope: 'local' }]);
        expect(calls).toContainEqual(['signUp', { email: 'one@x.test', password: 'pw', options: { data: { name: 'One' }, emailRedirectTo: `${ORIGIN}/login` } }]);
        expect(calls).toContainEqual(['reset', ['one@x.test', { redirectTo: `${ORIGIN}/reset-password` }]]);
        expect(calls).toContainEqual(['unsubscribe', null]);
    });
});
