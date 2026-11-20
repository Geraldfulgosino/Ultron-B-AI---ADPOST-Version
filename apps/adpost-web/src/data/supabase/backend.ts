/**
 * Supabase `Backend` (Phase 17F, F6): `SupabaseAuth` for identity, `supabaseApi` over the
 * repositories for data. One `DbPort` serves every request; supabase-js attaches the signed-in
 * user's JWT itself, so RLS always sees the current user.
 *
 * Change notifications: every successful write notifies subscribers, so `useQuery` lists reload
 * (Realtime on shared tables follows in 17G). Reads never notify.
 */
import type { AuthApi, Backend, BrandApi } from '@/data/contracts';
import { AuthError } from '@/data/errors';
import type { DbPort } from './dbPort';
import { createRepositories } from './repositories';
import { supabaseApi, type ServerActions } from './api';

/** Method names that only read. Anything else is treated as a write. */
const READS = new Set([
    'me', 'listBrands', 'brandBySlug', 'agencyUsage', 'canCreateBrands', 'isPlatformAdmin', 'list', 'bySlug', 'clients', 'overview', 'platformOverview',
    'agencyInvitations', 'audit', 'home', 'get', 'preview', 'messages', 'search', 'projects', 'tasks', 'comments', 'approvals', 'templates',
    'agents', 'usage', 'instructionVersions',
]);

function notifying(api: BrandApi, notify: (topic: string) => void): BrandApi {
    const wrapArea = (area: string, impl: object) =>
        new Proxy(impl, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (typeof value !== 'function' || READS.has(String(prop))) return value;
                return (...args: unknown[]) => {
                    const out = (value as (...a: unknown[]) => unknown).apply(target, args);
                    if (out instanceof Promise) return out.then((r) => (notify(`${area}.${String(prop)}`), r));
                    return out;
                };
            },
        });
    return Object.fromEntries(Object.entries(api).map(([k, v]) => [k, wrapArea(k, v as object)])) as unknown as BrandApi;
}

export class SupabaseBackend implements Backend {
    private readonly listeners = new Set<(topic: string) => void>();

    constructor(readonly auth: AuthApi, private readonly db: DbPort, private readonly server: ServerActions = {}) {}

    api(): BrandApi {
        const session = this.auth.currentSession();
        if (!session) throw new AuthError('Not signed in.');
        const repos = createRepositories(this.db, session.user.id);
        return notifying(supabaseApi({ repos, db: this.db, user: session.user, server: this.server }), (topic) => this.emit(topic));
    }

    subscribe(listener: (topic: string) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(topic: string) {
        for (const l of this.listeners) l(topic);
    }
}
