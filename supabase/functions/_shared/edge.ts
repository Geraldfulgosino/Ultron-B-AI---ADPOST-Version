/**
 * Deno-only helpers shared by the Edge Function entry points: CORS, auth and clients.
 * NOT imported by tests or the browser. Secrets are read from the Edge runtime
 * environment (supabase secrets); nothing here logs or returns them.
 */
// @ts-nocheck: Deno runtime file (npm: specifier, Deno globals); type-checked by `supabase functions deploy`.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
    const origin = req.headers.get('origin') ?? '';
    return {
        'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? '',
        'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS',
        vary: 'origin',
    };
}

export function json(req: Request, status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json' } });
}

/** Caller-scoped client (RLS as the user) and the server-only service client. */
export async function clientsFor(req: Request) {
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) throw new Error('Edge runtime is missing Supabase configuration.');
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = auth.startsWith('Bearer ') ? await user.auth.getUser() : { data: { user: null }, error: null };
    return { user, admin, userId: error ? null : data.user?.id ?? null };
}

/** Public-DNS resolver for the SEO fetcher. An empty answer makes the fetch refuse. */
export async function resolveDns(host: string): Promise<string[]> {
    const out: string[] = [];
    for (const type of ['A', 'AAAA']) {
        try {
            out.push(...(await Deno.resolveDns(host, type)));
        } catch {
            // NXDOMAIN or unsupported record type: ignore this family.
        }
    }
    return out;
}

export const env = (name: string) => Deno.env.get(name);
