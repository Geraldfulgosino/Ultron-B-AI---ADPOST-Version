/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_BACKEND?: 'local' | 'supabase';
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
