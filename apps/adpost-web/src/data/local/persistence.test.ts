import { createLocalBackend, hashPassword } from './backend';
import { DB_SCHEMA_VERSION, LocalDatabase } from './db';
import { AuthError } from '../errors';
import { IDS } from '@/test/helpers';

const KEY = 'test.db';

describe('local persistence', () => {
    it('keeps registered users (hashed) across reloads', async () => {
        const a = createLocalBackend({ persistKey: KEY });
        await a.auth.register({ name: 'New Person', email: 'New@Example.test', password: 'long-enough-pw' });
        const stored = JSON.parse(localStorage.getItem(`${KEY}.credentials`)!) as Record<string, string>;
        expect(stored['new@example.test']).toBe(await hashPassword('new@example.test', 'long-enough-pw'));
        expect(JSON.stringify(stored)).not.toContain('long-enough-pw');
        expect(Object.keys(stored)).toEqual(['new@example.test']); // fixture creds are not written

        const b = createLocalBackend({ persistKey: KEY });
        await expect(b.auth.signIn('new@example.test', 'wrong')).rejects.toBeInstanceOf(AuthError);
        expect((await b.auth.signIn('new@example.test', 'long-enough-pw')).user.name).toBe('New Person');
    });

    it('persists writes and discards snapshots from another schema version', async () => {
        const reload = async () => {
            const b = createLocalBackend({ persistKey: KEY });
            await b.auth.signIn('priya@pod.example.test', 'adpost-dev');
            return b.api();
        };
        await (await reload()).clients.create(IDS.brands.pod, { name: 'Persisted Client' });
        expect((await (await reload()).clients.list(IDS.brands.pod)).map((c) => c.name)).toContain('Persisted Client');

        const raw = JSON.parse(localStorage.getItem(KEY)!) as { v: number };
        expect(raw.v).toBe(DB_SCHEMA_VERSION);
        localStorage.setItem(KEY, JSON.stringify({ ...raw, v: DB_SCHEMA_VERSION - 1 }));
        expect((await (await reload()).clients.list(IDS.brands.pod)).map((c) => c.name)).not.toContain('Persisted Client');
    });

    it('reset() wipes stored data and credentials', () => {
        localStorage.setItem(KEY, '{}');
        localStorage.setItem(`${KEY}.credentials`, '{}');
        LocalDatabase.reset(KEY);
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(localStorage.getItem(`${KEY}.credentials`)).toBeNull();
    });
});
