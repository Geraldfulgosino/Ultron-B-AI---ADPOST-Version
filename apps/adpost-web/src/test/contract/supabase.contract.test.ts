// @vitest-environment node
/**
 * The backend contract suite against `SupabaseBackend` on PGlite (all migrations, RLS on, the
 * synthetic RLS fixture). Same scenarios the local adapter passes. A local emulation of Supabase:
 * staging must still be verified with real JWTs before Supabase mode is enabled.
 */
import type { PGlite } from '@electric-sql/pglite';
import { createDb } from '@/test/db/pg';
import { SEED, U } from '@/test/db/seed';
import { pgBackend, simulatedAgentRunner } from '@/test/db/pgBackend';
import { runBackendContract } from './backendContract';

const PASSWORD = 'synthetic-password';
let db: PGlite;

beforeAll(async () => {
    db = await createDb();
    await db.exec(SEED);
}, 120_000);
afterAll(async () => db?.close());

runBackendContract('Supabase adapter on PGlite', () => pgBackend(db, PASSWORD, { runAgents: simulatedAgentRunner(db) }), {
    password: PASSWORD,
    emails: { podOwner: U.podOwner.email, podViewer: U.podViewer.email, podClient: U.podClient.email, dmdManager: U.dmdManager.email },
});
