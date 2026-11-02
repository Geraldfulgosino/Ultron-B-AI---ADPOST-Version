// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { createDb } from './pg';
import { SEED } from './seed';
import { buildStagingRlsSql, CHECKS, parseStagingRlsResults } from './stagingRls';

/** Staging variant: postgres inserts auth.users directly (no auth-admin role switch). */
const stagingSeed = () => SEED.replace('set role supabase_auth_admin;', '').replace(/^reset role;$/m, '');

describe('rollback-only staging RLS script (proven locally before it touches staging)', () => {
    it('parses results whether the API escapes the JSON once, twice or not at all', () => {
        const raw = '{"total": 1, "failed": 0, "results": [{"got": "0", "name": "n", "expect": "0"}]}';
        for (const wrapped of [raw, raw.replace(/"/g, '\\"'), raw.replace(/"/g, '\\\\"')]) {
            expect(parseStagingRlsResults(`ERROR: STAGING_RLS_RESULTS ${wrapped} (SQLSTATE P0001)`)).toEqual(JSON.parse(raw));
        }
    });

    // Opt-in: verifies a captured `supabase db query --linked -f` output from STAGING (not run by default).
    it.runIf(!!process.env.STAGING_RLS_RESULT_FILE)('staging output: every check passed', () => {
        const r = parseStagingRlsResults(readFileSync(process.env.STAGING_RLS_RESULT_FILE!, 'utf8'));
        expect(r.results.filter((x) => x.got !== x.expect)).toEqual([]);
        expect([r.total, r.failed]).toEqual([CHECKS.length, 0]);
    });

    it('passes every check on real Postgres and leaves nothing behind', async () => {
        const db = await createDb();
        const sql = buildStagingRlsSql(stagingSeed());
        const message = await db.exec(sql).then(
            () => 'no exception',
            (e: Error) => e.message,
        );
        await db.exec('rollback').catch(() => {});
        const r = parseStagingRlsResults(message);
        expect(r.results.filter((x) => x.got !== x.expect && !(x.expect === 'ERR' && x.got.startsWith('ERR:')))).toEqual([]);
        expect(r.total).toBe(CHECKS.length);
        expect(r.failed).toBe(0);
        // Rolled back: no synthetic tenant or user remains.
        const left = await db.query<{ n: number }>(`select (select count(*) from public.agencies) + (select count(*) from auth.users) as n`);
        expect(Number(left.rows[0]!.n)).toBe(0);

        if (process.env.STAGING_RLS_OUT) writeFileSync(process.env.STAGING_RLS_OUT, sql);
        await db.close();
    }, 120_000);
});
