import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Table, TBody, Td, Textarea, Th, THead } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import type { Client } from '@/domain/types';
import type { ClientInput } from '@/data/contracts';
import { CURRENCIES, TIMEZONES } from '@/pages/brand/BrandSettingsPage';

export function ClientsPage() {
    const { brand, can } = useBrand();
    const clients = useQuery((api) => api.clients.list(brand.id), [brand.id]);
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const remove = useAction((api, id: string) => api.clients.remove(brand.id, id));
    const [editing, setEditing] = useState<Client | 'new' | null>(null);

    const siteCount = (id: string) => websites.data?.filter((w) => w.clientId === id).length ?? 0;

    return (
        <Page
            title="Clients"
            description={`Clients managed under ${brand.name}`}
            actions={can.write && (
                <Button onClick={() => setEditing('new')}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> New client
                </Button>
            )}
        >
            {remove.error ? <ErrorState error={remove.error} /> : null}
            {clients.loading ? (
                <LoadingState />
            ) : clients.error ? (
                <ErrorState error={clients.error} onRetry={clients.reload} />
            ) : !clients.data!.length ? (
                <EmptyState title="No clients yet" description="Add a client to start tracking their websites." />
            ) : (
                <Table>
                    <THead>
                        <tr>
                            <Th>Name</Th>
                            <Th>Status</Th>
                            <Th className="hidden md:table-cell">Websites</Th>
                            <Th className="hidden lg:table-cell">Goals</Th>
                            {can.write && <Th><span className="sr-only">Actions</span></Th>}
                        </tr>
                    </THead>
                    <TBody>
                        {clients.data!.map((c) => (
                            <tr key={c.id}>
                                <Td>
                                    <p className="font-medium text-gray-900">{c.name}</p>
                                    <p className="text-xs text-gray-500">{c.timezone} · {c.currency}</p>
                                </Td>
                                <Td><Badge variant={c.status === 'active' ? 'green' : 'gray'}>{c.status === 'active' ? 'Active' : 'Archived'}</Badge></Td>
                                <Td className="hidden md:table-cell tabular-nums">{siteCount(c.id)}</Td>
                                <Td className="hidden lg:table-cell max-w-xs truncate">{c.businessGoals ?? '—'}</Td>
                                {can.write && (
                                    <Td className="text-right whitespace-nowrap">
                                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit</Button>
                                        {can.admin && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    if (confirm(`Delete ${c.name} and its ${siteCount(c.id)} website(s)?`)) void remove.run(c.id);
                                                }}
                                            >
                                                Delete
                                            </Button>
                                        )}
                                    </Td>
                                )}
                            </tr>
                        ))}
                    </TBody>
                </Table>
            )}
            {editing && <ClientDialog client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
        </Page>
    );
}

function ClientDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
    const { brand } = useBrand();
    const [form, setForm] = useState<Required<ClientInput>>({
        name: client?.name ?? '',
        status: client?.status ?? 'active',
        timezone: client?.timezone ?? brand.timezone,
        currency: client?.currency ?? brand.currency,
        businessGoals: client?.businessGoals ?? '',
    });
    const save = useAction((api) => (client ? api.clients.update(brand.id, client.id, form) : api.clients.create(brand.id, form)));
    const errors = fieldErrors(save.error);
    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    return (
        <Dialog
            open
            title={client ? 'Edit client' : 'New client'}
            onClose={onClose}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button loading={save.pending} onClick={async () => (await save.run()) && onClose()}>
                        {client ? 'Save' : 'Create client'}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Field id="client-name" label="Name" required>
                    <Input id="client-name" value={form.name} error={errors.name ?? errors.slug} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field id="client-status" label="Status">
                        <Select id="client-status" value={form.status} onChange={(e) => set('status', e.target.value as Client['status'])}>
                            <option value="active">Active</option>
                            <option value="archived">Archived</option>
                        </Select>
                    </Field>
                    <Field id="client-tz" label="Timezone">
                        <Select id="client-tz" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                            {[...new Set([form.timezone, ...TIMEZONES])].map((t) => <option key={t}>{t}</option>)}
                        </Select>
                    </Field>
                    <Field id="client-currency" label="Currency">
                        <Select id="client-currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                            {[...new Set([form.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
                        </Select>
                    </Field>
                </div>
                <Field id="client-goals" label="Business goals">
                    <Textarea id="client-goals" rows={3} value={form.businessGoals ?? ''} onChange={(e) => set('businessGoals', e.target.value)} />
                </Field>
            </div>
        </Dialog>
    );
}
