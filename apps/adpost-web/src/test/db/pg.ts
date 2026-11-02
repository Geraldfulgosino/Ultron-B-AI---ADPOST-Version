/**
 * Real-Postgres test harness (PGlite = Postgres compiled to WASM, in-process).
 * Emulates the parts of the Supabase platform that our migrations and RLS depend on:
 * roles, auth.uid()/auth.jwt(), auth.users, storage.buckets/objects/foldername,
 * default grants and the supabase_realtime publication.
 *
 * Migrations run as a NON-superuser role WITHOUT BYPASSRLS ("migrator"). That is the
 * worst case for SECURITY DEFINER helpers; Supabase's `postgres` role is at least as capable.
 *
 * This is a local emulation, not Supabase itself: it validates SQL and RLS semantics, not
 * PostgREST, GoTrue, Storage API or Realtime servers. Staging verification is still required.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'supabase', 'migrations');

export const PLATFORM_STUB = /* sql */ `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin noinherit;
create role supabase_storage_admin nologin noinherit;
create role migrator nologin inherit nosuperuser nobypassrls;
grant anon, authenticated, service_role to migrator;
grant supabase_storage_admin to migrator;
grant create on database postgres to migrator;
grant all on schema public to migrator;
grant usage on schema public to anon, authenticated, service_role;

create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, migrator, supabase_auth_admin;

-- auth (GoTrue) ---------------------------------------------------------------
create schema auth authorization supabase_auth_admin;
create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    email_confirmed_at timestamptz,
    created_at timestamptz not null default now()
);
alter table auth.users owner to supabase_auth_admin;
-- Same definitions Supabase ships.
create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, migrator;
grant execute on all functions in schema auth to anon, authenticated, service_role, migrator;
grant references, trigger, select on auth.users to migrator;
grant insert, select, update, delete on auth.users to supabase_auth_admin;

-- storage ---------------------------------------------------------------------
create schema storage authorization supabase_storage_admin;
create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
);
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
end $$;
alter function storage.foldername(text) owner to supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- realtime --------------------------------------------------------------------
create publication supabase_realtime;
alter publication supabase_realtime owner to migrator;

-- Supabase default privileges for objects the migration role creates in public.
alter default privileges for role migrator in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role migrator in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role migrator in schema public grant execute on functions to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/** Fresh database with the platform stub and the given migrations applied (default: all). */
export async function createDb(opts: { only?: (file: string) => boolean } = {}): Promise<PGlite> {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(PLATFORM_STUB);
    // Mutation check: PG_MIGRATION_SKIP=<substring> drops a migration to prove the suite catches its absence.
    const skip = process.env.PG_MIGRATION_SKIP;
    for (const f of migrationFiles().filter(opts.only ?? (() => true)).filter((f) => !skip || !f.includes(skip))) {
        const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
        try {
            await db.exec(`set role migrator;\n${sql}\nreset role;`);
        } catch (e) {
            await db.exec('reset role;').catch(() => {});
            throw new Error(`migration ${f} failed: ${(e as Error).message}`);
        }
    }
    return db;
}

export interface TestUser {
    id: string;
    email: string;
}

/** Run SQL as an authenticated user (same JWT claims Supabase sets for PostgREST). */
export async function as<T = Record<string, unknown>>(db: PGlite, user: TestUser | 'anon' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
    const role = typeof user === 'string' ? user : 'authenticated';
    const claims = typeof user === 'string' ? { role } : { sub: user.id, email: user.email, role: 'authenticated' };
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
    await db.exec(`set role ${role}`);
    try {
        return (await db.query<T>(sql, params)).rows;
    } finally {
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claims', '', false)`);
    }
}

/** Resolves to the Postgres error code if the statement fails, or 'ok'. */
export async function attempt(db: PGlite, user: TestUser | 'anon', sql: string, params: unknown[] = []): Promise<string> {
    try {
        await as(db, user, sql, params);
        return 'ok';
    } catch (e) {
        return (e as { code?: string }).code ?? (e as Error).message;
    }
}
