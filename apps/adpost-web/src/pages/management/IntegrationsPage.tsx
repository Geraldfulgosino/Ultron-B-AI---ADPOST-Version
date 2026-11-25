import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, SimulatedBadge } from '@/components/ui';
import { useAction, useBrand, useQuery } from '@/app/backend';
import type { IntegrationProvider, Website } from '@/domain/types';
import { formatDateTime } from '@/lib/utils';
import { INTEGRATION_STATUS, PROVIDER_LABELS } from '@/pages/seo/labels';

const GOOGLE: IntegrationProvider[] = ['google_analytics', 'google_search_console'];

/** Freshness from the last (simulated) sync time. */
function freshness(at: string | null): { label: string; variant: 'green' | 'yellow' | 'red' } {
    if (!at) return { label: 'No data yet', variant: 'red' };
    const hours = (Date.now() - Date.parse(at)) / 3_600_000;
    if (hours < 48) return { label: 'Fresh', variant: 'green' };
    if (hours < 24 * 7) return { label: `${Math.round(hours / 24)} days old`, variant: 'yellow' };
    return { label: `${Math.round(hours / 24)} days old`, variant: 'red' };
}

/** Connectors that only run server-side (staging mode). Mock mode never pretends to run them. */
const SERVER_ONLY: Array<{ key: 'wordpress' | 'site_crawler'; label: string; detail: (w: Website) => string }> = [
    { key: 'wordpress', label: 'WordPress', detail: (w) => (w.platform === 'wordpress' ? 'Read-only REST API inventory (pages, posts, categories). Application Password optional.' : 'Website platform is not set to WordPress.') },
    { key: 'site_crawler', label: 'Technical SEO crawl', detail: () => 'Bounded, read-only crawl with evidence-backed findings.' },
];

export function IntegrationsPage() {
    const { brand, can } = useBrand();
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const integrations = useQuery((api) => api.integrations.list(brand.id), [brand.id]);
    const connect = useAction((api, websiteId: string, provider: IntegrationProvider) => api.integrations.connect(brand.id, websiteId, provider));
    const sync = useAction((api, id: string) => api.integrations.sync(brand.id, id));
    const disconnect = useAction((api, id: string) => api.integrations.disconnect(brand.id, id));
    const remove = useAction((api, id: string) => api.integrations.remove(brand.id, id));
    const error = connect.error ?? sync.error ?? disconnect.error ?? remove.error;

    return (
        <Page title="Integrations" description="WordPress, GA4, Search Console and technical SEO per website">
            <Alert tone="info">
                Local mock mode: no request is sent to WordPress, Google or any website. Statuses below are sample records, and "Sync (simulated)" only updates a local
                timestamp. Live connections, syncs and crawls run on the server in staging mode.
            </Alert>
            {error ? <ErrorState error={error} /> : null}
            {websites.loading || integrations.loading ? (
                <LoadingState />
            ) : websites.error || integrations.error ? (
                <ErrorState error={websites.error ?? integrations.error} onRetry={() => { websites.reload(); integrations.reload(); }} />
            ) : !websites.data!.length ? (
                <EmptyState title="No websites" description="Add a website before connecting integrations." />
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    {websites.data!.map((w) => (
                        <Card key={w.id}>
                            <CardHeader>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <CardTitle>{w.name}</CardTitle>
                                    <div className="flex flex-wrap gap-1">
                                        {w.isDemo && <Badge variant="yellow">Demo record</Badge>}
                                        <Badge variant="gray">{w.environment}</Badge>
                                        <Badge variant="gray">{w.platform}</Badge>
                                    </div>
                                </div>
                                <p className="text-xs text-fg-muted">{w.websiteUrl ?? w.domain ?? 'No URL yet'}</p>
                            </CardHeader>
                            <CardContent className="divide-y divide-line-subtle">
                                {w.isDemo && (
                                    <p className="pb-3 text-xs text-fg-muted">Demo websites use reserved .example domains. Live integrations and crawls are disabled for them{integrations.data!.some((x) => x.websiteId === w.id && x.simulated) ? '; the connections below are simulated demo records and never contact Google' : ''}.</p>
                                )}
                                {SERVER_ONLY.map((c) => (
                                    <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-fg">{c.label}</p>
                                            <p className="text-xs text-fg-muted">{c.detail(w)}</p>
                                        </div>
                                        <Badge variant="gray">{w.isDemo ? 'Disabled (demo)' : 'Not connected · staging mode only'}</Badge>
                                    </div>
                                ))}
                                {GOOGLE.map((p) => {
                                    const i = integrations.data!.find((x) => x.websiteId === w.id && x.provider === p);
                                    const status = i ? INTEGRATION_STATUS[i.status] : null;
                                    return (
                                        <div key={p} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-fg">{PROVIDER_LABELS[p]}</p>
                                                <p className="text-xs text-fg-muted">
                                                    {i?.externalPropertyName ?? 'Not connected'}
                                                    {i?.lastSyncedAt ? ` · last sync ${formatDateTime(i.lastSyncedAt)}` : ''}
                                                </p>
                                                {i?.lastErrorMessage && <p className="mt-1 text-xs text-danger-strong">{i.lastErrorMessage}</p>}
                                                {i?.simulated && i.syncHistory && i.syncHistory.length > 0 && (
                                                    <details className="mt-1 text-xs">
                                                        <summary className="cursor-pointer text-fg-secondary">Sync history (simulated, {i.syncHistory.length})</summary>
                                                        <ul className="mt-1 space-y-0.5">
                                                            {i.syncHistory.map((h) => (
                                                                <li key={h.at} className={h.ok ? 'text-fg-muted' : 'text-danger-strong'}>{formatDateTime(h.at)} · {h.ok ? 'Succeeded' : 'Failed'} · {h.message}</li>
                                                            ))}
                                                        </ul>
                                                    </details>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {i?.simulated && <SimulatedBadge />}
                                                {i?.simulated && (() => { const f = freshness(i.lastSyncedAt); return <Badge variant={f.variant}>{f.label}</Badge>; })()}
                                                {status && <Badge variant={status.variant}>{status.label}</Badge>}
                                                {(!w.isDemo || i?.simulated) && i && (i.status === 'connected' || i.status === 'error') && can.write && (
                                                    <Button size="sm" variant="secondary" loading={sync.pending} onClick={() => void sync.run(i.id)}>{i.simulated ? 'Sync now (simulated)' : 'Sync (simulated)'}</Button>
                                                )}
                                                {i && (i.status === 'connected' || i.status === 'error') && can.admin && (
                                                    <Button size="sm" variant="ghost" onClick={() => confirm(`Disconnect ${PROVIDER_LABELS[p]} from ${w.name}?`) && void disconnect.run(i.id)}>Disconnect</Button>
                                                )}
                                                {i && (i.status === 'pending' || i.status === 'disconnected') && can.admin && (
                                                    <Button size="sm" variant="ghost" onClick={() => void remove.run(i.id)}>Remove</Button>
                                                )}
                                                {!w.isDemo && (!i || i.status === 'disconnected') && can.admin && (
                                                    <Button size="sm" onClick={() => void connect.run(w.id, p)}>Connect</Button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}
