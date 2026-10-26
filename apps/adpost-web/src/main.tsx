import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/routes';
import { BackendProvider } from '@/app/backend';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { createLocalBackend, LOCAL_PERSIST_KEY } from '@/data/local/backend';
import './index.css';

// Only the local adapter exists until Phase 17 (Supabase). VITE_BACKEND selects it.
const mode = import.meta.env.VITE_BACKEND ?? 'local';
if (mode !== 'local') throw new Error(`Unsupported VITE_BACKEND "${mode}". Only "local" is available before Phase 17.`);

const backend = createLocalBackend({ persistKey: LOCAL_PERSIST_KEY, persistSession: true });
const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ThemeProvider>
            <BackendProvider backend={backend}>
                <RouterProvider router={router} />
            </BackendProvider>
        </ThemeProvider>
    </StrictMode>,
);
