import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, BrandAccess, BrandApi, Session } from '@/data/contracts';

interface BackendState {
    backend: Backend;
    session: Session | null;
    signIn(email: string, password: string): Promise<void>;
    register(input: { name: string; email: string; password: string }): Promise<void>;
    signOut(): Promise<void>;
}

const BackendContext = createContext<BackendState | null>(null);

export function BackendProvider({ backend, children }: { backend: Backend; children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(() => backend.auth.currentSession());

    const value = useMemo<BackendState>(
        () => ({
            backend,
            session,
            signIn: async (email, password) => setSession(await backend.auth.signIn(email, password)),
            register: async (input) => setSession(await backend.auth.register(input)),
            signOut: async () => {
                await backend.auth.signOut();
                setSession(null);
            },
        }),
        [backend, session],
    );

    return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): BackendState {
    const ctx = useContext(BackendContext);
    if (!ctx) throw new Error('useBackend must be used inside <BackendProvider>');
    return ctx;
}

export function useApi(): BrandApi {
    const { backend, session } = useBackend();
    // Re-bind when the session user changes.
    return useMemo(() => backend.api(), [backend, session?.user.id]);
}

export interface QueryState<T> {
    data: T | undefined;
    error: unknown;
    loading: boolean;
    reload: () => void;
}

/**
 * Minimal async query hook. Re-runs when `deps` change and whenever the backend
 * reports a write (local: table change; Supabase: Realtime), so lists stay live.
 */
export function useQuery<T>(fn: (api: BrandApi) => Promise<T>, deps: React.DependencyList): QueryState<T> {
    const api = useApi();
    const { backend } = useBackend();
    const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
    const [tick, setTick] = useState(0);
    const fnRef = useRef(fn);
    fnRef.current = fn;

    useEffect(() => {
        let cancelled = false;
        setState((s) => ({ ...s, loading: s.data === undefined }));
        fnRef.current(api).then(
            (data) => !cancelled && setState({ data, error: null, loading: false }),
            (error: unknown) => !cancelled && setState({ data: undefined, error, loading: false }),
        );
        return () => {
            cancelled = true;
        };
    }, [api, tick, ...deps]);

    useEffect(() => {
        let queued = false;
        return backend.subscribe(() => {
            if (queued) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                setTick((t) => t + 1);
            });
        });
    }, [backend]);

    const reload = useCallback(() => setTick((t) => t + 1), []);
    return { ...state, reload };
}

/** Wraps a mutation with pending + error state. `run` resolves to the result or undefined on failure. */
export function useAction<A extends unknown[], R>(fn: (api: BrandApi, ...args: A) => Promise<R>) {
    const api = useApi();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const run = useCallback(
        async (...args: A): Promise<R | undefined> => {
            setPending(true);
            setError(null);
            try {
                return await fn(api, ...args);
            } catch (e) {
                setError(e);
                return undefined;
            } finally {
                setPending(false);
            }
        },
        [api, fn],
    );
    return { run, pending, error, clearError: () => setError(null) };
}

// ── Active brand ──────────────────────────────────────────────────────────

const BrandContext = createContext<BrandAccess | null>(null);

export const BrandProvider = BrandContext.Provider;

export function useBrand(): BrandAccess {
    const ctx = useContext(BrandContext);
    if (!ctx) throw new Error('useBrand must be used inside a brand route');
    return ctx;
}

/** Field errors from a ValidationError, or {} for anything else. */
export function fieldErrors(error: unknown): Record<string, string> {
    if (error && typeof error === 'object' && 'fields' in error) return (error as { fields: Record<string, string> }).fields;
    return {};
}
