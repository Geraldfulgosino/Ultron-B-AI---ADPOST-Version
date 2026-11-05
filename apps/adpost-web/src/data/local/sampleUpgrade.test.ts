/** Stored local data gains newly added sample records without losing anything the user created. */
import { createLocalBackend } from './backend';
import { DB_SCHEMA_VERSION } from './db';
import { buildSampleSeed } from './sampleSeed';

const KEY = 'adpost.db.upgrade-test';

describe('sample dataset upgrade on load', () => {
    afterEach(() => localStorage.removeItem(KEY));

    it('adds the 20 demo websites to an older stored snapshot and keeps user data', () => {
        const old = buildSampleSeed().snapshot;
        old.websites = [];
        old.brands.push({ ...old.brands[0]!, id: 'brd_user', slug: 'user-client', name: 'User Client' });
        old.websites.push({ ...buildSampleSeed().snapshot.websites[0]!, id: 'web_user', brandId: 'brd_adpost_pod', name: 'My POD site', domain: 'mine.example.com', websiteUrl: 'https://mine.example.com', isDemo: false, isPrimary: true });
        localStorage.setItem(KEY, JSON.stringify({ v: DB_SCHEMA_VERSION, data: old }));

        const db = createLocalBackend({ persistKey: KEY }).db;
        expect(db.all('websites').filter((w) => w.isDemo)).toHaveLength(20);
        expect(db.find('brands', 'brd_user')?.name).toBe('User Client');
        const pod = db.all('websites').filter((w) => w.brandId === 'brd_adpost_pod');
        expect(pod.map((w) => [w.name, w.isPrimary])).toEqual([['My POD site', true], ['POD — Production', false], ['POD — Staging', false]]);

        // Loading again adds nothing.
        expect(createLocalBackend({ persistKey: KEY }).db.all('websites')).toHaveLength(21);
    });
});
