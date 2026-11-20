/**
 * A `SupabaseBackend` over PGlite for tests: the real auth adapter (`SupabaseAuth`) on an
 * `AuthPort` backed by the test database's auth.users and profiles, and a `DbPort` that runs
 * every request as whoever is signed in. Agent runs are replaced by a deterministic writer that
 * inserts a labelled `simulated` reply as the service role, as agent-execute would.
 *
 * Local emulation only (no GoTrue, no PostgREST, no Edge Functions): not a staging result.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { AuthPort, AuthEvent, ProfileRow } from '@/data/supabase/authPort';
import type { DbPort } from '@/data/supabase/dbPort';
import { SupabaseAuth } from '@/data/supabase/auth';
import { SupabaseBackend } from '@/data/supabase/backend';
import type { ServerActions } from '@/data/supabase/api';
import { pgPort } from './pgPort';
import type { TestUser } from './pg';

export async function pgBackend(db: PGlite, password: string, server: ServerActions = {}) {
    let current: TestUser | null = null;
    const listeners = new Set<(e: AuthEvent, id: string | null) => void>();
    const port: AuthPort = {
        async signInWithPassword(email, pw) {
            const row = (await db.query<{ id: string; email: string; confirmed: boolean }>(
                'select id, email, email_confirmed_at is not null as confirmed from auth.users where lower(email) = lower($1)', [email])).rows[0];
            if (!row || pw !== password) return { userId: null, error: { code: 'invalid_credentials', status: 400 } };
            if (!row.confirmed) return { userId: null, error: { code: 'email_not_confirmed', status: 400 } };
            current = { id: row.id, email: row.email };
            return { userId: row.id, error: null };
        },
        signUp: async () => ({ hasSession: false, userId: null, error: { code: 'signup_disabled', status: 422 } }),
        async signOut() {
            current = null;
            for (const l of listeners) l('SIGNED_OUT', null);
        },
        sessionUserId: async () => current?.id ?? null,
        onAuthEvent(l) {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        updatePassword: async () => ({ error: { code: 'not_supported', status: 400 } }),
        sendPasswordReset: async () => ({ error: null }),
        async loadProfile(userId): Promise<ProfileRow | null> {
            const r = (await db.query<{ id: string; name: string; email: string; deactivated_at: string | null }>(
                'select id, name, email, deactivated_at::text from public.profiles where id = $1', [userId])).rows[0];
            return r ? { id: r.id, name: r.name, email: r.email, deactivatedAt: r.deactivated_at } : null;
        },
        updateProfileName: async () => ({ error: null }),
    };
    /** Every request runs as the user signed in at that moment (as supabase-js attaches the session JWT). */
    const sessionPort: DbPort = {
        select: (spec) => as().select(spec),
        insert: (t, row, cols) => as().insert(t, row, cols),
        update: (t, patch, f, cols) => as().update(t, patch, f, cols),
        delete: (t, f) => as().delete(t, f),
        rpc: (fn, args) => as().rpc(fn, args),
    };
    function as(): DbPort {
        // Signed out: requests run as a user id that matches nothing (RLS returns nothing).
        return pgPort(db, current ?? { id: '00000000-0000-4000-8000-000000000000', email: 'anon@example.test' });
    }
    const auth = await SupabaseAuth.create(port, { origin: 'http://127.0.0.1:5173' });
    return new SupabaseBackend(auth, sessionPort, server);
}

/** What agent-execute does for a test: one `simulated` agent reply per user message, as the service role. */
export function simulatedAgentRunner(db: PGlite): ServerActions['runAgents'] {
    return async (messageId) => {
        await db.query(`
            insert into public.messages (brand_id, conversation_id, author_type, author_agent_id, body, mode, reply_to_id)
            select m.brand_id, m.conversation_id, 'agent', c.agent_instance_ids[1], 'Simulated reply (test).', 'simulated', m.id
            from public.messages m join public.conversations c on c.id = m.conversation_id where m.id = $1`, [messageId]);
    };
}
