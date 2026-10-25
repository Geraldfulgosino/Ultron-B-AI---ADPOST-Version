import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useAction, useBrand, useQuery } from '@/app/backend';
import type { IntegrationProvider } from '@/domain/types';
import { formatDateTime } from '@/lib/utils';
import { INTEGRATION_STATUS, PROVIDER_LABELS } from '@/pages/seo/labels';

const PROVIDERS: IntegrationProvider[] = ['google_analytics', 'google_search_console'];

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
        <Page title="Integrations" description="GA4 and Search Console connections per website">
            <Alert tone="info">
                Local mode: Google OAuth and data syncs run server-side once Supabase is connected (Phase 17). "Sync now" here is simulated. It refreshes the sync timestamp and makes no network calls.
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
                                <CardTitle>{w.name}</CardTitle>
                                <p className="text-xs text-gray-500">{w.domain}</p>
                            </CardHeader>
                            <CardContent className="divide-y divide-gray-100">
                                {PROVIDERS.map((p) => {
                                    const i = integrations.data!.find((x) => x.websiteId === w.id && x.provider === p);
                                    const status = i ? INTEGRATION_STATUS[i.status] : null;
                                    return (
                                        <div key={p} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900">{PROVIDER_LABELS[p]}</p>
                                                <p className="text-xs text-gray-500">
                                                    {i?.externalPropertyName ?? 'Not connected'}
                                                    {i?.lastSyncedAt ? ` · synced ${formatDateTime(i.lastSyncedAt)}` : ''}
                                                </p>
                                                {i?.lastErrorMessage && <p className="mt-1 text-xs text-red-700">{i.lastErrorMessage}</p>}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {status && <Badge variant={status.variant}>{status.label}</Badge>}
                                                {i && (i.status === 'connected' || i.status === 'error') && can.write && (
                                                    <Button size="sm" variant="secondary" loading={sync.pending} onClick={() => void sync.run(i.id)}>Sync now</Button>
                                                )}
                                                {i && (i.status === 'connected' || i.status === 'error') && can.admin && (
                                                    <Button size="sm" variant="ghost" onClick={() => confirm(`Disconnect ${PROVIDER_LABELS[p]} from ${w.name}?`) && void disconnect.run(i.id)}>Disconnect</Button>
                                                )}
                                                {i && (i.status === 'pending' || i.status === 'disconnected') && can.admin && (
                                                    <Button size="sm" variant="ghost" onClick={() => void remove.run(i.id)}>Remove</Button>
                                                )}
                                                {(!i || i.status === 'disconnected') && can.admin && (
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
