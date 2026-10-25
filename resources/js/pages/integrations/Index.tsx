import React, { useState } from 'react';
import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

interface IntegrationRow {
    id: number;
    website_id: number | null;
    website_name: string | null;
    website_domain: string | null;
    scope_label: string;
    provider: string;
    provider_label: string;
    status: string;
    status_label: string;
    connection_status: string;
    connection_status_label: string;
    external_account_name: string | null;
    external_property_name: string | null;
    last_synced_at: string | null;
    last_sync_status: string | null;
    last_sync_status_label: string | null;
    last_sync_error_message: string | null;
    last_error_message: string | null;
    is_active: boolean;
    inactive_note: string | null;
    can_sync: boolean;
    can_disconnect: boolean;
    can_delete_inactive: boolean;
}

interface Option {
    value: string;
    label: string;
}

interface WebsiteOption {
    id: number;
    name: string;
    domain: string;
}

interface N8nDelivery {
    id: number;
    event_name: string;
    status: string;
    response_code: number | null;
    sent_at: string | null;
    created_at: string;
}

interface N8nConnectionData {
    id: number;
    webhook_url: string;
    is_enabled: boolean;
    last_status: string | null;
    last_tested_at: string | null;
    last_error: string | null;
    recent_deliveries: N8nDelivery[];
}

interface IntegrationsProps {
    integrations: IntegrationRow[];
    inactiveIntegrations: IntegrationRow[];
    websites: WebsiteOption[];
    providers: Option[];
    canConnect: boolean;
    canDisconnect: boolean;
    canSync: boolean;
    googleConfigured: boolean;
    canConfigureAutomation: boolean;
    n8nConnection: N8nConnectionData | null;
}

interface SharedProps {
    currentOrganization: { slug: string; role: string };
}

type ActiveTab = 'google' | 'automation' | 'coming-soon';

const TABS: Array<{ id: ActiveTab; label: string; description: string }> = [
    { id: 'google',      label: 'Google',     description: 'Search Console and Analytics data connections' },
    { id: 'automation',  label: 'Automation', description: 'n8n workflows and automation webhooks' },
    { id: 'coming-soon', label: 'Future',     description: 'Planned integrations' },
];

const COMING_SOON_ITEMS = [
    { name: 'WordPress',          description: 'Sync posts, pages, and site metadata from your WordPress site.' },
    { name: 'HubSpot',            description: 'Connect CRM contacts and marketing campaign data.' },
    { name: 'Slack / Email',      description: 'Receive alerts and digest reports in real time.' },
    { name: 'AI Agent Providers', description: 'OpenAI, Anthropic, and other AI model providers.' },
];

export default function IntegrationsIndex({
    integrations,
    inactiveIntegrations,
    websites,
    providers,
    canConnect,
    googleConfigured,
    canConfigureAutomation,
    n8nConnection,
}: IntegrationsProps) {
    const { currentOrganization } = usePage().props as unknown as SharedProps;
    const form = useForm({
        provider: providers[0]?.value ?? 'google_analytics',
        website_id: '',
    });

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        form.post(route('integrations.google.connect', { organization: currentOrganization.slug }), { preserveScroll: true });
    };

    // canConfigureAutomation comes from the server-side permission check. The role
    // fallback guards against stale partial-reload state or undefined props so that
    // owners and admins always see the configuration form.
    const canConfigure = Boolean(canConfigureAutomation)
        || ['owner', 'admin'].includes(currentOrganization?.role ?? '');

    // Smart default: if no Google connections exist but n8n is configured, open Automation.
    const defaultTab: ActiveTab =
        integrations.length === 0 && inactiveIntegrations.length === 0 && n8nConnection != null
            ? 'automation'
            : 'google';

    const [activeTab, setActiveTab] = useState<ActiveTab>(defaultTab);

    return (
        <AppLayout title="Integrations">
            <Head title="Integrations" />

            <div className="space-y-6">
                <p className="text-sm text-gray-500">
                    Manage analytics, automation, and platform connections for this organization.
                </p>

                {/* Tab bar */}
                <div className="border-b border-gray-200">
                    <nav className="-mb-px flex gap-1 overflow-x-auto sm:gap-6" aria-label="Integration categories">
                        {TABS.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                aria-selected={activeTab === tab.id}
                                className={`whitespace-nowrap border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition-colors ${
                                    activeTab === tab.id
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <p className="text-sm text-gray-500">
                    {TABS.find((t) => t.id === activeTab)?.description}
                </p>

                {/* ── Google tab ──────────────────────────────────────────────────────── */}
                {activeTab === 'google' && (
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                        <Card>
                            <CardHeader>
                                <h2 className="text-lg font-semibold text-gray-900">Active connections</h2>
                                <p className="mt-1 text-sm text-gray-500">The latest connected integration for each provider and scope. OAuth credentials and raw provider responses are never sent to this page.</p>
                            </CardHeader>
                            <CardContent>
                                {integrations.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                        <p className="text-sm font-medium text-gray-900">No active integrations yet</p>
                                        <p className="mt-1 text-sm text-gray-500">Connect Google Analytics 4 or Google Search Console when credentials are configured.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {integrations.map((integration) => (
                                            <IntegrationCard
                                                key={integration.id}
                                                integration={integration}
                                                organizationSlug={currentOrganization.slug}
                                            />
                                        ))}
                                    </div>
                                )}

                                {inactiveIntegrations.length > 0 && (
                                    <details className="mt-6 rounded-lg border border-gray-200 bg-gray-50">
                                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-800">
                                            Inactive / failed connections ({inactiveIntegrations.length})
                                        </summary>
                                        <div className="space-y-4 border-t border-gray-200 p-4">
                                            {inactiveIntegrations.map((integration) => (
                                                <IntegrationCard
                                                    key={integration.id}
                                                    integration={integration}
                                                    organizationSlug={currentOrganization.slug}
                                                    inactive
                                                />
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </CardContent>
                        </Card>

                        {canConnect ? (
                            <Card>
                                <CardHeader>
                                    <h3 className="text-base font-semibold text-gray-900">Connect Google</h3>
                                    <p className="mt-1 text-sm text-gray-500">Choose the provider and the scope this connection should serve.</p>
                                </CardHeader>
                                <CardContent>
                                    {!googleConfigured && (
                                        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                                            Google OAuth credentials are not configured. Submitting creates a pending placeholder only.
                                        </div>
                                    )}
                                    <form onSubmit={submit} className="space-y-4">
                                        <div>
                                            <Label htmlFor="integration-provider" required>Provider</Label>
                                            <select
                                                id="integration-provider"
                                                value={form.data.provider}
                                                onChange={(event) => form.setData('provider', event.target.value)}
                                                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {providers.map((provider) => (
                                                    <option key={provider.value} value={provider.value}>{provider.label}</option>
                                                ))}
                                            </select>
                                            <p className="mt-1 text-xs text-gray-500">Google Analytics 4 syncs traffic data. Google Search Console syncs clicks, impressions, and query data.</p>
                                            {form.errors.provider && <p className="mt-1 text-xs text-red-600">{form.errors.provider}</p>}
                                        </div>
                                        <div>
                                            <Label htmlFor="integration-website">Website</Label>
                                            <select
                                                id="integration-website"
                                                value={form.data.website_id}
                                                onChange={(event) => form.setData('website_id', event.target.value)}
                                                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                <option value="">Organization-level</option>
                                                {websites.map((website) => (
                                                    <option key={website.id} value={website.id}>
                                                        {website.name} ({website.domain})
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="mt-1 text-xs text-gray-500">Use organization-level for a shared Google account. Use website-level when a property or Search Console site belongs to one website.</p>
                                            {form.errors.website_id && <p className="mt-1 text-xs text-red-600">{form.errors.website_id}</p>}
                                        </div>
                                        <Button type="submit" loading={form.processing}>
                                            Continue with Google
                                        </Button>
                                    </form>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent>
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
                                        <p className="text-sm font-medium text-gray-700">Read-only access</p>
                                        <p className="mt-1 text-sm text-gray-500">Your account has read-only access. Contact your administrator to make changes.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                )}

                {/* ── Automation tab ──────────────────────────────────────────────────── */}
                {activeTab === 'automation' && (
                    canConfigure || n8nConnection != null ? (
                        <N8nConnectionCard
                            connection={n8nConnection}
                            canConfigureAutomation={canConfigure}
                            organizationSlug={currentOrganization.slug}
                        />
                    ) : (
                        <Card>
                            <CardContent>
                                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                    <p className="text-sm font-medium text-gray-900">No automation configured</p>
                                    <p className="mt-1 text-sm text-gray-500">Contact your administrator to set up n8n webhook automation.</p>
                                </div>
                            </CardContent>
                        </Card>
                    )
                )}

                {/* ── Future / Coming Soon tab ────────────────────────────────────────── */}
                {activeTab === 'coming-soon' && (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {COMING_SOON_ITEMS.map((item) => (
                            <Card key={item.name} className="opacity-60">
                                <CardContent>
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <h3 className="text-sm font-medium text-gray-700">{item.name}</h3>
                                            <Badge variant="gray">Coming soon</Badge>
                                        </div>
                                        <p className="text-xs text-gray-500">{item.description}</p>
                                        <button
                                            type="button"
                                            disabled
                                            className="mt-1 w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-400"
                                        >
                                            Not available yet
                                        </button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </AppLayout>
    );
}

function N8nConnectionCard({
    connection,
    canConfigureAutomation,
    organizationSlug,
}: {
    connection: N8nConnectionData | null;
    canConfigureAutomation: boolean;
    organizationSlug: string;
}) {
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);

    const form = useForm({
        webhook_url: connection?.webhook_url ?? '',
        webhook_secret: '',
        is_enabled: connection?.is_enabled ?? true,
    });

    const disconnectForm = useForm({});

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);
        form.post(route('automations.n8n.store', { organization: organizationSlug }), { preserveScroll: true });
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const resp = await window.axios.post(
                route('automations.n8n.test', { organization: organizationSlug }),
            );
            setTestResult({
                success: resp.data.success as boolean,
                message: resp.data.message as string,
            });
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { message?: string } } };
            setTestResult({
                success: false,
                message: axiosErr.response?.data?.message ?? 'Network error. Could not reach the server.',
            });
        } finally {
            setTesting(false);
        }
    };

    const handleDisconnect = () => {
        if (!confirm('Disable the n8n connection? Delivery history will be preserved.')) return;
        disconnectForm.delete(
            route('automations.n8n.destroy', { organization: organizationSlug }),
            { preserveScroll: true },
        );
    };

    const handleClearHistory = () => {
        if (!confirm('Clear n8n delivery history? This will remove recent delivery logs from ULTRON-B AI but will not disconnect n8n.')) return;
        router.delete(
            route('automations.n8n.deliveries.clear', { organization: organizationSlug }),
            { preserveScroll: true },
        );
    };

    const statusBadge = () => {
        if (!connection) return <Badge variant="gray">Not configured</Badge>;
        if (!connection.is_enabled) return <Badge variant="gray">Disabled</Badge>;
        if (connection.last_status === 'success') return <Badge variant="green">Connected</Badge>;
        if (connection.last_status === 'failed') return <Badge variant="red">Failed</Badge>;
        return <Badge variant="yellow">Configured</Badge>;
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">n8n Automation Bridge</h2>
                    {statusBadge()}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                    Connect ULTRON-B AI to n8n workflows using a secure webhook.
                </p>
            </CardHeader>
            <CardContent>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div>
                        {canConfigureAutomation ? (
                            <form onSubmit={submit} className="space-y-4">
                                <div>
                                    <Label htmlFor="n8n-webhook-url" required>Webhook URL</Label>
                                    <Input
                                        id="n8n-webhook-url"
                                        type="url"
                                        value={form.data.webhook_url}
                                        onChange={(e) => form.setData('webhook_url', e.target.value)}
                                        placeholder="https://n8n.example.com/webhook/..."
                                        error={form.errors.webhook_url}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="n8n-webhook-secret">Webhook Secret</Label>
                                    <Input
                                        id="n8n-webhook-secret"
                                        type="password"
                                        value={form.data.webhook_secret}
                                        onChange={(e) => form.setData('webhook_secret', e.target.value)}
                                        placeholder={connection ? 'Leave blank to keep the existing secret' : 'Optional — recommended for production'}
                                        autoComplete="new-password"
                                    />
                                    {connection && (
                                        <p className="mt-1 text-xs text-gray-500">Leave blank to keep the existing secret.</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        id="n8n-enabled"
                                        type="checkbox"
                                        checked={form.data.is_enabled}
                                        onChange={(e) => form.setData('is_enabled', e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <Label htmlFor="n8n-enabled" className="mb-0">Enable webhook delivery</Label>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Button type="submit" loading={form.processing}>
                                        {connection ? 'Save changes' : 'Connect n8n'}
                                    </Button>
                                    {connection && (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            loading={testing}
                                            onClick={handleTest}
                                        >
                                            Test connection
                                        </Button>
                                    )}
                                    {connection && (
                                        <button
                                            type="button"
                                            onClick={handleDisconnect}
                                            disabled={disconnectForm.processing}
                                            className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                                        >
                                            Disconnect
                                        </button>
                                    )}
                                </div>
                                {testResult !== null && (
                                    <div
                                        className={`rounded-lg border p-3 text-sm ${testResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}
                                    >
                                        {testResult.message}
                                    </div>
                                )}
                                {connection?.last_tested_at && (
                                    <p className="text-xs text-gray-500">Last tested: {connection.last_tested_at}</p>
                                )}
                                {connection?.last_status === 'failed' && connection.last_error && (
                                    <div className="rounded-md border border-red-200 bg-red-50 p-3">
                                        <p className="text-xs font-medium text-red-900">Last error</p>
                                        <p className="mt-1 text-sm text-red-700">{connection.last_error}</p>
                                    </div>
                                )}
                            </form>
                        ) : (
                            <div className="space-y-3">
                                <div className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                                    <Detail label="Webhook URL" value={connection ? truncateUrl(connection.webhook_url) : '—'} />
                                    <Detail
                                        label="Status"
                                        value={
                                            connection?.last_status === 'success'
                                                ? 'Healthy'
                                                : connection?.last_status === 'failed'
                                                  ? 'Failed'
                                                  : 'Not tested'
                                        }
                                    />
                                    {connection?.last_tested_at && (
                                        <Detail label="Last tested" value={connection.last_tested_at} />
                                    )}
                                </div>
                                {connection?.last_status === 'failed' && connection.last_error && (
                                    <div className="rounded-md border border-red-200 bg-red-50 p-3">
                                        <p className="text-xs font-medium text-red-900">Last error</p>
                                        <p className="mt-1 text-sm text-red-700">{connection.last_error}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {connection && connection.recent_deliveries.length > 0 && (
                        <div>
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <h3 className="text-sm font-medium text-gray-700">Recent deliveries</h3>
                                {canConfigureAutomation && (
                                    <button
                                        type="button"
                                        onClick={handleClearHistory}
                                        className="text-xs font-medium text-red-600 hover:text-red-500"
                                    >
                                        Clear history
                                    </button>
                                )}
                            </div>
                            <div className="space-y-2">
                                {connection.recent_deliveries.map((delivery) => (
                                    <div key={delivery.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-gray-700 truncate">{delivery.event_name}</span>
                                            <Badge variant={deliveryStatusVariant(delivery.status)}>
                                                {delivery.status}
                                            </Badge>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-gray-500">
                                            {delivery.response_code !== null && (
                                                <span>HTTP {delivery.response_code}</span>
                                            )}
                                            <span>{delivery.sent_at ?? delivery.created_at}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function IntegrationCard({ integration, organizationSlug, inactive = false }: { integration: IntegrationRow; organizationSlug: string; inactive?: boolean }) {
    const hasSyncMetadata = integration.last_synced_at || integration.last_sync_status_label;
    const accountLabel = integration.external_account_name ?? 'No account email recorded';
    const propertyLabel = integration.external_property_name ?? 'No property selected';

    const handleRemoveRecord = () => {
        if (!confirm('Remove this inactive connection record? This will only remove the saved inactive/failed record from ULTRON-B AI. It will not revoke access in Google.')) return;
        router.delete(
            route('integrations.inactive.destroy', { organization: organizationSlug, integration: integration.id }),
            { preserveScroll: true },
        );
    };

    return (
        <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-gray-900">{integration.provider_label}</h3>
                        <Badge variant={connectionVariant(integration.connection_status)}>
                            {integration.connection_status_label}
                        </Badge>
                    </div>
                    <div className="mt-3 grid gap-3 text-sm text-gray-600 md:grid-cols-2">
                        <Detail label="Connected account" value={accountLabel} />
                        <Detail label="Scope" value={integration.scope_label} />
                        <Detail label="Provider status" value={integration.status_label} />
                        <Detail label="Provider property" value={propertyLabel} />
                    </div>
                    {integration.website_name && (
                        <p className="mt-3 text-xs text-gray-500">
                            Website: {integration.website_name}{integration.website_domain ? ` / ${integration.website_domain}` : ''}
                        </p>
                    )}
                    {(inactive || integration.inactive_note) && (
                        <p className="mt-3 text-xs font-medium text-gray-500">{integration.inactive_note ?? 'This connection is inactive.'}</p>
                    )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                    {!inactive && integration.can_sync && (
                        <Link
                            href={route('integrations.sync', { organization: organizationSlug, integration: integration.id })}
                            method="post"
                            as="button"
                            preserveScroll
                            className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                            Sync now
                        </Link>
                    )}
                    {!inactive && integration.can_disconnect && (
                        <Link
                            href={route('integrations.destroy', { organization: organizationSlug, integration: integration.id })}
                            method="delete"
                            as="button"
                            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
                        >
                            Disconnect
                        </Link>
                    )}
                    {inactive && integration.can_delete_inactive && (
                        <button
                            type="button"
                            onClick={handleRemoveRecord}
                            className="text-sm font-medium text-red-600 hover:text-red-500"
                        >
                            Remove record
                        </button>
                    )}
                </div>
            </div>

            <div className="mt-4 rounded-lg bg-gray-50 p-3">
                {hasSyncMetadata ? (
                    <div className="grid gap-2 text-xs text-gray-600 md:grid-cols-2">
                        <Detail label="Last sync" value={integration.last_synced_at ?? 'Not completed'} />
                        <Detail label="Last sync status" value={integration.last_sync_status_label ?? 'Not recorded'} />
                    </div>
                ) : (
                    <p className="text-xs text-gray-500">No sync has been recorded for this integration yet.</p>
                )}
                {integration.last_sync_error_message && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
                        <p className="text-xs font-medium text-red-900">Last sync error</p>
                        <p className="mt-1 text-sm text-red-700">{integration.last_sync_error_message}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-0.5 truncate text-sm text-gray-700">{value}</p>
        </div>
    );
}

function truncateUrl(url: string): string {
    if (url.length <= 50) return url;
    return `${url.slice(0, 47)}...`;
}

function deliveryStatusVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' {
    if (status === 'sent') return 'green';
    if (status === 'failed') return 'red';
    if (status === 'pending') return 'yellow';
    return 'gray';
}

function connectionVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue' {
    if (status === 'connected') {
        return 'green';
    }

    if (status === 'error') {
        return 'red';
    }

    if (status === 'syncing') {
        return 'indigo';
    }

    if (status === 'needs_setup') {
        return 'yellow';
    }

    if (status === 'disconnected') {
        return 'gray';
    }

    return 'gray';
}
