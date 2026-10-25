import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Label, LoadingState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import type { Website, WebsitePlatform } from '@/domain/types';

const PLATFORMS: Record<WebsitePlatform, string> = { wordpress: 'WordPress', shopify: 'Shopify', custom: 'Custom', other: 'Other' };

export function WebsitesPage() {
    const { brand, can } = useBrand();
    const [clientFilter, setClientFilter] = useState('');
    const clients = useQuery((api) => api.clients.list(brand.id), [brand.id]);
    const websites = useQuery((api) => api.websites.list(brand.id, clientFilter ? { clientId: clientFilter } : undefined), [brand.id, clientFilter]);
    const remove = useAction((api, id: string) => api.websites.remove(brand.id, id));
    const [editing, setEditing] = useState<Website | 'new' | null>(null);
    const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? '';

    return (
        <Page
            title="Websites"
            description="Tracked websites and their analytics properties"
            actions={can.write && clients.data?.length ? (
                <Button onClick={() => setEditing('new')}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> New website
                </Button>
            ) : null}
        >
            {(clients.data?.length ?? 0) > 1 && (
                <div className="max-w-xs">
                    <Label htmlFor="website-client-filter">Client</Label>
                    <Select id="website-client-filter" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                        <option value="">All clients</option>
                        {clients.data!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                </div>
            )}
            {remove.error ? <ErrorState error={remove.error} /> : null}
            {websites.loading ? (
                <LoadingState />
            ) : websites.error ? (
                <ErrorState error={websites.error} onRetry={websites.reload} />
            ) : !websites.data!.length ? (
                <EmptyState title="No websites" description={clients.data?.length ? 'Add a website to start tracking it.' : 'Create a client first, then add its websites.'} />
            ) : (
                <Table>
                    <THead>
                        <tr>
                            <Th>Website</Th>
                            <Th className="hidden md:table-cell">Client</Th>
                            <Th className="hidden md:table-cell">Platform</Th>
                            <Th className="hidden lg:table-cell">Primary conversion</Th>
                            <Th>Status</Th>
                            {can.write && <Th><span className="sr-only">Actions</span></Th>}
                        </tr>
                    </THead>
                    <TBody>
                        {websites.data!.map((w) => (
                            <tr key={w.id}>
                                <Td>
                                    <p className="font-medium text-gray-900">{w.name}</p>
                                    <p className="text-xs text-gray-500">{w.domain}</p>
                                </Td>
                                <Td className="hidden md:table-cell">{clientName(w.clientId)}</Td>
                                <Td className="hidden md:table-cell">{PLATFORMS[w.platform]}</Td>
                                <Td className="hidden lg:table-cell">{w.primaryConversion ?? '—'}</Td>
                                <Td><Badge variant={w.status === 'active' ? 'green' : 'gray'}>{w.status === 'active' ? 'Active' : 'Archived'}</Badge></Td>
                                {can.write && (
                                    <Td className="text-right whitespace-nowrap">
                                        <Button variant="ghost" size="sm" onClick={() => setEditing(w)}>Edit</Button>
                                        {can.admin && (
                                            <Button variant="ghost" size="sm" onClick={() => confirm(`Delete ${w.name}? Its integrations are removed too.`) && void remove.run(w.id)}>
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
            {editing && <WebsiteDialog website={editing === 'new' ? null : editing} clients={clients.data ?? []} onClose={() => setEditing(null)} />}
        </Page>
    );
}

function WebsiteDialog({ website, clients, onClose }: { website: Website | null; clients: Array<{ id: string; name: string }>; onClose: () => void }) {
    const { brand } = useBrand();
    const [form, setForm] = useState({
        clientId: website?.clientId ?? clients[0]?.id ?? '',
        name: website?.name ?? '',
        domain: website?.domain ?? '',
        platform: website?.platform ?? ('custom' as WebsitePlatform),
        status: website?.status ?? ('active' as Website['status']),
        primaryConversion: website?.primaryConversion ?? '',
        ga4PropertyId: website?.ga4PropertyId ?? '',
        gscSiteUrl: website?.gscSiteUrl ?? '',
    });
    const save = useAction((api) => (website ? api.websites.update(brand.id, website.id, form) : api.websites.create(brand.id, form)));
    const errors = fieldErrors(save.error);
    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    return (
        <Dialog
            open
            title={website ? 'Edit website' : 'New website'}
            onClose={onClose}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button loading={save.pending} onClick={async () => (await save.run()) && onClose()}>
                        {website ? 'Save' : 'Create website'}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Field id="site-client" label="Client" required>
                    <Select id="site-client" value={form.clientId} onChange={(e) => set('clientId', e.target.value)}>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                    {errors.clientId && <p className="mt-1 text-xs text-red-600">{errors.clientId}</p>}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="site-name" label="Name" required>
                        <Input id="site-name" value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
                    </Field>
                    <Field id="site-domain" label="Domain" required hint="e.g. example.com">
                        <Input id="site-domain" value={form.domain} error={errors.domain} onChange={(e) => set('domain', e.target.value)} />
                    </Field>
                    <Field id="site-platform" label="Platform">
                        <Select id="site-platform" value={form.platform} onChange={(e) => set('platform', e.target.value as WebsitePlatform)}>
                            {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                    </Field>
                    <Field id="site-status" label="Status">
                        <Select id="site-status" value={form.status} onChange={(e) => set('status', e.target.value as Website['status'])}>
                            <option value="active">Active</option>
                            <option value="archived">Archived</option>
                        </Select>
                    </Field>
                </div>
                <Field id="site-conversion" label="Primary conversion">
                    <Input id="site-conversion" value={form.primaryConversion} onChange={(e) => set('primaryConversion', e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="site-ga4" label="GA4 property ID">
                        <Input id="site-ga4" placeholder="properties/123456" value={form.ga4PropertyId} onChange={(e) => set('ga4PropertyId', e.target.value)} />
                    </Field>
                    <Field id="site-gsc" label="Search Console property">
                        <Input id="site-gsc" placeholder="sc-domain:example.com" value={form.gscSiteUrl} onChange={(e) => set('gscSiteUrl', e.target.value)} />
                    </Field>
                </div>
            </div>
        </Dialog>
    );
}
