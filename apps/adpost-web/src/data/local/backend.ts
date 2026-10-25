import type { ID } from '@/domain/types';
import type { AuthApi, Backend, BrandApi, Session } from '../contracts';
import { AuthError } from '../errors';
import { LocalDatabase, type LocalDatabaseOptions } from './db';
import { Scope } from './scope';
import { localWorkspace } from './workspace';
import { localClients, localWebsites } from './management';
import { buildFixtures } from './fixtures';

/** Assemble the full API for one user. Exported for tests (no auth round-trip needed). */
export function apiFor(db: LocalDatabase, userId: ID): BrandApi {
    const scope = new Scope(db, userId);
    return {
        workspace: localWorkspace(scope),
        clients: localClients(scope),
        websites: localWebsites(scope),
    };
}

const SESSION_KEY = 'adpost.session.v1';

export class LocalBackend implements Backend {
    private session: Session | null = null;
    readonly auth: AuthApi;

    constructor(readonly db: LocalDatabase, private readonly persistSession = false) {
        this.session = this.restore();
        this.auth = {
            signIn: async (email, password) => {
                const normalized = email.trim().toLowerCase();
                const user = db.all('users').find((u) => u.email.toLowerCase() === normalized);
                // Same message for unknown email and wrong password (no account enumeration).
                if (!user || db.credentials[normalized] !== password) throw new AuthError('These credentials do not match our records.');
                this.session = { user: structuredClone(user) };
                this.store();
                return structuredClone(this.session);
            },
            signOut: async () => {
                this.session = null;
                this.store();
            },
            currentSession: () => (this.session ? structuredClone(this.session) : null),
        };
    }

    api(): BrandApi {
        if (!this.session) throw new AuthError('Not signed in.');
        return apiFor(this.db, this.session.user.id);
    }

    subscribe(listener: (topic: string) => void): () => void {
        return this.db.subscribe(listener);
    }

    private restore(): Session | null {
        if (!this.persistSession) return null;
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const { userId } = JSON.parse(raw) as { userId: string };
            const user = this.db.find('users', userId);
            return user ? { user: structuredClone(user) } : null;
        } catch {
            return null;
        }
    }

    private store(): void {
        if (!this.persistSession) return;
        try {
            if (this.session) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: this.session.user.id }));
            else sessionStorage.removeItem(SESSION_KEY);
        } catch {
            // ignore
        }
    }
}

export function createLocalBackend(options: LocalDatabaseOptions & { persistSession?: boolean } = {}): LocalBackend {
    const { snapshot, credentials } = buildFixtures();
    return new LocalBackend(new LocalDatabase(snapshot, credentials, options), options.persistSession);
}
