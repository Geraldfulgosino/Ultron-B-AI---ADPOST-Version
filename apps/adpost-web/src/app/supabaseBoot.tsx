/**
 * Supabase start-up (Phase 17F, F9). Nothing protected renders until this finishes:
 *  1. validated configuration (readSupabaseConfig: project-ref guard, no secret keys);
 *  2. one browser client;
 *  3. session restore (createSupabaseAuth drops suspended or removed accounts);
 *  4–7. for a signed-in user: memberships → role → permitted agencies and clients, through
 *       `users.home()` (RLS-filtered). A failure here shows an error with Retry, never a guess;
 *  8. the website scope is chosen per client by the workspace selector, which only accepts
 *     websites of the current client;
 *  9. repositories are created per request from the session's user id;
 *  10. the router mounts.
 * Gated by SUPABASE_ADAPTER_READY in main.tsx until staging is verified.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { routes } from '@/app/routes';
import { BackendProvider } from '@/app/backend';
import { LoadingState } from '@/components/ui';
import { readSupabaseConfig, type AppEnv, type SupabaseConfig } from '@/data/supabase/config';
import { createSupabaseBrowserClient } from '@/data/supabase/client';
import { createSupabaseAuth } from '@/data/supabase/auth';
import { supabaseAuthPort } from '@/data/supabase/authPort';
import { supabaseDbPort } from '@/data/supabase/dbPort';
import { SupabaseBackend } from '@/data/supabase/backend';
import type { ServerActions } from '@/data/supabase/api';
import { createIntegrationsClient } from '@/data/supabase/integrationsClient';

export interface BootDeps {
    env: AppEnv;
    origin: string;
    createClient?: (config: SupabaseConfig) => SupabaseClient;
    fetch?: typeof fetch;
}

/**
 * Edge Function calls. The access token is read from supabase-js at call time and goes only
 * into the Authorization header of a request to this project's own functions endpoint.
 */
export function edgeServerActions(config: SupabaseConfig, client: SupabaseClient, origin: string, doFetch: typeof fetch = fetch): ServerActions {
    const accessToken = async () => (await client.auth.getSession()).data.session?.access_token ?? null;
    const call = async (fn: 'agent-execute' | 'user-invite', body: Record<string, unknown>) => {
        const token = await accessToken();
        if (!token) throw new Error('Sign in again to continue.');
        const res = await doFetch(`${config.url}/functions/v1/${fn}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, apikey: config.publishableKey, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const json = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(json?.error ?? `Request failed (HTTP ${res.status}).`);
        }
    };
    const integrations = createIntegrationsClient({ config, accessToken, fetch: doFetch });
    return {
        // The message id doubles as the idempotency key: a retried request never runs agents twice.
        runAgents: (messageId) => call('agent-execute', { messageId, idempotencyKey: messageId }),
        deliverInvitation: (input) => call('user-invite', { ...input, appOrigin: origin }),
        disconnectIntegration: async (websiteId, provider) => {
            await integrations.disconnect(websiteId, provider);
        },
        completeGoogle: async (query) => {
            const r = await integrations.completeGoogle(query);
            if (r.provider !== 'google_analytics' && r.provider !== 'google_search_console') throw new Error('Unexpected provider.');
            return { websiteId: r.websiteId, provider: r.provider };
        },
    };
}

export async function bootSupabase(deps: BootDeps): Promise<SupabaseBackend> {
    const config = readSupabaseConfig(deps.env);
    const client = (deps.createClient ?? createSupabaseBrowserClient)(config);
    const auth = await createSupabaseAuth(supabaseAuthPort(client), { origin: deps.origin });
    const backend = new SupabaseBackend(auth, supabaseDbPort(client), edgeServerActions(config, client, deps.origin, deps.fetch));
    // Resolve the signed-in user's roles once before any route renders: an unreachable database
    // or a broken policy surfaces here as an error screen, not as an empty workspace.
    if (auth.currentSession()) await backend.api().users.home();
    return backend;
}

type BootState = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; backend: SupabaseBackend };

/** Mounts the app on Supabase once `boot` resolves. Shows only a loading or error screen before that. */
export function SupabaseRoot({ boot }: { boot: () => Promise<SupabaseBackend> }) {
    const [state, setState] = useState<BootState>({ state: 'loading' });
    const [router] = useState(() => ({ current: null as ReturnType<typeof createBrowserRouter> | null }));
    const start = useCallback(() => {
        setState({ state: 'loading' });
        boot().then(
            (backend) => setState({ state: 'ready', backend }),
            (e: unknown) => setState({ state: 'error', message: e instanceof Error && e.name === 'ConfigError' ? e.message : 'ULTRON-B AI could not start. Check your connection and try again.' }),
        );
    }, [boot]);
    useEffect(start, [start]);

    if (state.state === 'loading') {
        return (
            <main id="main" className="min-h-screen bg-canvas">
                <LoadingState label="Restoring your session…" />
            </main>
        );
    }
    if (state.state === 'error') {
        return (
            <main id="main" className="min-h-screen bg-canvas px-4 py-16">
                <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-line bg-surface p-6">
                    <h1 className="text-lg font-semibold text-fg">Unable to start</h1>
                    <p role="alert" className="text-sm text-danger-ink">{state.message}</p>
                    <button type="button" className="text-sm font-medium text-accent hover:text-accent-strong" onClick={start}>Try again</button>
                </div>
            </main>
        );
    }
    router.current ??= createBrowserRouter(routes);
    return (
        <BackendProvider backend={state.backend}>
            <RouterProvider router={router.current} />
        </BackendProvider>
    );
}
