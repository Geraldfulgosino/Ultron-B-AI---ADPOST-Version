import React, { useState } from 'react';
import { Head, Link, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

interface WebsiteRow {
    id: number;
    client_id: number;
    client_name: string;
    name: string;
    domain: string;
    platform: string | null;
    status: 'active' | 'archived';
    status_label: string;
    timezone: string;
    currency: string;
    primary_conversion: string | null;
    ga4_property_id: string | null;
    gsc_site_url: string | null;
}

interface ClientOption {
    id: number;
    name: string;
    timezone: string;
    currency: string;
}

interface WebsitesProps {
    websites: WebsiteRow[];
    clients: ClientOption[];
    canCreate: boolean;
    canManage: boolean;
    defaults: {
        timezone: string;
        currency: string;
    };
}

interface SharedProps {
    currentOrganization: { slug: string };
}

type WebsiteFormData = {
    client_id: string;
    name: string;
    domain: string;
    platform: string;
    status: string;
    timezone: string;
    currency: string;
    primary_conversion: string;
    ga4_property_id: string;
    gsc_site_url: string;
};

const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Singapore', 'Asia/Manila', 'Australia/Sydney'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'PHP', 'JPY'];
const PLATFORMS = ['', 'WordPress', 'Shopify', 'Webflow', 'Custom', 'Other'];

export default function WebsitesIndex({ websites, clients, canCreate, canManage, defaults }: WebsitesProps) {
    const page = usePage();
    const { currentOrganization } = page.props as unknown as SharedProps;
    const orgSlug = currentOrganization?.slug ?? page.url.split('/').filter(Boolean)[0] ?? '';
    const [editing, setEditing] = useState<WebsiteRow | null>(null);
    const baseData = {
        client_id: clients[0]?.id ? String(clients[0].id) : '',
        name: '',
        domain: '',
        platform: '',
        status: 'active',
        timezone: defaults.timezone,
        currency: defaults.currency,
        primary_conversion: '',
        ga4_property_id: '',
        gsc_site_url: '',
    };
    const createForm = useForm<WebsiteFormData>(baseData);
    const editForm = useForm<WebsiteFormData>(baseData);

    const store = (event: React.FormEvent) => {
        event.preventDefault();
        createForm.post(route('websites.store', { organization: orgSlug }), {
            preserveScroll: true,
            onSuccess: () => createForm.reset('name', 'domain', 'platform', 'primary_conversion'),
        });
    };

    const startEdit = (website: WebsiteRow) => {
        setEditing(website);
        editForm.setData({
            client_id: String(website.client_id),
            name: website.name,
            domain: website.domain,
            platform: website.platform ?? '',
            status: website.status,
            timezone: website.timezone,
            currency: website.currency,
            primary_conversion: website.primary_conversion ?? '',
            ga4_property_id: website.ga4_property_id ?? '',
            gsc_site_url: website.gsc_site_url ?? '',
        });
    };

    const update = (event: React.FormEvent) => {
        event.preventDefault();
        if (!editing) return;
        editForm.patch(route('websites.update', { organization: orgSlug, website: editing.id }), {
            preserveScroll: true,
            onSuccess: () => setEditing(null),
        });
    };

    return (
        <AppLayout title="Websites">
            <Head title="Websites" />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Websites</h2>
                            <p className="mt-1 text-sm text-gray-500">Sites tracked for client work.</p>
                        </div>
                        <Link href={route('clients.index', { organization: orgSlug })} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                            Clients
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {websites.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No websites yet</p>
                                <p className="mt-1 text-sm text-gray-500">Add a client website before connecting analytics integrations.</p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-lg border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Website</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Client</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                                            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 bg-white">
                                        {websites.map((website) => (
                                            <tr key={website.id}>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-gray-900">{website.name}</div>
                                                    <div className="text-xs text-gray-500">{website.domain}</div>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-700">{website.client_name}</td>
                                                <td className="px-4 py-3">
                                                    <Badge variant={website.status === 'active' ? 'green' : 'gray'}>{website.status_label}</Badge>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {canManage && (
                                                        <div className="flex justify-end gap-2">
                                                            <Button type="button" variant="secondary" size="sm" onClick={() => startEdit(website)}>
                                                                Edit
                                                            </Button>
                                                            <Link href={route('websites.destroy', { organization: orgSlug, website: website.id })} method="delete" as="button" className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
                                                                Archive
                                                            </Link>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {canCreate || canManage ? (
                    <Card>
                        <CardHeader>
                            <h3 className="text-base font-semibold text-gray-900">{editing ? 'Edit website' : 'New website'}</h3>
                        </CardHeader>
                        <CardContent>
                            <WebsiteForm
                                data={editing ? editForm.data : createForm.data}
                                errors={editing ? editForm.errors : createForm.errors}
                                processing={editing ? editForm.processing : createForm.processing}
                                clients={clients}
                                canSubmit={editing ? canManage : canCreate}
                                onSubmit={editing ? update : store}
                                onCancel={editing ? () => setEditing(null) : undefined}
                                setData={editing ? editForm.setData : createForm.setData}
                            />
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
        </AppLayout>
    );
}

function WebsiteForm({
    data,
    errors,
    processing,
    clients,
    canSubmit,
    onSubmit,
    onCancel,
    setData,
}: {
    data: WebsiteFormData;
    errors: Partial<Record<keyof WebsiteFormData, string>>;
    processing: boolean;
    clients: ClientOption[];
    canSubmit: boolean;
    onSubmit: (event: React.FormEvent) => void;
    onCancel?: () => void;
    setData: (field: keyof WebsiteFormData, value: string) => void;
}) {
    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div>
                <Label htmlFor="website-client" required>Client</Label>
                <select id="website-client" value={data.client_id} onChange={(event) => setData('client_id', event.target.value)} disabled={!canSubmit || clients.length === 0} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                    {clients.length === 0 && <option value="">Create a client first</option>}
                    {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
                {errors.client_id && <p className="mt-1 text-xs text-red-600">{errors.client_id}</p>}
            </div>
            <div>
                <Label htmlFor="website-name" required>Name</Label>
                <Input id="website-name" value={data.name} onChange={(event) => setData('name', event.target.value)} error={errors.name} disabled={!canSubmit} />
            </div>
            <div>
                <Label htmlFor="website-domain" required>Domain</Label>
                <Input id="website-domain" value={data.domain} onChange={(event) => setData('domain', event.target.value)} error={errors.domain} disabled={!canSubmit} placeholder="example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label htmlFor="website-platform">Platform</Label>
                    <select id="website-platform" value={data.platform} onChange={(event) => setData('platform', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                        {PLATFORMS.map((platform) => <option key={platform || 'none'} value={platform}>{platform || 'Not set'}</option>)}
                    </select>
                    {errors.platform && <p className="mt-1 text-xs text-red-600">{errors.platform}</p>}
                </div>
                <div>
                    <Label htmlFor="website-status" required>Status</Label>
                    <select id="website-status" value={data.status} onChange={(event) => setData('status', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                    </select>
                    {errors.status && <p className="mt-1 text-xs text-red-600">{errors.status}</p>}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label htmlFor="website-timezone" required>Timezone</Label>
                    <select id="website-timezone" value={data.timezone} onChange={(event) => setData('timezone', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                        {TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                    </select>
                    {errors.timezone && <p className="mt-1 text-xs text-red-600">{errors.timezone}</p>}
                </div>
                <div>
                    <Label htmlFor="website-currency" required>Currency</Label>
                    <select id="website-currency" value={data.currency} onChange={(event) => setData('currency', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                        {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                    {errors.currency && <p className="mt-1 text-xs text-red-600">{errors.currency}</p>}
                </div>
            </div>
            <div>
                <Label htmlFor="website-conversion">Primary conversion</Label>
                <textarea id="website-conversion" value={data.primary_conversion} onChange={(event) => setData('primary_conversion', event.target.value)} disabled={!canSubmit} className="block min-h-24 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm" />
                {errors.primary_conversion && <p className="mt-1 text-xs text-red-600">{errors.primary_conversion}</p>}
            </div>
            <div>
                <Label htmlFor="website-ga4-property-id">GA4 Property ID</Label>
                <Input id="website-ga4-property-id" value={data.ga4_property_id} onChange={(event) => setData('ga4_property_id', event.target.value)} error={errors.ga4_property_id} disabled={!canSubmit} placeholder="516552354" />
                <p className="mt-1 text-xs text-gray-500">Use the numeric GA4 Property ID from Google Analytics Admin → Property settings. Do not use the G- Measurement ID.</p>
            </div>
            <div>
                <Label htmlFor="website-gsc-site-url">Google Search Console Site URL</Label>
                <Input id="website-gsc-site-url" value={data.gsc_site_url} onChange={(event) => setData('gsc_site_url', event.target.value)} error={errors.gsc_site_url} disabled={!canSubmit} placeholder="https://lugenixdigitalservices.com/" />
                <p className="mt-1 text-xs text-gray-500">Use the exact verified Google Search Console property. URL-prefix example: https://example.com/. Domain property example: sc-domain:example.com.</p>
            </div>
            <div className="flex gap-2">
                <Button type="submit" loading={processing} disabled={!canSubmit || clients.length === 0}>
                    Save website
                </Button>
                {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
            </div>
        </form>
    );
}
