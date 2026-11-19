/**
 * `DbPort` over PGlite, for tests. Each call runs as the given user with the same JWT claims
 * Supabase sets for PostgREST, so the repositories meet the real migrations and RLS. Date and
 * timestamp values come back as text, as PostgREST returns them.
 *
 * A local emulation of PostgREST's request shapes, not PostgREST itself: staging verification
 * is still required before Supabase mode is enabled.
 */
import type { PGlite } from '@electric-sql/pglite';
import { assertIdentifier, type DbError, type DbPort, type Filter } from '@/data/supabase/dbPort';
import type { TestUser } from './pg';

const OID_DATE = 1082;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const asText = (v: string) => v;
const PARSERS = { [OID_DATE]: asText, [OID_TIMESTAMP]: asText, [OID_TIMESTAMPTZ]: asText };

const OPS: Record<Exclude<Filter['op'], 'in' | 'is'>, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', ilike: 'ilike' };

function where(filters: readonly Filter[] = [], params: unknown[]): string {
    const parts = filters.map((f) => {
        const c = assertIdentifier(f.column);
        if (f.op === 'is') return f.value === null ? `${c} is null` : `${c} is ${f.value ? 'true' : 'false'}`;
        params.push(f.value);
        if (f.op === 'in') return `${c} = any($${params.length})`;
        return `${c} ${OPS[f.op]} $${params.length}`;
    });
    return parts.length ? ` where ${parts.join(' and ')}` : '';
}

/** Counts the calls made, so tests can show that nothing silently succeeded without a query. */
export function pgPort(db: PGlite, user: TestUser, calls: string[] = []): DbPort {
    const run = async <T>(sql: string, params: unknown[]): Promise<{ rows: T[]; error: DbError | null }> => {
        calls.push(sql.split(' ').slice(0, 3).join(' '));
        await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' })]);
        await db.exec('set role authenticated');
        try {
            return { rows: (await db.query<T>(sql, params, { parsers: PARSERS })).rows, error: null };
        } catch (e) {
            return { rows: [], error: { code: (e as { code?: string }).code ?? 'unknown' } };
        } finally {
            await db.exec('reset role');
            await db.query(`select set_config('request.jwt.claims', '', false)`);
        }
    };
    const cols = (columns: readonly string[]) => columns.map(assertIdentifier).join(', ');
    const table = (t: string) => `public.${assertIdentifier(t)}`;

    return {
        async select<R>(spec: Parameters<DbPort['select']>[0]) {
            const params: unknown[] = [];
            const filter = where(spec.filters, params);
            const order = spec.order?.length ? ` order by ${spec.order.map((o) => `${assertIdentifier(o.column)} ${o.ascending === false ? 'desc' : 'asc'}`).join(', ')}` : '';
            const range = spec.range ? ` limit ${spec.range.to - spec.range.from + 1} offset ${spec.range.from}` : '';
            const res = await run<R>(`select ${cols(spec.columns)} from ${table(spec.table)}${filter}${order}${range}`, params);
            if (res.error || !spec.count) return { rows: res.rows, count: null, error: res.error };
            const total = await run<{ n: number }>(`select count(*)::int as n from ${table(spec.table)}${filter}`, params);
            return { rows: res.rows, count: total.rows[0]?.n ?? null, error: total.error };
        },
        async insert<R>(t: string, row: Record<string, unknown>, columns: readonly string[]) {
            const keys = Object.keys(row).map(assertIdentifier);
            const params = Object.values(row);
            const returning = columns.length ? ` returning ${cols(columns)}` : '';
            const res = await run<R>(`insert into ${table(t)} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})${returning}`, params);
            return { row: res.rows[0] ?? null, error: res.error };
        },
        async update<R>(t: string, patch: Record<string, unknown>, filters: readonly Filter[], columns: readonly string[]) {
            const params = Object.values(patch);
            const set = Object.keys(patch).map((k, i) => `${assertIdentifier(k)} = $${i + 1}`).join(', ');
            const res = await run<R>(`update ${table(t)} set ${set}${where(filters, params)} returning ${cols(columns)}`, params);
            return { rows: res.rows, error: res.error };
        },
        async delete(t: string, filters: readonly Filter[]) {
            const params: unknown[] = [];
            const res = await run<{ one: number }>(`delete from ${table(t)}${where(filters, params)} returning 1 as one`, params);
            return { count: res.rows.length, error: res.error };
        },
        async rpc<R>(fn: string, args: Record<string, unknown>) {
            const names = Object.keys(args).map(assertIdentifier);
            const res = await run<Record<string, unknown>>(`select * from public.${assertIdentifier(fn)}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`, Object.values(args));
            if (res.error) return { data: null, error: res.error };
            // PostgREST returns a scalar for scalar functions and rows for set-returning ones.
            const scalar = res.rows.length === 1 && Object.keys(res.rows[0]!).length === 1 && fn in res.rows[0]!;
            return { data: (scalar ? res.rows[0]![fn] : res.rows) as R, error: null };
        },
    };
}
