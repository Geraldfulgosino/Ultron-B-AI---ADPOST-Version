import type { SupabaseClient } from '@supabase/supabase-js';
import { assertIdentifier, contains, eq, inList, isNull, lt, supabaseDbPort } from './dbPort';

/** Records the supabase-js builder chain and resolves with a scripted result. */
function stubClient(result: unknown, opts: { throws?: boolean } = {}) {
    const calls: Array<[string, ...unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'ilike', 'order', 'range', 'insert', 'update', 'delete', 'single']) {
        builder[m] = (...args: unknown[]) => {
            calls.push([m, ...args]);
            return builder;
        };
    }
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        opts.throws ? Promise.reject(new TypeError('Failed to fetch')).then(resolve, reject) : Promise.resolve(result).then(resolve, reject);
    const client = {
        from: (t: string) => {
            calls.push(['from', t]);
            return builder;
        },
        rpc: (fn: string, args: unknown) => {
            calls.push(['rpc', fn, args]);
            return builder;
        },
    } as unknown as SupabaseClient;
    return { client, calls };
}

describe('supabaseDbPort', () => {
    it('translates a select with filters, order, range and count', async () => {
        const { client, calls } = stubClient({ data: [{ id: 'a' }], error: null, count: 7, status: 200 });
        const res = await supabaseDbPort(client).select({
            table: 'brands',
            columns: ['id', 'name'],
            filters: [eq('agency_id', 'agy'), inList('id', ['a', 'b']), isNull('archived_at'), lt('created_at', '2026-01-01'), contains('name', '50%_off')],
            order: [{ column: 'name' }, { column: 'id', ascending: false }],
            range: { from: 25, to: 49 },
            count: true,
        });
        expect(res).toEqual({ rows: [{ id: 'a' }], count: 7, error: null });
        expect(calls).toEqual([
            ['from', 'brands'],
            ['select', 'id,name', { count: 'exact' }],
            ['eq', 'agency_id', 'agy'],
            ['in', 'id', ['a', 'b']],
            ['is', 'archived_at', null],
            ['lt', 'created_at', '2026-01-01'],
            ['ilike', 'name', '%50\\%\\_off%'],
            ['order', 'name', { ascending: true }],
            ['order', 'id', { ascending: false }],
            ['range', 25, 49],
        ]);
    });

    it('inserts without reading back when no columns are requested', async () => {
        const { client, calls } = stubClient({ data: null, error: null, status: 201 });
        expect(await supabaseDbPort(client).insert('conversations', { id: 'c1', title: 'x' }, [])).toEqual({ row: null, error: null });
        expect(calls).toEqual([['from', 'conversations'], ['insert', { id: 'c1', title: 'x' }]]);
    });

    it('passes error codes and statuses, never messages', async () => {
        const { client } = stubClient({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "brands"', details: 'secret detail' }, status: 403 });
        const res = await supabaseDbPort(client).update('brands', { name: 'x' }, [eq('id', 'b')], ['id']);
        expect(res).toEqual({ rows: [], error: { code: '42501', status: 403 } });
        expect(JSON.stringify(res)).not.toContain('row-level');
    });

    it('turns a thrown network error into a transport error, not an empty result', async () => {
        const { client } = stubClient(null, { throws: true });
        const res = await supabaseDbPort(client).select({ table: 'agencies', columns: ['id'] });
        expect(res.error).toEqual({ code: 'network', status: 0 });
    });

    it('calls RPCs by name with named arguments', async () => {
        const { client, calls } = stubClient({ data: 'lipsky', error: null, status: 200 });
        expect(await supabaseDbPort(client).rpc('accept_invitation', { p_token: 't' })).toEqual({ data: 'lipsky', error: null });
        expect(calls[0]).toEqual(['rpc', 'accept_invitation', { p_token: 't' }]);
    });

    it('rejects anything but plain identifiers for tables, columns and functions', async () => {
        for (const bad of ['brands;drop table x', 'Brands', 'a.b', 'name,secret', '']) expect(() => assertIdentifier(bad)).toThrow('Invalid identifier');
        const { client } = stubClient({ data: [], error: null });
        await expect(supabaseDbPort(client).select({ table: 'brands', columns: ['id', 'secret)'] })).rejects.toThrow('Invalid identifier');
    });
});
