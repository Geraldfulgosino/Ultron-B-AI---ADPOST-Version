/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** "mock" (default) or "supabase". See src/data/supabase/config.ts. */
    readonly VITE_DATA_PROVIDER?: string;
    /** Deprecated alias (Phases 00–16): "local" = mock. */
    readonly VITE_BACKEND?: string;
    /** Public: https://<project-ref>.supabase.co */
    readonly VITE_SUPABASE_URL?: string;
    /** Public publishable/anon key. Never a secret or service-role key. */
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
