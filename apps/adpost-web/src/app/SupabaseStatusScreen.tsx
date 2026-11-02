import { useEffect, useState } from 'react';
import { checkConnection, type ConnectionStatus } from '@/data/supabase/client';
import type { SupabaseConfig } from '@/data/supabase/config';

/**
 * Shown when VITE_DATA_PROVIDER=supabase but the app cannot (or may not yet) run on Supabase.
 * It never renders protected UI and never displays key values.
 */
export function SupabaseStatusScreen({ config, error, adapterReady }: { config: SupabaseConfig | null; error: string | null; adapterReady: boolean }) {
    const [status, setStatus] = useState<ConnectionStatus | null>(null);
    useEffect(() => {
        if (!config) return;
        let live = true;
        void checkConnection(config).then((s) => live && setStatus(s));
        return () => {
            live = false;
        };
    }, [config]);

    return (
        <main className="min-h-screen bg-canvas px-4 py-16">
            <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-line bg-surface p-6">
                <h1 className="text-lg font-semibold text-fg">Supabase mode</h1>
                {error ? (
                    <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>
                ) : (
                    <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                        <dt className="text-fg-muted">Project</dt>
                        <dd className="font-mono text-fg">{config?.projectRef}</dd>
                        <dt className="text-fg-muted">Connection</dt>
                        <dd className="text-fg" aria-live="polite">
                            {status === null ? 'Checking…' : status.state === 'ok' ? `Reachable (${status.latencyMs} ms)` : status.state === 'rejected' ? `Rejected (HTTP ${status.httpStatus})` : `Unreachable: ${status.detail}`}
                        </dd>
                        <dt className="text-fg-muted">Data adapter</dt>
                        <dd className="text-fg">{adapterReady ? 'Ready' : 'Not enabled yet (Phase 17 in progress)'}</dd>
                    </dl>
                )}
                <p className="text-sm text-fg-soft">
                    Set <code className="font-mono">VITE_DATA_PROVIDER=mock</code> in <code className="font-mono">apps/adpost-web/.env.local</code> to use the local simulated backend.
                </p>
            </div>
        </main>
    );
}
