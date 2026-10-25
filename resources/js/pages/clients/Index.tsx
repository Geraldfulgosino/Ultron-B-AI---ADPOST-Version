import React, { useState } from 'react';
import { Head, Link, useForm, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

interface ClientRow {
    id: number;
    name: string;
    slug: string;
    status: 'active' | 'archived';
    timezone: string;
    currency: string;
    business_goals: string | null;
    websites_count: number;
}

interface ClientsProps {
    clients: ClientRow[];
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

type ClientFormData = {
    name: string;
    status: string;
    timezone: string;
    currency: string;
    business_goals: string;
};

const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Singapore', 'Asia/Manila', 'Australia/Sydney'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'PHP', 'JPY'];

export default function ClientsIndex({ clients, canCreate, canManage, defaults }: ClientsProps) {
    const page = usePage();
    const { currentOrganization } = page.props as unknown as SharedProps;
    const orgSlug = currentOrganization?.slug ?? page.url.split('/').filter(Boolean)[0] ?? '';
    const [editing, setEditing] = useState<ClientRow | null>(null);
    const createForm = useForm<ClientFormData>({
        name: '',
        status: 'active',
        timezone: defaults.timezone,
        currency: defaults.currency,
        business_goals: '',
    });
    const editForm = useForm<ClientFormData>({
        name: '',
        status: 'active',
        timezone: defaults.timezone,
        currency: defaults.currency,
        business_goals: '',
    });

    const startEdit = (client: ClientRow) => {
        setEditing(client);
        editForm.setData({
            name: client.name,
            status: client.status,
            timezone: client.timezone,
            currency: client.currency,
            business_goals: client.business_goals ?? '',
        });
    };

    const store = (event: React.FormEvent) => {
        event.preventDefault();
        createForm.post(route('clients.store', { organization: orgSlug }), {
            preserveScroll: true,
            onSuccess: () => createForm.reset('name', 'business_goals'),
        });
    };

    const update = (event: React.FormEvent) => {
        event.preventDefault();
        if (!editing) return;
        editForm.patch(route('clients.update', { organization: orgSlug, client: editing.id }), {
            preserveScroll: true,
            onSuccess: () => setEditing(null),
        });
    };

    return (
        <AppLayout title="Clients">
            <Head title="Clients" />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Clients</h2>
                            <p className="mt-1 text-sm text-gray-500">Client accounts owned by this organization.</p>
                        </div>
                        <Link
                            href={route('websites.index', { organization: orgSlug })}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                        >
                            Websites
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {clients.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-sm font-medium text-gray-900">No clients yet</p>
                                <p className="mt-1 text-sm text-gray-500">Create a client before adding websites or integrations.</p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-lg border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Client</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Websites</th>
                                            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 bg-white">
                                        {clients.map((client) => (
                                            <tr key={client.id}>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-gray-900">{client.name}</div>
                                                    <div className="text-xs text-gray-500">{client.timezone} / {client.currency}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant={client.status === 'active' ? 'green' : 'gray'}>
                                                        {client.status}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-700">{client.websites_count}</td>
                                                <td className="px-4 py-3 text-right">
                                                    {canManage && (
                                                        <div className="flex justify-end gap-2">
                                                            <Button type="button" variant="secondary" size="sm" onClick={() => startEdit(client)}>
                                                                Edit
                                                            </Button>
                                                            <Link
                                                                href={route('clients.destroy', { organization: orgSlug, client: client.id })}
                                                                method="delete"
                                                                as="button"
                                                                className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                                                            >
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
                            <h3 className="text-base font-semibold text-gray-900">{editing ? 'Edit client' : 'New client'}</h3>
                        </CardHeader>
                        <CardContent>
                            {editing ? (
                                <ClientForm
                                    data={editForm.data}
                                    errors={editForm.errors}
                                    processing={editForm.processing}
                                    canSubmit={canManage}
                                    onSubmit={update}
                                    onCancel={() => setEditing(null)}
                                    setData={editForm.setData}
                                />
                            ) : (
                                <ClientForm
                                    data={createForm.data}
                                    errors={createForm.errors}
                                    processing={createForm.processing}
                                    canSubmit={canCreate}
                                    onSubmit={store}
                                    setData={createForm.setData}
                                />
                            )}
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

function ClientForm({
    data,
    errors,
    processing,
    canSubmit,
    onSubmit,
    onCancel,
    setData,
}: {
    data: ClientFormData;
    errors: Partial<Record<keyof ClientFormData, string>>;
    processing: boolean;
    canSubmit: boolean;
    onSubmit: (event: React.FormEvent) => void;
    onCancel?: () => void;
    setData: (field: keyof ClientFormData, value: string) => void;
}) {
    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div>
                <Label htmlFor="client-name" required>Client name</Label>
                <Input id="client-name" value={data.name} onChange={(event) => setData('name', event.target.value)} error={errors.name} disabled={!canSubmit} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label htmlFor="client-status" required>Status</Label>
                    <select id="client-status" value={data.status} onChange={(event) => setData('status', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                    </select>
                    {errors.status && <p className="mt-1 text-xs text-red-600">{errors.status}</p>}
                </div>
                <div>
                    <Label htmlFor="client-currency" required>Currency</Label>
                    <select id="client-currency" value={data.currency} onChange={(event) => setData('currency', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                        {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                    {errors.currency && <p className="mt-1 text-xs text-red-600">{errors.currency}</p>}
                </div>
            </div>
            <div>
                <Label htmlFor="client-timezone" required>Timezone</Label>
                <select id="client-timezone" value={data.timezone} onChange={(event) => setData('timezone', event.target.value)} disabled={!canSubmit} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm">
                    {TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                </select>
                {errors.timezone && <p className="mt-1 text-xs text-red-600">{errors.timezone}</p>}
            </div>
            <div>
                <Label htmlFor="client-goals">Business goals</Label>
                <textarea id="client-goals" value={data.business_goals} onChange={(event) => setData('business_goals', event.target.value)} disabled={!canSubmit} className="block min-h-24 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm" />
                {errors.business_goals && <p className="mt-1 text-xs text-red-600">{errors.business_goals}</p>}
            </div>
            <div className="flex gap-2">
                <Button type="submit" loading={processing} disabled={!canSubmit}>
                    Save client
                </Button>
                {onCancel && (
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
            </div>
        </form>
    );
}
