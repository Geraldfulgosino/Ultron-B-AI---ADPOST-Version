import { LocalDatabase } from '@/data/local/db';
import { buildFixtures, FIXTURE_IDS } from '@/data/local/fixtures';
import { apiFor } from '@/data/local/backend';

export const IDS = FIXTURE_IDS;

export function testDb(): LocalDatabase {
    const { snapshot, credentials } = buildFixtures();
    return new LocalDatabase(snapshot, credentials, { now: () => new Date('2026-10-25T12:00:00.000Z') });
}

/** API for a fixture user against a fresh db. */
export function as(user: keyof typeof FIXTURE_IDS.users, db = testDb()) {
    return { api: apiFor(db, FIXTURE_IDS.users[user]), db };
}
