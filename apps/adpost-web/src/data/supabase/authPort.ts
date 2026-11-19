/**
 * The only code that talks to Supabase Auth for the 17E adapter. It hands `SupabaseAuth` user ids,
 * profile rows and error codes, and never tokens or session objects, so no credential can leak
 * into React state, errors or logs. Unit tests replace it with an in-memory fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PortError {
    /** Supabase Auth error code (e.g. `invalid_credentials`, `email_not_confirmed`), when present. */
    code?: string;
    status?: number;
}

export interface ProfileRow {
    id: string;
    name: string;
    email: string;
    deactivatedAt: string | null;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY' | 'INITIAL_SESSION' | 'OTHER';

export interface AuthPort {
    signInWithPassword(email: string, password: string): Promise<{ userId: string | null; error: PortError | null }>;
    /** `hasSession` is false when the project requires email confirmation first. */
    signUp(input: { email: string; password: string; name: string; redirectTo: string }): Promise<{ hasSession: boolean; userId: string | null; error: PortError | null }>;
    signOut(): Promise<void>;
    /** The stored session's user id (restored and refreshed by supabase-js), or null. */
    sessionUserId(): Promise<string | null>;
    onAuthEvent(listener: (event: AuthEvent, userId: string | null) => void): () => void;
    updatePassword(newPassword: string): Promise<{ error: PortError | null }>;
    sendPasswordReset(email: string, redirectTo: string): Promise<{ error: PortError | null }>;
    loadProfile(userId: string): Promise<ProfileRow | null>;
    updateProfileName(userId: string, name: string): Promise<{ error: PortError | null }>;
}

const KNOWN_EVENTS = new Set<AuthEvent>(['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY', 'INITIAL_SESSION']);

const portError = (e: { code?: string; status?: number } | null | undefined): PortError | null =>
    e ? { ...(e.code ? { code: e.code } : {}), ...(e.status ? { status: e.status } : {}) } : null;

export function supabaseAuthPort(client: SupabaseClient): AuthPort {
    return {
        async signInWithPassword(email, password) {
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            return { userId: data.user?.id ?? null, error: portError(error) };
        },
        async signUp({ email, password, name, redirectTo }) {
            const { data, error } = await client.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirectTo } });
            return { hasSession: !!data.session, userId: data.user?.id ?? null, error: portError(error) };
        },
        async signOut() {
            // Local scope: this browser only. Revoking every device is an admin action.
            await client.auth.signOut({ scope: 'local' });
        },
        async sessionUserId() {
            const { data } = await client.auth.getSession();
            return data.session?.user.id ?? null;
        },
        onAuthEvent(listener) {
            const { data } = client.auth.onAuthStateChange((event, session) => {
                listener(KNOWN_EVENTS.has(event as AuthEvent) ? (event as AuthEvent) : 'OTHER', session?.user.id ?? null);
            });
            return () => data.subscription.unsubscribe();
        },
        async updatePassword(newPassword) {
            const { error } = await client.auth.updateUser({ password: newPassword });
            return { error: portError(error) };
        },
        async sendPasswordReset(email, redirectTo) {
            const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
            return { error: portError(error) };
        },
        async loadProfile(userId) {
            const { data, error } = await client.from('profiles').select('id, name, email, deactivated_at').eq('id', userId).maybeSingle();
            if (error || !data) return null;
            const row = data as { id: string; name: string; email: string; deactivated_at: string | null };
            return { id: row.id, name: row.name, email: row.email, deactivatedAt: row.deactivated_at };
        },
        async updateProfileName(userId, name) {
            const { error } = await client.from('profiles').update({ name }).eq('id', userId);
            return { error: error ? { code: error.code } : null };
        },
    };
}
