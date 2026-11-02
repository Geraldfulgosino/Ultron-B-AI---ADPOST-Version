import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/routes';
import { BackendProvider } from '@/app/backend';
import { SupabaseStatusScreen } from '@/app/SupabaseStatusScreen';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { createLocalBackend, LOCAL_PERSIST_KEY } from '@/data/local/backend';
import { ConfigError, readSupabaseConfig, selectProvider, type SupabaseConfig } from '@/data/supabase/config';
import './index.css';

/**
 * VITE_DATA_PROVIDER selects the backend: "mock" (default, in-browser simulation) or "supabase".
 * Supabase mode does not mount the app until its adapter has passed the security test gate
 * (docs/development/PHASE17_STAGING_RUNBOOK.md); until then it shows a status screen.
 */
const SUPABASE_ADAPTER_READY = false;

function renderApp() {
    const backend = createLocalBackend({ persistKey: LOCAL_PERSIST_KEY, persistSession: true });
    const router = createBrowserRouter(routes);
    return (
        <BackendProvider backend={backend}>
            <RouterProvider router={router} />
        </BackendProvider>
    );
}

function renderSupabase() {
    let config: SupabaseConfig | null = null;
    let error: string | null = null;
    try {
        config = readSupabaseConfig(import.meta.env);
    } catch (e) {
        error = e instanceof ConfigError ? e.message : 'Supabase configuration could not be read.';
    }
    return <SupabaseStatusScreen config={config} error={error} adapterReady={SUPABASE_ADAPTER_READY} />;
}

let body: React.ReactNode;
try {
    body = selectProvider(import.meta.env) === 'supabase' ? renderSupabase() : renderApp();
} catch (e) {
    body = <SupabaseStatusScreen config={null} error={(e as Error).message} adapterReady={false} />;
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ThemeProvider>{body}</ThemeProvider>
    </StrictMode>,
);
