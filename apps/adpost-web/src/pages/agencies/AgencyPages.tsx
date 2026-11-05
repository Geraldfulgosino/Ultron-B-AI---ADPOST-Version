/**
 * Platform directory, agency overview, client management and agency settings.
 * Numbers are counts of stored records only; analytics show "Not connected" until a real
 * integration exists. Permanent deletion is not offered: archive and restore instead.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Building2, ChevronRight, LogOut, Plus, Search, Zap } from 'lucide-react';
import { fieldErrors, useAction, useBackend, useQuery } from '@/app/backend';
import { agencyBase, clientBase } from '@/app/paths';
import { useAgency } from '@/layouts/AgencyLayout';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, StatCard, Table, TBody, Td, Textarea, Th, THead } from '@/components/ui';
import type { AgencyClientInput, AgencyView, ClientCard } from '@/data/contracts';
import type { LifecycleStatus } from '@/domain/types';
import { ThemeToggle } from '@/theme/ThemeToggle';
import { formatNumber, slugify } from '@/lib/utils';

const STATUS: Record<LifecycleStatus, { label: string; variant: 'green' | 'gray' | 'yellow' }> = {
    active: { label: 'Active', variant: 'green' },
    inactive: { label: 'Inactive', variant: 'yellow' },
    archived: { label: 'Archived', variant: 'gray' },
};
export const StatusPill = ({ status }: { status: LifecycleStatus }) => <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;

function Filters({ query, setQuery, status, setStatus, label }: { query: string; setQuery: (q: string) => void; status: LifecycleStatus | 'all'; setStatus: (s: LifecycleStatus | 'all') => void; label: string }) {
    return (
        <div className="flex flex-wrap items-end gap-3">
            <Field id={`${label}-search`} label={`Search ${label}`}>
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-fg-subtle" aria-hidden="true" />
                    <Input id={`${label}-search`} className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or slug" />
                </div>
            </Field>
            <Field id={`${label}-status`} label="Status">
                <Select id={`${label}-status`} value={status} onChange={(e) => setStatus(e.target.value as LifecycleStatus | 'all')}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                </Select>
            </Field>
        </div>
    );
}

// ── Platform / agency directory ───────────────────────────────────────────

export function AgenciesPage() {
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<LifecycleStatus | 'all'>('active');
    const isPlatform = useQuery((api) => api.agencies.isPlatformAdmin(), []);
    const agencies = useQuery((api) => api.agencies.list({ status, query }), [status, query]);
    const overview = useQuery((api) => (isPlatform.data ? api.agencies.platformOverview() : Promise.resolve(null)), [isPlatform.data]);
    const [creating, setCreating] = useState(false);
    const toggle = useAction((api, a: AgencyView) => api.agencies.update(a.id, { status: a.status === 'archived' ? 'active' : 'archived' }));

    return (
        <div className="min-h-screen bg-canvas">
            <header className="border-b border-line bg-surface">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
                    <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600"><Zap className="h-4 w-4 text-white" aria-hidden="true" /></span>
                        <div>
                            <p className="text-sm font-bold text-fg">ULTRON-B AI</p>
                            <p className="text-xs text-fg-muted">Signed in as {session?.user.email}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        <button type="button" className="flex items-center gap-1 text-sm text-fg-soft hover:text-fg" onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}>
                            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                        </button>
                    </div>
                </div>
            </header>
            <main id="main" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 px-4 py-8 focus:outline-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-lg font-semibold text-fg">Agencies</h1>
                        <p className="text-sm text-fg-muted">Choose an agency, then a client.</p>
                    </div>
                    {isPlatform.data && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Add agency</Button>}
                </div>
                {overview.data && (
                    <section aria-label="Platform overview" className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                        <StatCard label="Agencies" value={formatNumber(overview.data.agencies)} />
                        <StatCard label="Clients" value={formatNumber(overview.data.clients)} />
                        <StatCard label="Websites" value={formatNumber(overview.data.websites)} hint={overview.data.demoWebsites ? `${overview.data.demoWebsites} demo records (not live websites)` : undefined} />
                        <StatCard label="Users" value={formatNumber(overview.data.activeUsers)} />
                        <StatCard label="AI requests (month)" value={formatNumber(overview.data.aiRequestsThisMonth)} />
                        <StatCard label="Integrations" value={overview.data.integrations.connected ? formatNumber(overview.data.integrations.connected) : 'None connected'} hint={overview.data.integrations.error ? `${overview.data.integrations.error} with errors` : undefined} />
                    </section>
                )}
                {isPlatform.data && <Alert tone="info">Platform administrators manage the agency directory. Client data is visible only to members of each agency.</Alert>}
                <Filters query={query} setQuery={setQuery} status={status} setStatus={setStatus} label="agencies" />
                {toggle.error ? <ErrorState error={toggle.error} /> : null}
                {agencies.loading ? <LoadingState /> : agencies.error ? <ErrorState error={agencies.error} onRetry={agencies.reload} /> : !agencies.data!.length ? (
                    <EmptyState title={query || status !== 'all' ? 'No agencies match these filters' : 'You do not belong to any agency yet'} description="Ask an administrator to invite you." />
                ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Agencies">
                        {agencies.data!.map((a) => (
                            <li key={a.id} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                                <Link to={agencyBase(a.slug)} className="flex items-start gap-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft"><Building2 className="h-5 w-5 text-accent" aria-hidden="true" /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-medium text-fg truncate">{a.name}</span>
                                        <span className="block text-xs text-fg-muted">
                                            {a.counts ? `${a.counts.clients} client${a.counts.clients === 1 ? '' : 's'} · ${a.counts.websites} website${a.counts.websites === 1 ? '' : 's'}${a.counts.demoWebsites ? ` (${a.counts.demoWebsites} demo)` : ''}` : 'Directory only'}
                                        </span>
                                    </span>
                                    <StatusPill status={a.status} />
                                    <ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                                </Link>
                                {a.access.canChangeStatus && (
                                    <div className="mt-3 border-t border-line pt-3">
                                        <Button size="sm" variant="secondary" onClick={async () => { if (await toggle.run(a)) agencies.reload(); }}>
                                            {a.status === 'archived' ? 'Restore' : 'Archive'} {a.name}
                                        </Button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </main>
            {creating && <AgencyDialog onClose={() => setCreating(false)} onSaved={(a) => { setCreating(false); navigate(agencyBase(a.slug)); }} />}
        </div>
    );
}

function AgencyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (a: AgencyView) => void }) {
    const [form, setForm] = useState({ name: '', slug: '', description: '', timezone: 'UTC', defaultCurrency: 'USD', contactEmail: '' });
    const save = useAction((api) => api.agencies.create({ ...form, slug: form.slug || slugify(form.name), contactEmail: form.contactEmail || null }));
    const errors = fieldErrors(save.error);
    return (
        <Dialog open title="Add agency" onClose={onClose}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.pending} onClick={async () => { const a = await save.run(); if (a) onSaved(a); }}>Create agency</Button></>}>
            <div className="space-y-3">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Field id="ag-name" label="Agency name" required><Input id="ag-name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field id="ag-slug" label="Slug (permanent)"><Input id="ag-slug" value={form.slug} placeholder={slugify(form.name)} error={errors.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
                <Field id="ag-desc" label="Description"><Textarea id="ag-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="ag-tz" label="Timezone"><Input id="ag-tz" value={form.timezone} error={errors.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
                    <Field id="ag-cur" label="Default currency"><Input id="ag-cur" value={form.defaultCurrency} error={errors.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })} /></Field>
                </div>
                <Field id="ag-email" label="Contact email (optional)"><Input id="ag-email" type="email" value={form.contactEmail} error={errors.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
                <p className="text-xs text-fg-muted">You become the agency owner and can then add clients and invite members.</p>
            </div>
        </Dialog>
    );
}

// ── Agency overview ───────────────────────────────────────────────────────

export function AgencyOverviewPage() {
    const { agency } = useAgency();
    const overview = useQuery((api) => (agency.counts ? api.agencies.overview(agency.id) : Promise.resolve(null)), [agency.id, agency.counts?.clients]);
    const clients = useQuery((api) => api.agencies.clients(agency.id, { status: 'active' }), [agency.id]);
    return (
        <>
            <div>
                <h1 className="text-lg font-semibold text-fg">{agency.name}</h1>
                {agency.description && <p className="text-sm text-fg-muted">{agency.description}</p>}
            </div>
            {agency.status === 'archived' && <Alert tone="warning">This agency is archived. A platform administrator can restore it.</Alert>}
            {!agency.counts ? (
                <Alert tone="info">You can see this agency in the directory. Its clients and activity are visible to agency members only.</Alert>
            ) : overview.loading ? <LoadingState /> : overview.error ? <ErrorState error={overview.error} /> : overview.data && (
                <section aria-label="Agency overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard label="Clients" value={formatNumber(overview.data.clients)} />
                    <StatCard label="Websites" value={formatNumber(overview.data.websites)} hint={[overview.data.demoWebsites ? `${overview.data.demoWebsites} demo records` : '', overview.data.websitesWithoutUrl ? `${overview.data.websitesWithoutUrl} without a URL yet` : ''].filter(Boolean).join(' · ') || undefined} />
                    <StatCard label="Active projects" value={formatNumber(overview.data.activeProjects)} />
                    <StatCard label="Open tasks" value={formatNumber(overview.data.openTasks)} />
                    <StatCard label="AI runs this month" value={formatNumber(overview.data.aiRunsThisMonth)} />
                    <StatCard label="Analytics integrations" value={overview.data.integrations.connected ? `${overview.data.integrations.connected} connected` : 'Not connected'}
                        hint={overview.data.integrations.error ? `${overview.data.integrations.error} with errors` : overview.data.integrations.pending ? `${overview.data.integrations.pending} pending` : 'SEO performance appears once GA4 or Search Console is connected.'} />
                </section>
            )}
            {agency.counts && (
                <Card>
                    <CardHeader className="flex items-center justify-between">
                        <CardTitle>Clients</CardTitle>
                        <Link className="text-sm text-accent hover:text-accent-strong" to={`${agencyBase(agency.slug)}/clients`}>Manage clients</Link>
                    </CardHeader>
                    <CardContent>
                        {clients.loading ? <LoadingState /> : !clients.data?.length ? <p className="text-sm text-fg-muted">No active clients.</p> : (
                            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Active clients">
                                {clients.data.map((c) => (
                                    <li key={c.client.id}>
                                        <Link to={`${clientBase(c.client)}/dashboard`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-accent-line-strong">
                                            <span className="font-medium text-fg">{c.client.name}</span>
                                            <span className="text-xs text-fg-muted">{c.counts.websites ? `${c.counts.websites} website${c.counts.websites === 1 ? '' : 's'}` : 'No websites'}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            )}
        </>
    );
}

// ── Clients ───────────────────────────────────────────────────────────────

export function AgencyClientsPage() {
    const { agency, reload } = useAgency();
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<LifecycleStatus | 'all'>('active');
    const clients = useQuery((api) => api.agencies.clients(agency.id, { status, query }), [agency.id, status, query]);
    const [editing, setEditing] = useState<ClientCard | 'new' | null>(null);
    const toggle = useAction((api, c: ClientCard) => api.agencies.updateClient(c.client.id, { status: c.client.status === 'archived' ? 'active' : 'archived' }));
    const after = () => { clients.reload(); reload(); };

    if (!agency.counts) return <Alert tone="info">Client data is visible to agency members only.</Alert>;
    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold text-fg">{agency.name} clients</h1>
                    <p className="text-sm text-fg-muted">Each client has its own websites, agents, chats, knowledge and reports.</p>
                </div>
                {agency.access.canAddClients && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" /> Add client</Button>}
            </div>
            <Filters query={query} setQuery={setQuery} status={status} setStatus={setStatus} label="clients" />
            {toggle.error ? <ErrorState error={toggle.error} /> : null}
            {clients.loading ? <LoadingState /> : clients.error ? <ErrorState error={clients.error} onRetry={clients.reload} /> : !clients.data!.length ? (
                <EmptyState title="No clients match these filters" description={agency.access.canAddClients ? 'Add a client to get started.' : undefined} />
            ) : (
                <Card>
                    <Table aria-label={`${agency.name} clients`}>
                        <THead><tr><Th>Client</Th><Th>Status</Th><Th>Websites</Th><Th className="hidden md:table-cell">Projects</Th><Th className="hidden md:table-cell">Open tasks</Th><Th className="hidden lg:table-cell">Integrations</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
                        <TBody>
                            {clients.data!.map((c) => (
                                <tr key={c.client.id}>
                                    <Td>
                                        <Link className="font-medium text-indigo-600 hover:underline" to={`${clientBase(c.client)}/dashboard`}>{c.client.name}</Link>
                                        <span className="block text-xs text-fg-muted">{[c.client.industry, c.roleLabel].filter(Boolean).join(' · ')}</span>
                                    </Td>
                                    <Td><StatusPill status={c.client.status} /></Td>
                                    <Td>
                                        {c.counts.websites ? formatNumber(c.counts.websites) : (
                                            <Link className="text-sm text-accent hover:text-accent-strong" to={`${clientBase(c.client)}/websites`}>Add website</Link>
                                        )}
                                        {c.primaryWebsite && <span className="block text-xs text-fg-muted">{c.primaryWebsite.domain ?? c.primaryWebsite.name}</span>}
                                    </Td>
                                    <Td className="hidden md:table-cell">{c.counts.projects ?? '—'}</Td>
                                    <Td className="hidden md:table-cell">{c.counts.openTasks ?? '—'}</Td>
                                    <Td className="hidden lg:table-cell">{c.counts.connectedIntegrations === null ? '—' : c.counts.connectedIntegrations ? `${c.counts.connectedIntegrations} connected` : 'Not connected'}</Td>
                                    <Td className="whitespace-nowrap text-right">
                                        {c.canAdmin && (
                                            <>
                                                <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Edit ${c.client.name}`}>Edit</Button>
                                                <Button size="sm" variant="ghost" onClick={async () => { if (await toggle.run(c)) after(); }} aria-label={`${c.client.status === 'archived' ? 'Restore' : 'Archive'} ${c.client.name}`}>
                                                    {c.client.status === 'archived' ? 'Restore' : 'Archive'}
                                                </Button>
                                            </>
                                        )}
                                    </Td>
                                </tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
            )}
            {editing && <ClientDialog card={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); after(); }} />}
        </>
    );
}

function ClientDialog({ card, onClose, onSaved }: { card: ClientCard | null; onClose: () => void; onSaved: () => void }) {
    const { agency } = useAgency();
    const c = card?.client;
    const [form, setForm] = useState({
        name: c?.name ?? '', slug: c?.slug ?? '', displayName: c?.displayName ?? '', industry: c?.industry ?? '', description: c?.description ?? '',
        primaryContactName: c?.primaryContactName ?? '', primaryContactEmail: c?.primaryContactEmail ?? '', status: (c?.status ?? 'active') as LifecycleStatus,
    });
    const input = (): AgencyClientInput => ({
        name: form.name, displayName: form.displayName || null, industry: form.industry || null, description: form.description,
        primaryContactName: form.primaryContactName || null, primaryContactEmail: form.primaryContactEmail || null, status: form.status,
    });
    const save = useAction((api) => (c ? api.agencies.updateClient(c.id, input()) : api.agencies.createClient(agency.id, { ...input(), slug: form.slug || slugify(form.name) })));
    const errors = fieldErrors(save.error);
    return (
        <Dialog open title={c ? `Edit ${c.name}` : `Add client to ${agency.name}`} onClose={onClose}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.pending} onClick={async () => { if (await save.run()) onSaved(); }}>{c ? 'Save client' : 'Create client'}</Button></>}>
            <div className="space-y-3">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="cl-name" label="Client name" required><Input id="cl-name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                    <Field id="cl-slug" label={c ? 'Slug (permanent)' : 'Slug (unique in this agency)'}>
                        <Input id="cl-slug" value={c ? form.slug : form.slug} disabled={!!c} placeholder={slugify(form.name)} error={errors.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
                    </Field>
                    <Field id="cl-display" label="Display name (optional)"><Input id="cl-display" value={form.displayName} error={errors.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
                    <Field id="cl-industry" label="Industry (optional)"><Input id="cl-industry" value={form.industry} error={errors.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
                </div>
                <Field id="cl-desc" label="Description"><Textarea id="cl-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="cl-contact" label="Primary contact (optional)"><Input id="cl-contact" value={form.primaryContactName} onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })} /></Field>
                    <Field id="cl-email" label="Contact email (optional)"><Input id="cl-email" type="email" value={form.primaryContactEmail} error={errors.primaryContactEmail} onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })} /></Field>
                </div>
                <Field id="cl-status" label="Status">
                    <Select id="cl-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as LifecycleStatus })}>
                        <option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
                    </Select>
                </Field>
                {!c && <p className="text-xs text-fg-muted">The client gets its own six AI agents. Add websites after creating it.</p>}
            </div>
        </Dialog>
    );
}

// ── Agency settings ───────────────────────────────────────────────────────

export function AgencySettingsPage() {
    const { agency, reload } = useAgency();
    const init = () => ({ name: agency.name, description: agency.description, logoUrl: agency.logoUrl ?? '', timezone: agency.timezone, defaultCurrency: agency.defaultCurrency, contactEmail: agency.contactEmail ?? '' });
    const [form, setForm] = useState(init);
    const [saved, setSaved] = useState(false);
    useEffect(() => setForm(init()), [agency]); // eslint-disable-line react-hooks/exhaustive-deps
    const save = useAction((api) => api.agencies.update(agency.id, { ...form, logoUrl: form.logoUrl || null, contactEmail: form.contactEmail || null }));
    const status = useAction((api, s: LifecycleStatus) => api.agencies.update(agency.id, { status: s }));
    const errors = fieldErrors(save.error);
    const readOnly = !agency.access.canEdit;
    return (
        <>
            <h1 className="text-lg font-semibold text-fg">{agency.name} settings</h1>
            <Card>
                <CardHeader><CardTitle>Agency profile</CardTitle></CardHeader>
                <CardContent>
                    <form className="space-y-3" noValidate onSubmit={async (e) => { e.preventDefault(); setSaved(false); if (await save.run()) { setSaved(true); reload(); } }}>
                        {saved && <Alert tone="success">Agency saved.</Alert>}
                        {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                        <fieldset disabled={readOnly} className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field id="as-name" label="Name" required><Input id="as-name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                                <Field id="as-slug" label="Slug (permanent)"><Input id="as-slug" value={agency.slug} disabled readOnly /></Field>
                                <Field id="as-tz" label="Timezone"><Input id="as-tz" value={form.timezone} error={errors.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
                                <Field id="as-cur" label="Default currency"><Input id="as-cur" value={form.defaultCurrency} error={errors.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })} /></Field>
                                <Field id="as-logo" label="Logo URL (https, optional)"><Input id="as-logo" value={form.logoUrl} error={errors.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} /></Field>
                                <Field id="as-email" label="Contact email (optional)"><Input id="as-email" type="email" value={form.contactEmail} error={errors.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
                            </div>
                            <Field id="as-desc" label="Description"><Textarea id="as-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                        </fieldset>
                        {readOnly ? <p className="text-xs text-fg-muted">Only agency owners and admins edit the agency profile.</p> : <Button type="submit" loading={save.pending}>Save agency</Button>}
                    </form>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>Status</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <p className="flex items-center gap-2">Current status: <StatusPill status={agency.status} /></p>
                    {status.error ? <ErrorState error={status.error} /> : null}
                    {agency.access.canChangeStatus ? (
                        <div className="flex flex-wrap gap-2">
                            {agency.status !== 'active' && <Button variant="secondary" loading={status.pending} onClick={async () => { if (await status.run('active')) reload(); }}>Restore to active</Button>}
                            {agency.status === 'active' && <Button variant="secondary" loading={status.pending} onClick={async () => { if (await status.run('inactive')) reload(); }}>Mark inactive</Button>}
                            {agency.status !== 'archived' && <Button variant="danger" loading={status.pending} onClick={async () => { if (await status.run('archived')) reload(); }}>Archive agency</Button>}
                        </div>
                    ) : <p className="text-xs text-fg-muted">Only platform administrators archive or restore agencies. Agencies are never permanently deleted here.</p>}
                </CardContent>
            </Card>
        </>
    );
}
