/**
 * Narrow database port for the Supabase data adapter (Phase 17F). Repositories describe
 * PostgREST-shaped requests (table, columns, filters, order, range); `supabaseDbPort` is the only
 * code that turns them into supabase-js calls. Every request runs as the signed-in user, so RLS
 * decides what is visible: the port never adds a privilege and never holds a token.
 *
 * Tests run the same repositories through a Postgres implementation of this port
 * (src/test/db/pgPort.ts) against the real migrations, with RLS on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type FilterOp = 'eq' | 'neq' | 'in' | 'is' | 'gt' | 'gte' | 'lt' | 'lte' | 'ilike';
export type FilterValue = string | number | boolean | null | readonly string[];

export interface Filter {
    column: string;
    op: FilterOp;
    value: FilterValue;
}

export interface SelectSpec {
    table: string;
    columns: readonly string[];
    filters?: readonly Filter[];
    order?: ReadonlyArray<{ column: string; ascending?: boolean }>;
    /** Inclusive row range, like PostgREST `Range`. */
    range?: { from: number; to: number };
    /** Also return the total number of matching rows (ignores `range`). */
    count?: boolean;
}

/** Error code and HTTP status only. The raw message stays inside the adapter (never shown). */
export interface DbError {
    code?: string;
    status?: number;
}

export interface DbPort {
    select<R>(spec: SelectSpec): Promise<{ rows: R[]; count: number | null; error: DbError | null }>;
    /** With no `columns`, nothing is read back (PostgREST `return=minimal`) and `row` is null. */
    insert<R>(table: string, row: Record<string, unknown>, columns: readonly string[]): Promise<{ row: R | null; error: DbError | null }>;
    /** Rows RLS hides are not updated and not returned (0 rows, no error), as in PostgREST. */
    update<R>(table: string, patch: Record<string, unknown>, filters: readonly Filter[], columns: readonly string[]): Promise<{ rows: R[]; error: DbError | null }>;
    delete(table: string, filters: readonly Filter[]): Promise<{ count: number; error: DbError | null }>;
    rpc<R>(fn: string, args: Record<string, unknown>): Promise<{ data: R | null; error: DbError | null }>;
}

export const eq = (column: string, value: FilterValue): Filter => ({ column, op: 'eq', value });
export const neq = (column: string, value: FilterValue): Filter => ({ column, op: 'neq', value });
export const inList = (column: string, value: readonly string[]): Filter => ({ column, op: 'in', value });
export const isNull = (column: string): Filter => ({ column, op: 'is', value: null });
export const lt = (column: string, value: string | number): Filter => ({ column, op: 'lt', value });
/** Case-insensitive "contains"; `%`, `_` and `\` in the term match literally. */
export const contains = (column: string, term: string): Filter => ({ column, op: 'ilike', value: `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });

const IDENT = /^[a-z_][a-z0-9_]*$/;
/** Identifiers come from repository constants, never from user input; checked anyway. */
export function assertIdentifier(name: string): string {
    if (!IDENT.test(name)) throw new Error(`Invalid identifier: ${name}`);
    return name;
}

const toError = (e: { code?: string; status?: number } | null | undefined, status?: number): DbError | null =>
    e ? { code: e.code || undefined, status: e.status ?? status } : null;

/** A thrown fetch error (offline, DNS, CORS) becomes a transport error, not an empty result. */
const transport = (): DbError => ({ code: 'network', status: 0 });

type Builder = {
    eq(c: string, v: unknown): Builder;
    neq(c: string, v: unknown): Builder;
    in(c: string, v: readonly unknown[]): Builder;
    is(c: string, v: null | boolean): Builder;
    gt(c: string, v: unknown): Builder;
    gte(c: string, v: unknown): Builder;
    lt(c: string, v: unknown): Builder;
    lte(c: string, v: unknown): Builder;
    ilike(c: string, v: string): Builder;
    order(c: string, o: { ascending: boolean }): Builder;
    range(from: number, to: number): Builder;
    select(columns: string): Builder;
};

function applyFilters<B extends Builder>(q: B, filters: readonly Filter[] = []): B {
    let b: Builder = q;
    for (const f of filters) {
        const c = assertIdentifier(f.column);
        switch (f.op) {
            case 'in': b = b.in(c, f.value as readonly string[]); break;
            case 'is': b = b.is(c, f.value as null | boolean); break;
            case 'ilike': b = b.ilike(c, String(f.value)); break;
            default: b = b[f.op](c, f.value);
        }
    }
    return b as B;
}

type Result<D> = { data: D | null; error: { code?: string } | null; count?: number | null; status?: number };

export function supabaseDbPort(client: SupabaseClient): DbPort {
    // supabase-js builders are thenables with a chainable API; the narrow `Builder` type above is
    // what the repositories may use.
    const from = (table: string) => client.from(assertIdentifier(table)) as unknown as {
        select(columns: string, opts?: { count?: 'exact' }): Builder & PromiseLike<Result<unknown[]>>;
        insert(row: Record<string, unknown>): PromiseLike<Result<unknown>> & { select(columns: string): { single(): PromiseLike<Result<unknown>> } };
        update(patch: Record<string, unknown>): Builder & PromiseLike<Result<unknown[]>>;
        delete(opts: { count: 'exact' }): Builder & PromiseLike<Result<unknown>>;
    };
    const cols = (columns: readonly string[]) => columns.map(assertIdentifier).join(',');
    const run = async <D>(p: PromiseLike<Result<D>>) => {
        try {
            return await p;
        } catch {
            return { data: null, error: transport(), count: null, status: 0 } as Result<D>;
        }
    };

    return {
        async select<R>(spec: SelectSpec) {
            let q: Builder = applyFilters(from(spec.table).select(cols(spec.columns), spec.count ? { count: 'exact' } : undefined), spec.filters);
            for (const o of spec.order ?? []) q = q.order(assertIdentifier(o.column), { ascending: o.ascending ?? true });
            if (spec.range) q = q.range(spec.range.from, spec.range.to);
            const res = await run(q as unknown as PromiseLike<Result<R[]>>);
            return { rows: (res.data ?? []) as R[], count: res.count ?? null, error: toError(res.error, res.status) };
        },
        async insert<R>(table: string, row: Record<string, unknown>, columns: readonly string[]) {
            const q = from(table).insert(row);
            const res = await run((columns.length ? q.select(cols(columns)).single() : q) as PromiseLike<Result<R>>);
            return { row: (res.data ?? null) as R | null, error: toError(res.error, res.status) };
        },
        async update<R>(table: string, patch: Record<string, unknown>, filters: readonly Filter[], columns: readonly string[]) {
            const q = applyFilters(from(table).update(patch), filters).select(cols(columns));
            const res = await run(q as unknown as PromiseLike<Result<R[]>>);
            return { rows: (res.data ?? []) as R[], error: toError(res.error, res.status) };
        },
        async delete(table: string, filters: readonly Filter[]) {
            const res = await run(applyFilters(from(table).delete({ count: 'exact' }), filters) as unknown as PromiseLike<Result<unknown>>);
            return { count: res.count ?? 0, error: toError(res.error, res.status) };
        },
        async rpc<R>(fn: string, args: Record<string, unknown>) {
            const res = await run(client.rpc(assertIdentifier(fn), args) as unknown as PromiseLike<Result<R>>);
            return { data: (res.data ?? null) as R | null, error: toError(res.error, res.status) };
        },
    };
}
