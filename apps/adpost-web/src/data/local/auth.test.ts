import { AuthError, ValidationError } from '@/data/errors';
import { LocalBackend } from '@/data/local/backend';
import { DEV_PASSWORD } from '@/data/local/fixtures';
import { IDS, testDb } from '@/test/helpers';

async function signedIn(user: keyof typeof IDS.users) {
    const db = testDb();
    const backend = new LocalBackend(db);
    await backend.auth.signIn(db.find('users', IDS.users[user])!.email, DEV_PASSWORD);
    return { db, backend };
}

describe('LocalBackend auth: Phase 17E contract additions', () => {
    it('accepts a reset request for any valid email without revealing whether it exists', async () => {
        const backend = new LocalBackend(testDb());
        await expect(backend.auth.requestPasswordReset('alex@adpost.example.test')).resolves.toBeUndefined();
        await expect(backend.auth.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
        await expect(backend.auth.requestPasswordReset('not-an-email')).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses to complete a reset (no recovery links in local mode)', async () => {
        const { backend } = await signedIn('alex');
        await expect(backend.auth.completePasswordReset('brand-new-pass')).rejects.toBeInstanceOf(AuthError);
    });

    it('ends the session of a user suspended while signed in and notifies listeners', async () => {
        const { db, backend } = await signedIn('priya');
        const seen: unknown[] = [];
        backend.auth.onSessionChange((s) => seen.push(s));
        // What a Super Admin's suspension writes (profiles.deactivated_at).
        db.patch('users', IDS.users.priya, { deactivatedAt: db.nowIso() });
        expect(seen).toEqual([null]);
        expect(backend.auth.currentSession()).toBeNull();
        expect(() => backend.api()).toThrow(AuthError);
    });

    it('leaves other users signed in when someone else changes', async () => {
        const { db, backend } = await signedIn('priya');
        const seen: unknown[] = [];
        const off = backend.auth.onSessionChange((s) => seen.push(s));
        db.patch('users', IDS.users.dana, { deactivatedAt: db.nowIso() });
        off();
        db.patch('users', IDS.users.priya, { deactivatedAt: db.nowIso() });
        expect(seen).toEqual([]);
    });
});
