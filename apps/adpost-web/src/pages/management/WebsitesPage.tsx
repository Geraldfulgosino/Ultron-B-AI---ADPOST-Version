/**
 * Client websites: add, edit, archive/restore, set primary, and a per-website detail page.
 * A website without a URL is an incomplete draft: never crawled, audited or treated as connected.
 * Production and staging are separate records; nothing (credentials, properties) is copied between them.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Table, TBody, Td, Textarea, Th, THead } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import { clientBase } from '@/app/paths';
import type { Website, WebsiteEnvironment, WebsitePlatform } from '@/domain/types';
import { ENVIRONMENT_LABELS, isAuditable, PLATFORM_LABELS } from '@/domain/websites';
import { StatusPill } from '@/pages/agencies/AgencyPages';
import { formatDateTime } from '@/lib/utils';

const ENV_VARIANT: Record<WebsiteEnvironment, 'green' | 'yellow' | 'gray'> = { production: 'green', staging: 'yellow', development: 'gray' };
export const EnvBadge = ({ env }: { env: WebsiteEnvironment }) => <Badge variant={ENV_VARIANT[env]}>{ENVIRONMENT_LABELS[env]}</Badge>;

export function WebsitesPage() {
    const { brand, can } = useBrand();
    const [showArchived, setShowArchived] = useState(false);
    const websites = useQuery((api) => api.websites.list(brand.id, { includeArchived: showArchived }), [brand.id, showArchived]);
    const [editing, setEditing] = useState<Website | 'new' | null>(null);
    const update = useAction((api, id: string, patch: Partial<Pick<Website, 'status' | 'isPrimary'>>) => api.websites.update(brand.id, id, patch));
    const base = clientBase(brand);

    return (
        <Page title="Websites" description={`${brand.name}'s websites. Each has its own analytics, audits, tasks and reports.`}
            actions={can.write ? <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" /> Add website</Button> : null}>
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
                <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived websites
            </label>
            {update.error ? <ErrorState error={update.error} /> : null}
            {websites.loading ? <LoadingState /> : websites.error ? <ErrorState error={websites.error} onRetry={websites.reload} /> : !websites.data!.length ? (
                <EmptyState title="No websites yet" description={can.write ? `Add ${brand.name}'s first website. You can save it without a URL and complete it later.` : 'No websites have been added for this client.'} />
            ) : (
                <Table aria-label={`${brand.name} websites`}>
                    <THead><tr><Th>Website</Th><Th>Environment</Th><Th className="hidden md:table-cell">Platform</Th><Th>Status</Th>{can.write && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
                    <TBody>
                        {websites.data!.map((w) => (
                            <tr key={w.id}>
                                <Td>
                                    <Link className="font-medium text-indigo-600 hover:underline" to={`${base}/websites/${w.id}`}>{w.name}</Link>
                                    {w.isPrimary && <Badge variant="indigo" className="ml-2">Primary</Badge>}
                                    {w.isDemo && <Badge variant="yellow" className="ml-2">Demo</Badge>}
                                    <span className="block text-xs text-fg-muted">{w.isDemo ? `${w.websiteUrl} · demo record, not a verified live website` : w.websiteUrl ?? 'No URL yet (draft): not crawled or monitored'}</span>
                                </Td>
                                <Td><EnvBadge env={w.environment} /></Td>
                                <Td className="hidden md:table-cell">{PLATFORM_LABELS[w.platform]}</Td>
                                <Td><StatusPill status={w.status} /></Td>
                                {can.write && (
                                    <Td className="whitespace-nowrap text-right">
                                        <Button size="sm" variant="secondary" onClick={() => setEditing(w)} aria-label={`Edit ${w.name}`}>Edit</Button>
                                        {!w.isPrimary && w.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => void update.run(w.id, { isPrimary: true })} aria-label={`Make ${w.name} primary`}>Make primary</Button>}
                                        <Button size="sm" variant="ghost" onClick={() => void update.run(w.id, { status: w.status === 'archived' ? 'active' : 'archived' })} aria-label={`${w.status === 'archived' ? 'Restore' : 'Archive'} ${w.name}`}>
                                            {w.status === 'archived' ? 'Restore' : 'Archive'}
                                        </Button>
                                    </Td>
                                )}
                            </tr>
                        ))}
                    </TBody>
                </Table>
            )}
            {editing && <WebsiteDialog site={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); websites.reload(); }} />}
        </Page>
    );
}

function WebsiteDialog({ site, onClose, onSaved }: { site: Website | null; onClose: () => void; onSaved: () => void }) {
    const { brand } = useBrand();
    const [form, setForm] = useState({
        name: site?.name ?? '', websiteUrl: site?.websiteUrl ?? '', environment: site?.environment ?? ('production' as WebsiteEnvironment),
        platform: site?.platform ?? ('unknown' as WebsitePlatform), status: site?.status ?? ('active' as Website['status']), isPrimary: site?.isPrimary ?? false,
        description: site?.description ?? '', primaryConversion: site?.primaryConversion ?? '',
    });
    const input = { ...form, websiteUrl: form.websiteUrl.trim() || null, primaryConversion: form.primaryConversion.trim() || null };
    const save = useAction((api) => (site ? api.websites.update(brand.id, site.id, input) : api.websites.create(brand.id, input)));
    const errors = fieldErrors(save.error);
    return (
        <Dialog open title={site ? `Edit ${site.name}` : `Add website to ${brand.name}`} onClose={onClose}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.pending} onClick={async () => { if (await save.run()) onSaved(); }}>{site ? 'Save website' : 'Add website'}</Button></>}>
            <div className="space-y-3">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Field id="ws-name" label="Website name" required><Input id="ws-name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Production site" /></Field>
                <Field id="ws-url" label="Website URL (optional)"><Input id="ws-url" value={form.websiteUrl} error={errors.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://" /></Field>
                <p className="-mt-2 text-xs text-fg-muted">The domain is taken from the URL. Without a URL the website is saved as a draft and is not crawled or monitored.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                    <Field id="ws-env" label="Environment">
                        <Select id="ws-env" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as WebsiteEnvironment })}>
                            {(Object.keys(ENVIRONMENT_LABELS) as WebsiteEnvironment[]).map((k) => <option key={k} value={k}>{ENVIRONMENT_LABELS[k]}</option>)}
                        </Select>
                    </Field>
                    <Field id="ws-platform" label="Platform">
                        <Select id="ws-platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as WebsitePlatform })}>
                            {(Object.keys(PLATFORM_LABELS) as WebsitePlatform[]).map((k) => <option key={k} value={k}>{PLATFORM_LABELS[k]}</option>)}
                        </Select>
                    </Field>
                    <Field id="ws-status" label="Status">
                        <Select id="ws-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Website['status'] })}>
                            <option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
                        </Select>
                    </Field>
                </div>
                <Field id="ws-conv" label="Primary conversion (optional)"><Input id="ws-conv" value={form.primaryConversion} onChange={(e) => setForm({ ...form, primaryConversion: e.target.value })} /></Field>
                <Field id="ws-desc" label="Description"><Textarea id="ws-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <label className="flex items-center gap-2 text-sm text-fg-secondary">
                    <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
                    Primary website for {brand.name}
                </label>
                {form.environment !== 'production' && <p className="text-xs text-fg-muted">Non-production websites never inherit the production website's integrations or credentials.</p>}
            </div>
        </Dialog>
    );
}

/** Website dashboard: details, integrations, SEO, audit, projects and reports. No placeholder metrics. */
export function WebsiteDetailPage() {
    const { websiteId = '' } = useParams();
    const { brand } = useBrand();
    const site = useQuery((api) => api.websites.get(brand.id, websiteId), [brand.id, websiteId]);
    const integrations = useQuery((api) => api.integrations.list(brand.id), [brand.id]);
    const projects = useQuery((api) => api.work.projects(brand.id), [brand.id]);
    const range = useQuery((api) => api.analytics.dataRange(brand.id), [brand.id]);
    const base = clientBase(brand);

    if (site.loading) return <Page title="Website"><LoadingState /></Page>;
    if (site.error || !site.data) return <Page title="Website"><ErrorState error={site.error} /></Page>;
    const w = site.data;
    const own = (integrations.data ?? []).filter((i) => i.websiteId === w.id);
    const connected = own.filter((i) => i.status === 'connected');
    const sitesProjects = (projects.data ?? []).filter((p) => p.websiteId === w.id);
    return (
        <Page title={w.name} description={w.websiteUrl ?? 'Draft website: no URL yet'} actions={<Link to={`${base}/websites`} className="text-sm text-accent hover:text-accent-strong">All websites</Link>}>
            <div className="flex flex-wrap items-center gap-2">
                <EnvBadge env={w.environment} /> <StatusPill status={w.status} /> {w.isPrimary && <Badge variant="indigo">Primary</Badge>} {w.isDemo && <Badge variant="yellow">Demo</Badge>}
            </div>
            {w.isDemo && <Alert tone="warning">Demo record for local testing. {w.domain} is a reserved example domain, not a real or verified website: it is never crawled, verified, monitored or connected, and any analysis of it is a simulation.</Alert>}
            {!w.websiteUrl && <Alert tone="info">This website has no URL yet. It will not be crawled, audited or monitored until a valid URL is saved.</Alert>}
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader><CardTitle>Details</CardTitle></CardHeader>
                    <CardContent>
                        <dl className="grid grid-cols-2 gap-y-2 text-sm">
                            <dt className="text-fg-muted">Domain</dt><dd>{w.domain ?? '—'}</dd>
                            <dt className="text-fg-muted">Platform</dt><dd>{PLATFORM_LABELS[w.platform]}</dd>
                            <dt className="text-fg-muted">Environment</dt><dd>{ENVIRONMENT_LABELS[w.environment]}</dd>
                            <dt className="text-fg-muted">Primary conversion</dt><dd>{w.primaryConversion ?? '—'}</dd>
                            <dt className="text-fg-muted">Added</dt><dd>{formatDateTime(w.createdAt)}</dd>
                        </dl>
                        {w.description && <p className="mt-3 text-sm text-fg-secondary">{w.description}</p>}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex items-center justify-between"><CardTitle>Integrations</CardTitle><Link className="text-sm text-accent hover:text-accent-strong" to={`${base}/integrations`}>Manage</Link></CardHeader>
                    <CardContent className="text-sm">
                        {own.length ? (
                            <ul className="space-y-1">{own.map((i) => <li key={i.id} className="flex justify-between"><span>{i.provider === 'google_analytics' ? 'Google Analytics 4' : 'Search Console'}</span><span className="text-fg-muted">{i.status}</span></li>)}</ul>
                        ) : <p className="text-fg-muted">Not connected. Analytics and Search Console data appear here only after a real integration syncs.</p>}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex items-center justify-between"><CardTitle>SEO overview</CardTitle>{connected.length > 0 && <Link className="text-sm text-accent hover:text-accent-strong" to={`${base}/seo?website=${w.id}`}>Open</Link>}</CardHeader>
                    <CardContent className="text-sm text-fg-muted">
                        {connected.length && range.data ? `Data available from ${range.data.from} to ${range.data.to}.` : 'No data. Connect Google Analytics or Search Console for this website first.'}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Technical audit</CardTitle></CardHeader>
                    <CardContent className="text-sm text-fg-muted">
                        {w.isDemo
                            ? 'Disabled: demo records are never crawled or audited.'
                            : isAuditable(w)
                            ? 'No audits yet. Audits run through the server-side SEO tools (page metadata, robots.txt, sitemap, llms.txt) and only for this website’s URL. Ask the Technical SEO agent with this website selected.'
                            : 'Not available: an active website with a URL is required before any audit can run.'}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex items-center justify-between"><CardTitle>Projects and tasks</CardTitle><Link className="text-sm text-accent hover:text-accent-strong" to={`${base}/projects`}>All projects</Link></CardHeader>
                    <CardContent className="text-sm">
                        {sitesProjects.length ? (
                            <ul className="space-y-1">{sitesProjects.map((p) => <li key={p.id} className="flex justify-between"><span>{p.name}</span><span className="text-fg-muted">{Object.entries(p.taskCounts).filter(([k]) => k !== 'done').reduce((n, [, v]) => n + v, 0)} open tasks</span></li>)}</ul>
                        ) : <p className="text-fg-muted">No projects linked to this website.</p>}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Reports</CardTitle></CardHeader>
                    <CardContent className="text-sm text-fg-muted">
                        {connected.length ? <Link className="text-accent hover:text-accent-strong" to={`${base}/reports?website=${w.id}`}>Build a report for this website</Link> : 'Reports need connected analytics data for this website.'}
                    </CardContent>
                </Card>
            </div>
        </Page>
    );
}
