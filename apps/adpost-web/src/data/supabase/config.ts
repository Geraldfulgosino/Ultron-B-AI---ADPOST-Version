/**
 * Supabase browser configuration (Phase 17A). Public values only: the project URL and the
 * publishable (anon) key. RLS protects the data; privileged keys must never reach the browser.
 */

/** The only Supabase project this codebase may target (owner-authorized staging, 2026-11-02). */
export const AUTHORIZED_PROJECT_REF = 'ppwkxlwxzutigepaizob';

export type DataProvider = 'mock' | 'supabase';

export interface AppEnv {
    VITE_DATA_PROVIDER?: string;
    /** Deprecated alias from Phases 00–16: 'local' = mock. */
    VITE_BACKEND?: string;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export interface SupabaseConfig {
    url: string;
    publishableKey: string;
    projectRef: string;
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

export function selectProvider(env: AppEnv): DataProvider {
    const raw = (env.VITE_DATA_PROVIDER ?? (env.VITE_BACKEND === 'local' ? 'mock' : env.VITE_BACKEND) ?? 'mock').trim().toLowerCase();
    if (raw === '' || raw === 'mock' || raw === 'local') return 'mock';
    if (raw === 'supabase') return 'supabase';
    throw new ConfigError(`VITE_DATA_PROVIDER must be "mock" or "supabase" (got "${raw}").`);
}

const isPlaceholder = (v: string | undefined) => !v || !v.trim() || /^<.*>$/.test(v.trim()) || /COPY|YOUR[_-]|CHANGEME/i.test(v);

/** Decodes a legacy JWT-style key's role claim without verifying it (only to refuse service keys). */
function legacyJwtRole(key: string): string | null {
    const parts = key.split('.');
    if (parts.length !== 3) return null;
    try {
        const json = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
        return (JSON.parse(json) as { role?: string }).role ?? null;
    } catch {
        return null;
    }
}

/**
 * Validates the public Supabase settings. Error messages name the variable, never its value.
 * Refuses: missing/placeholder values, non-HTTPS URLs, any project other than the authorized
 * staging project, and secret / service-role keys.
 */
export function readSupabaseConfig(env: AppEnv): SupabaseConfig {
    const url = env.VITE_SUPABASE_URL?.trim();
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    const missing = [isPlaceholder(url) && 'VITE_SUPABASE_URL', isPlaceholder(key) && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
    if (missing.length) {
        throw new ConfigError(`Supabase mode needs ${missing.join(' and ')} in apps/adpost-web/.env.local (copy the publishable key from the Supabase dashboard → Project Settings → API Keys).`);
    }

    let parsed: URL;
    try {
        parsed = new URL(url!);
    } catch {
        throw new ConfigError('VITE_SUPABASE_URL is not a valid URL.');
    }
    const ref = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
    if (parsed.protocol !== 'https:' || !ref) {
        throw new ConfigError('VITE_SUPABASE_URL must be https://<project-ref>.supabase.co.');
    }
    if (ref !== AUTHORIZED_PROJECT_REF) {
        throw new ConfigError(`VITE_SUPABASE_URL points at project "${ref}", which is not the authorized staging project (${AUTHORIZED_PROJECT_REF}).`);
    }

    if (key!.startsWith('sb_secret_') || legacyJwtRole(key!) === 'service_role') {
        throw new ConfigError('VITE_SUPABASE_PUBLISHABLE_KEY holds a SECRET / service-role key. Remove it now, rotate it in the Supabase dashboard, and use the publishable key instead.');
    }
    if (!key!.startsWith('sb_publishable_') && legacyJwtRole(key!) !== 'anon') {
        throw new ConfigError('VITE_SUPABASE_PUBLISHABLE_KEY does not look like a Supabase publishable key (sb_publishable_…) or legacy anon key.');
    }

    return { url: parsed.origin, publishableKey: key!, projectRef: ref };
}
