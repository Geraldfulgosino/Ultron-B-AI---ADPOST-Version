/**
 * Settings → AI Providers / Models / Routing / Usage.
 * Administrators connect authorized providers (by server-side secret slot, never a key),
 * test them through the server, and assign models to agents. No code change, rebuild or
 * restart is needed to switch an agent's provider.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { KeyRound, PlugZap } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, StatCard, Table, TBody, Td, Th, THead } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import { AI_PROVIDERS, CAPABILITY_LABEL, CONNECTION_STATUS, FALLBACK_LABEL, providerInfo, type AiProviderCode, type Capability, type FallbackPolicy } from '@/domain/aiProviders';
import type { AiAssignmentView, AiConnectionTestView, AiConnectionView, AiUsageRow } from '@/data/contracts';
import type { AgentInstance } from '@/domain/types';
import { cn, formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import { clientBase } from '@/app/paths';

const TABS = [
    { to: 'settings/ai-providers', label: 'Providers' },
    { to: 'settings/ai-models', label: 'Models' },
    { to: 'settings/ai-routing', label: 'Agent routing' },
    { to: 'settings/ai-usage', label: 'Usage' },
];

function AiTabs() {
    const { brand } = useBrand();
    return (
        <nav aria-label="AI settings" className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map((t) => (
                <NavLink key={t.to} to={`${clientBase(brand)}/${t.to}`} end={false}
                    className={({ isActive }) => cn('rounded-t-md px-3 py-2 text-sm font-medium', isActive ? 'border-b-2 border-indigo-600 text-fg' : 'text-fg-muted hover:text-fg')}>
                    {t.label}
                </NavLink>
            ))}
        </nav>
    );
}

export function StatusBadge({ status }: { status: AiConnectionView['status'] }) {
    const s = CONNECTION_STATUS[status];
    return <Badge variant={s.variant}>{s.label}</Badge>;
}

const usd = (v: number | null) => (v === null ? '—' : formatCurrency(v));
const toNum = (v: string) => (v.trim() === '' ? null : Number(v));

function BillingNotice() {
    return (
        <Alert tone="info">
            Live providers need an <strong>API account with its own billing</strong> (Anthropic Console or OpenAI Platform). Claude.ai, Claude Code, ChatGPT and Codex
            subscriptions do not provide API access for this app. Keys are stored only as server secrets (<code>supabase secrets set</code>); this page stores the
            secret's <em>slot name</em>. Also set spending limits in the provider's console: limits here are safeguards, not billing controls.
        </Alert>
    );
}

// ── Providers list ────────────────────────────────────────────────────────

export function AiProvidersPage() {
    const { brand } = useBrand();
    const access = useQuery((a) => a.ai.access(brand.id), [brand.id]);
    const conns = useQuery((a) => a.ai.connections(brand.id), [brand.id]);
    return (
        <Page title="AI Providers" description="Connections the agents of this brand can use. Switching an agent's model needs no code change."
            actions={access.data?.canManageConnections ? <Link to={`${clientBase(brand)}/settings/ai-providers/new`}><Button><PlugZap className="h-4 w-4" aria-hidden="true" /> Add connection</Button></Link> : null}>
            <AiTabs />
            <BillingNotice />
            {access.data && !access.data.canManageConnections && <Alert tone="info">You can view connections and assign them to agents. Only agency administrators add, rotate or remove connections.</Alert>}
            {conns.loading ? <LoadingState /> : conns.error ? <ErrorState error={conns.error} onRetry={conns.reload} /> : !conns.data!.length ? (
                <EmptyState title="No AI connections" description="An agency administrator can add an Anthropic or OpenAI connection." />
            ) : (
                <Card>
                    <Table aria-label="AI provider connections">
                        <THead><tr><Th>Connection</Th><Th>Provider</Th><Th className="hidden md:table-cell">Scope</Th><Th>Status</Th><Th className="hidden lg:table-cell">Last verified</Th><Th className="hidden lg:table-cell">Agents</Th><Th className="hidden xl:table-cell">Last error</Th></tr></THead>
                        <TBody>
                            {conns.data!.map((c) => (
                                <tr key={c.id}>
                                    <Td>
                                        <Link className="font-medium text-indigo-600 hover:underline" to={`${clientBase(brand)}/settings/ai-providers/${c.id}`}>{c.displayName}</Link>
                                        <span className="block text-xs text-fg-muted">{c.credentialReference ? <><KeyRound className="mr-1 inline h-3 w-3" aria-hidden="true" />slot {c.credentialReference}</> : c.provider === 'simulated' ? 'No credential' : 'No secret slot set'}</span>
                                    </Td>
                                    <Td>{providerInfo(c.provider).name}</Td>
                                    <Td className="hidden md:table-cell">{c.scope === 'organization' ? 'Organization' : brand.name}</Td>
                                    <Td><StatusBadge status={c.status} /></Td>
                                    <Td className="hidden lg:table-cell text-xs text-fg-muted">{c.lastTestedAt ? formatDateTime(c.lastTestedAt) : 'Never'}</Td>
                                    <Td className="hidden lg:table-cell">{c.assignedAgents.filter((x) => x.brandId === brand.id).length}</Td>
                                    <Td className="hidden xl:table-cell text-xs text-fg-muted">{c.lastErrorCategory?.replace(/_/g, ' ') ?? '—'}</Td>
                                </tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
            )}
        </Page>
    );
}

// ── Add / edit connection ─────────────────────────────────────────────────

interface ConnForm {
    provider: AiProviderCode;
    scope: 'organization' | 'brand';
    displayName: string;
    credentialReference: string;
    apiOrganization: string;
    apiProject: string;
    defaultModel: string;
    maxOutputTokens: string;
    monthlyBudgetUsd: string;
    maxCostPerRequestUsd: string;
    monthlyRequestLimit: string;
    enabled: boolean;
}

const emptyForm = (): ConnForm => ({
    provider: 'anthropic', scope: 'organization', displayName: '', credentialReference: 'ANTHROPIC_API_KEY', apiOrganization: '', apiProject: '',
    defaultModel: '', maxOutputTokens: '1024', monthlyBudgetUsd: '', maxCostPerRequestUsd: '', monthlyRequestLimit: '', enabled: true,
});

function ConnectionFields({ form, setForm, errors, isNew }: { form: ConnForm; setForm: (f: ConnForm) => void; errors: Record<string, string>; isNew: boolean }) {
    const { brand } = useBrand();
    const info = providerInfo(form.provider);
    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field id="ai-provider" label="Provider" required>
                    <Select id="ai-provider" value={form.provider} disabled={!isNew}
                        onChange={(e) => {
                            const p = e.target.value as AiProviderCode;
                            setForm({ ...form, provider: p, credentialReference: providerInfo(p).slotPrefix ?? '' });
                        }}>
                        {AI_PROVIDERS.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                    </Select>
                </Field>
                <Field id="ai-scope" label="Ownership scope" required>
                    <Select id="ai-scope" value={form.scope} disabled={!isNew} onChange={(e) => setForm({ ...form, scope: e.target.value as ConnForm['scope'] })}>
                        <option value="organization">Organization (all brands)</option>
                        <option value="brand">{brand.name} only</option>
                    </Select>
                </Field>
            </div>
            <p className="text-xs text-fg-muted">{info.note}</p>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field id="ai-name" label="Connection display name" required>
                    <Input id="ai-name" value={form.displayName} error={errors.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Company Anthropic API" />
                </Field>
                <Field id="ai-auth" label="Authentication method">
                    <Input id="ai-auth" value={form.provider === 'simulated' ? 'None (offline)' : 'Server-side secret slot (platform-managed)'} disabled readOnly />
                </Field>
            </div>
            {form.provider !== 'simulated' && (
                <>
                    <Field id="ai-slot" label="Server secret slot name">
                        <Input id="ai-slot" value={form.credentialReference} error={errors.credentialReference} autoComplete="off" spellCheck={false}
                            onChange={(e) => setForm({ ...form, credentialReference: e.target.value.toUpperCase() })} placeholder={info.slotPrefix ?? ''} />
                    </Field>
                    <p className="-mt-2 text-xs text-fg-muted">
                        The name of an Edge Function secret, for example <code>{info.slotPrefix}</code> or <code>{info.slotPrefix}_MARKETING</code>. An administrator sets its value
                        with <code>supabase secrets set {info.slotPrefix}=…</code>. Do not paste the key here.
                    </p>
                    {form.provider === 'openai' && (
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field id="ai-org" label="OpenAI organization id (optional)"><Input id="ai-org" value={form.apiOrganization} error={errors.apiOrganization} onChange={(e) => setForm({ ...form, apiOrganization: e.target.value })} /></Field>
                            <Field id="ai-project" label="OpenAI project id (optional)"><Input id="ai-project" value={form.apiProject} error={errors.apiProject} onChange={(e) => setForm({ ...form, apiProject: e.target.value })} /></Field>
                        </div>
                    )}
                </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field id="ai-default-model" label="Default model id (optional)">
                    <Input id="ai-default-model" value={form.defaultModel} error={errors.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} placeholder="Chosen after a successful test" />
                </Field>
                <Field id="ai-max-tokens" label="Max output tokens per request">
                    <Input id="ai-max-tokens" type="number" min={64} max={32000} value={form.maxOutputTokens} error={errors.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} />
                </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
                <Field id="ai-budget" label="Monthly budget (USD)"><Input id="ai-budget" type="number" min={0} step="1" value={form.monthlyBudgetUsd} error={errors.monthlyBudgetUsd} onChange={(e) => setForm({ ...form, monthlyBudgetUsd: e.target.value })} /></Field>
                <Field id="ai-per-request" label="Max cost per request (USD)"><Input id="ai-per-request" type="number" min={0} step="0.01" value={form.maxCostPerRequestUsd} error={errors.maxCostPerRequestUsd} onChange={(e) => setForm({ ...form, maxCostPerRequestUsd: e.target.value })} /></Field>
                <Field id="ai-requests" label="Monthly request limit"><Input id="ai-requests" type="number" min={1} value={form.monthlyRequestLimit} error={errors.monthlyRequestLimit} onChange={(e) => setForm({ ...form, monthlyRequestLimit: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-fg-muted">USD limits apply only to models with verified prices in the model catalog. Without prices, set a monthly token limit under Agent routing.</p>
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
                <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                Enabled
            </label>
        </div>
    );
}

const formToInput = (f: ConnForm) => ({
    displayName: f.displayName, credentialReference: f.provider === 'simulated' ? null : f.credentialReference.trim() || null,
    apiOrganization: f.apiOrganization.trim() || null, apiProject: f.apiProject.trim() || null, defaultModel: f.defaultModel.trim() || null,
    maxOutputTokens: Number(f.maxOutputTokens), monthlyBudgetUsd: toNum(f.monthlyBudgetUsd), maxCostPerRequestUsd: toNum(f.maxCostPerRequestUsd),
    monthlyRequestLimit: toNum(f.monthlyRequestLimit), enabled: f.enabled,
});

export function AiConnectionNewPage() {
    const { brand } = useBrand();
    const navigate = useNavigate();
    const access = useQuery((a) => a.ai.access(brand.id), [brand.id]);
    const [form, setForm] = useState(emptyForm);
    const save = useAction((a) => a.ai.createConnection(brand.id, { provider: form.provider, scope: form.scope, ...formToInput(form) }));
    const errors = fieldErrors(save.error);
    if (access.loading) return <Page title="Add AI connection"><LoadingState /></Page>;
    if (!access.data?.canManageConnections) {
        return <Page title="Add AI connection"><AiTabs /><Alert tone="warning">Only agency administrators can add AI provider connections.</Alert></Page>;
    }
    return (
        <Page title="Add AI connection" description="The connection is saved as configured. It becomes connected only after a server-side test passes.">
            <AiTabs />
            <BillingNotice />
            <Card>
                <CardContent>
                    <form className="space-y-4" noValidate onSubmit={async (e) => {
                        e.preventDefault();
                        const c = await save.run();
                        if (c) navigate(`${clientBase(brand)}/settings/ai-providers/${c.id}`);
                    }}>
                        {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                        <ConnectionFields form={form} setForm={setForm} errors={errors} isNew />
                        <div className="flex gap-2">
                            <Button type="submit" loading={save.pending}>Save connection</Button>
                            <Link to={`${clientBase(brand)}/settings/ai-providers`}><Button type="button" variant="secondary">Cancel</Button></Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </Page>
    );
}

export function AiConnectionDetailPage() {
    const { brand } = useBrand();
    const { connectionId = '' } = useParams();
    const navigate = useNavigate();
    const access = useQuery((a) => a.ai.access(brand.id), [brand.id]);
    const conn = useQuery((a) => a.ai.connection(brand.id, connectionId), [brand.id, connectionId]);
    const checks = useQuery((a) => a.ai.healthChecks(brand.id, connectionId), [brand.id, connectionId]);
    const [form, setForm] = useState<ConnForm | null>(null);
    const [lastTest, setLastTest] = useState<AiConnectionTestView | null>(null);
    const [rotateOpen, setRotateOpen] = useState(false);
    const [newSlot, setNewSlot] = useState('');
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        const c = conn.data;
        if (c) setForm({
            provider: c.provider, scope: c.scope, displayName: c.displayName, credentialReference: c.credentialReference ?? '', apiOrganization: c.apiOrganization ?? '',
            apiProject: c.apiProject ?? '', defaultModel: c.defaultModel ?? '', maxOutputTokens: String(c.maxOutputTokens), monthlyBudgetUsd: c.monthlyBudgetUsd?.toString() ?? '',
            maxCostPerRequestUsd: c.maxCostPerRequestUsd?.toString() ?? '', monthlyRequestLimit: c.monthlyRequestLimit?.toString() ?? '', enabled: c.enabled,
        });
    }, [conn.data]);
    const save = useAction((a) => { const { credentialReference: _ignored, ...rest } = formToInput(form!); return a.ai.updateConnection(brand.id, connectionId, rest); });
    const test = useAction((a) => a.ai.testConnection(brand.id, connectionId));
    const rotate = useAction((a) => a.ai.rotateCredential(brand.id, connectionId, newSlot));
    const toggle = useAction((a, enabled: boolean) => a.ai.updateConnection(brand.id, connectionId, { enabled }));
    const remove = useAction(async (a) => { await a.ai.removeConnection(brand.id, connectionId); return true; });
    const errors = fieldErrors(save.error);
    const manage = !!access.data?.canManageConnections;
    const reload = () => { conn.reload(); checks.reload(); };

    if (conn.loading || !form) return <Page title="AI connection">{conn.error ? <ErrorState error={conn.error} /> : <LoadingState />}</Page>;
    const c = conn.data!;
    const info = providerInfo(c.provider);
    return (
        <Page title={c.displayName} description={`${info.name} · ${c.scope === 'organization' ? 'Organization-wide' : `${brand.name} only`}`}
            actions={
                <>
                    <Button variant="secondary" loading={test.pending} onClick={async () => { const r = await test.run(); if (r) { setLastTest(r); reload(); } }}>Test connection</Button>
                    {manage && <Button variant="secondary" onClick={async () => { if (await toggle.run(!c.enabled)) reload(); }}>{c.enabled ? 'Disable' : 'Enable'}</Button>}
                </>
            }>
            <AiTabs />
            <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={c.status} />
                <span className="text-sm text-fg-muted">Last verified: {c.lastTestedAt ? formatDateTime(c.lastTestedAt) : 'never'}</span>
                {c.lastErrorCategory && <span className="text-sm text-danger-ink">Last error: {c.lastErrorCategory.replace(/_/g, ' ')}</span>}
            </div>
            {c.status === 'configured' && c.provider !== 'simulated' && <Alert tone="warning">Saved but not verified. Agents assigned to this connection fail visibly until a server-side test passes.</Alert>}
            {lastTest && (
                <Alert tone={lastTest.ok ? 'success' : 'warning'}>
                    <strong>{lastTest.ok ? 'Test passed.' : 'Test did not pass.'}</strong> {lastTest.message}
                    {lastTest.ok && lastTest.modelsReported > 0 && ` ${lastTest.modelsReported} model(s) reported.`}
                </Alert>
            )}
            {test.error || toggle.error || remove.error ? <ErrorState error={test.error ?? toggle.error ?? remove.error} /> : null}

            <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                    <Card>
                        <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
                        <CardContent>
                            <form className="space-y-4" noValidate onSubmit={async (e) => {
                                e.preventDefault();
                                setSaved(false);
                                if (await save.run()) { setSaved(true); reload(); }
                            }}>
                                {saved && <Alert tone="success">Connection saved.</Alert>}
                                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                                <fieldset disabled={!manage} className="space-y-4">
                                    <ConnectionFields form={{ ...form, credentialReference: c.credentialReference ?? '' }} setForm={(f) => setForm({ ...f, credentialReference: c.credentialReference ?? '' })} errors={errors} isNew={false} />
                                </fieldset>
                                {manage && <Button type="submit" loading={save.pending}>Save changes</Button>}
                            </form>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Connection tests</CardTitle></CardHeader>
                        <CardContent>
                            {checks.data?.length ? (
                                <ul className="divide-y divide-line text-sm">
                                    {checks.data.map((h) => (
                                        <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                                            <span className="text-xs text-fg-muted">{formatDateTime(h.createdAt)}</span>
                                            <Badge variant={h.result === 'success' ? 'green' : 'yellow'}>{h.result === 'success' ? 'Passed' : h.failureCategory?.replace(/_/g, ' ') ?? 'Failed'}</Badge>
                                            <span className="w-full text-xs text-fg-muted">{h.message}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="text-sm text-fg-muted">No tests yet.</p>}
                        </CardContent>
                    </Card>
                </div>
                <div className="space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Credential</CardTitle></CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            {c.provider === 'simulated' ? <p className="text-fg-muted">The simulator uses no credential.</p> : (
                                <>
                                    <p><span className="text-fg-muted">Secret slot:</span> <code>{c.credentialReference ?? 'not set'}</code></p>
                                    <p className="text-xs text-fg-muted">The key value is never shown, stored in the database or sent to the browser.</p>
                                    {manage && <Button variant="secondary" onClick={() => { setNewSlot(c.credentialReference ?? info.slotPrefix ?? ''); setRotateOpen(true); }}>Rotate credential</Button>}
                                </>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Models reported</CardTitle></CardHeader>
                        <CardContent>
                            {c.verifiedModels.length ? <ul className="space-y-1 text-sm">{c.verifiedModels.slice(0, 30).map((m) => <li key={m}><code>{m}</code></li>)}</ul> : <p className="text-sm text-fg-muted">Available after a successful server-side test.</p>}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Assigned agents</CardTitle></CardHeader>
                        <CardContent>
                            {c.assignedAgents.filter((x) => x.brandId === brand.id).length ? (
                                <ul className="space-y-1 text-sm">{c.assignedAgents.filter((x) => x.brandId === brand.id).map((x) => <li key={x.agentInstanceId}><Link className="text-indigo-600 hover:underline" to={`${clientBase(brand)}/agents/${x.agentInstanceId}`}>{x.name}</Link></li>)}</ul>
                            ) : <p className="text-sm text-fg-muted">None in {brand.name}.</p>}
                            <Link className="mt-3 inline-block text-sm text-indigo-600 hover:underline" to={`${clientBase(brand)}/settings/ai-routing`}>Assign agents</Link>
                        </CardContent>
                    </Card>
                    {manage && <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove connection</Button>}
                </div>
            </div>

            <Dialog open={rotateOpen} title="Rotate credential" onClose={() => setRotateOpen(false)}
                footer={<><Button variant="secondary" onClick={() => setRotateOpen(false)}>Cancel</Button><Button loading={rotate.pending} onClick={async () => { if (await rotate.run()) { setRotateOpen(false); reload(); } }}>Use this slot</Button></>}>
                <div className="space-y-3 text-sm">
                    <p>1. Store the new key in a server secret slot, for example <code>supabase secrets set {info.slotPrefix}_NEW=…</code>. 2. Enter that slot name here. 3. Test the connection. 4. Revoke the old key in the provider console.</p>
                    <Field id="ai-new-slot" label="New secret slot name">
                        <Input id="ai-new-slot" value={newSlot} autoComplete="off" error={fieldErrors(rotate.error).credentialReference} onChange={(e) => setNewSlot(e.target.value.toUpperCase())} />
                    </Field>
                    <p className="text-xs text-fg-muted">Rotation resets the status to “configured” until the next successful test.</p>
                </div>
            </Dialog>
            <Dialog open={confirmRemove} title="Remove connection" onClose={() => setConfirmRemove(false)}
                footer={<><Button variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="danger" loading={remove.pending} onClick={async () => { if (await remove.run()) { setConfirmRemove(false); navigate(`${clientBase(brand)}/settings/ai-providers`); } else setConfirmRemove(false); }}>Remove</Button></>}>
                <p className="text-sm">Agents must be reassigned first. Past usage and execution records keep their history. The server secret is not deleted; remove it with <code>supabase secrets unset</code> if no longer needed.</p>
            </Dialog>
        </Page>
    );
}

// ── Model catalog ─────────────────────────────────────────────────────────

const ALL_CAPS = Object.keys(CAPABILITY_LABEL) as Capability[];

export function AiModelsPage() {
    const { brand } = useBrand();
    const access = useQuery((a) => a.ai.access(brand.id), [brand.id]);
    const models = useQuery((a) => a.ai.models(brand.id), [brand.id]);
    const [form, setForm] = useState({ provider: 'anthropic' as AiProviderCode, modelId: '', displayName: '', capabilities: ['text'] as Capability[], maxOutputTokens: '', contextWindow: '', input: '', output: '', source: '' });
    const save = useAction((a) => a.ai.saveModel(brand.id, {
        provider: form.provider, modelId: form.modelId.trim(), displayName: form.displayName, capabilities: form.capabilities, maxOutputTokens: toNum(form.maxOutputTokens),
        contextWindow: toNum(form.contextWindow), inputUsdPerMTok: toNum(form.input), outputUsdPerMTok: toNum(form.output), pricingSource: form.source.trim() || null,
    }));
    const errors = fieldErrors(save.error);
    return (
        <Page title="AI Models" description="Model capabilities and prices used for routing and budgets. Enter only verified values: unknown stays unknown.">
            <AiTabs />
            {models.loading ? <LoadingState /> : models.error ? <ErrorState error={models.error} /> : (
                <Card>
                    <Table aria-label="AI model catalog">
                        <THead><tr><Th>Model</Th><Th>Provider</Th><Th>Capabilities</Th><Th className="hidden md:table-cell">Max output</Th><Th className="hidden md:table-cell">Price (USD / 1M tokens)</Th><Th className="hidden lg:table-cell">Price source</Th></tr></THead>
                        <TBody>
                            {models.data!.map((m) => (
                                <tr key={m.id}>
                                    <Td><span className="font-medium">{m.displayName}</span><code className="block text-xs text-fg-muted">{m.modelId}</code></Td>
                                    <Td>{providerInfo(m.provider).name}</Td>
                                    <Td className="text-xs">{m.capabilities.map((x) => CAPABILITY_LABEL[x]).join(', ') || '—'}</Td>
                                    <Td className="hidden md:table-cell">{m.maxOutputTokens ? formatNumber(m.maxOutputTokens) : 'Unknown'}</Td>
                                    <Td className="hidden md:table-cell">{m.inputUsdPerMTok === null ? <span className="text-fg-muted">Unknown</span> : `${m.inputUsdPerMTok} in / ${m.outputUsdPerMTok} out`}</Td>
                                    <Td className="hidden lg:table-cell text-xs text-fg-muted">{m.pricingSource ? `${m.pricingSource} (${formatDateTime(m.pricingVerifiedAt!)})` : '—'}</Td>
                                </tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
            )}
            {access.data?.canManageConnections && (
                <Card>
                    <CardHeader><CardTitle>Add or update a model</CardTitle></CardHeader>
                    <CardContent>
                        <form className="space-y-4" noValidate onSubmit={async (e) => { e.preventDefault(); if (await save.run()) models.reload(); }}>
                            {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field id="m-provider" label="Provider"><Select id="m-provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as AiProviderCode })}>{AI_PROVIDERS.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
                                <Field id="m-id" label="Exact model id" required><Input id="m-id" value={form.modelId} error={errors.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="As reported by the connection test" /></Field>
                                <Field id="m-name" label="Display name" required><Input id="m-name" value={form.displayName} error={errors.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
                            </div>
                            <fieldset>
                                <legend className="mb-1 text-sm font-medium text-fg-secondary">Verified capabilities</legend>
                                <div className="flex flex-wrap gap-4">
                                    {ALL_CAPS.map((cap) => (
                                        <label key={cap} className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={form.capabilities.includes(cap)}
                                                onChange={() => setForm({ ...form, capabilities: form.capabilities.includes(cap) ? form.capabilities.filter((x) => x !== cap) : [...form.capabilities, cap] })} />
                                            {CAPABILITY_LABEL[cap]}
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field id="m-max" label="Max output tokens (if documented)"><Input id="m-max" type="number" value={form.maxOutputTokens} error={errors.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} /></Field>
                                <Field id="m-ctx" label="Context window (if documented)"><Input id="m-ctx" type="number" value={form.contextWindow} error={errors.contextWindow} onChange={(e) => setForm({ ...form, contextWindow: e.target.value })} /></Field>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field id="m-in" label="Input price (USD / 1M tokens)"><Input id="m-in" type="number" step="0.0001" value={form.input} error={errors.inputUsdPerMTok} onChange={(e) => setForm({ ...form, input: e.target.value })} /></Field>
                                <Field id="m-out" label="Output price (USD / 1M tokens)"><Input id="m-out" type="number" step="0.0001" value={form.output} error={errors.outputUsdPerMTok} onChange={(e) => setForm({ ...form, output: e.target.value })} /></Field>
                                <Field id="m-src" label="Price source"><Input id="m-src" value={form.source} error={errors.pricingSource} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Provider pricing page, checked on …" /></Field>
                            </div>
                            <Button type="submit" loading={save.pending}>Save model</Button>
                        </form>
                    </CardContent>
                </Card>
            )}
        </Page>
    );
}

// ── Agent routing ─────────────────────────────────────────────────────────

export function AiRoutingPage() {
    const { brand } = useBrand();
    const access = useQuery((a) => a.ai.access(brand.id), [brand.id]);
    const agents = useQuery((a) => a.agents.list(brand.id), [brand.id]);
    const conns = useQuery((a) => a.ai.connections(brand.id), [brand.id]);
    const assignments = useQuery((a) => a.ai.assignments(brand.id), [brand.id]);
    const policies = useQuery((a) => a.ai.policies(brand.id), [brand.id]);
    const [editing, setEditing] = useState<AgentInstance | null>(null);
    const unassign = useAction((a, id: string) => a.ai.unassign(brand.id, id));
    if (agents.loading || conns.loading || assignments.loading || policies.loading) return <Page title="Agent routing"><AiTabs /><LoadingState /></Page>;
    const err = agents.error ?? conns.error ?? assignments.error ?? policies.error;
    if (err) return <Page title="Agent routing"><AiTabs /><ErrorState error={err} /></Page>;
    const byAgent = new Map(assignments.data!.map((a) => [a.agentInstanceId, a]));
    const canAssign = !!access.data?.canAssign;
    return (
        <Page title="Agent routing" description="Choose the provider connection and model for each agent. Changes apply to the next message; history keeps the model that was actually used.">
            <AiTabs />
            <Alert tone="info">Priority: conversation override (admins) → agent assignment → brand default → organization default. If the chosen connection is unusable the run fails visibly; it never silently moves to another provider.</Alert>
            {unassign.error ? <ErrorState error={unassign.error} /> : null}
            <Card>
                <Table aria-label="Agent model assignments">
                    <THead><tr><Th>Agent</Th><Th>Connection</Th><Th>Model</Th><Th className="hidden md:table-cell">Fallback</Th><Th className="hidden lg:table-cell">Notes</Th>{canAssign && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
                    <TBody>
                        {agents.data!.map((agent) => {
                            const a = byAgent.get(agent.id);
                            return (
                                <tr key={agent.id}>
                                    <Td><Link className="font-medium text-indigo-600 hover:underline" to={`${clientBase(brand)}/agents/${agent.id}`}>{agent.displayName}</Link></Td>
                                    <Td>{a ? <span className="flex flex-wrap items-center gap-2">{a.connectionName} <StatusBadge status={a.connectionStatus} /></span> : <span className="text-fg-muted">Brand / organization default</span>}</Td>
                                    <Td>{a ? <code className="text-xs">{a.modelId}</code> : <span className="text-xs text-fg-muted">—</span>}</Td>
                                    <Td className="hidden md:table-cell text-xs">{a ? FALLBACK_LABEL[a.fallbackPolicy] : '—'}</Td>
                                    <Td className="hidden lg:table-cell text-xs text-warning-ink">{a?.warnings.join(' ') ?? ''}</Td>
                                    {canAssign && (
                                        <Td className="whitespace-nowrap text-right">
                                            <Button size="sm" variant="secondary" onClick={() => setEditing(agent)}>{a ? 'Change' : 'Assign'}</Button>
                                            {a && <Button size="sm" variant="ghost" onClick={async () => { await unassign.run(agent.id); assignments.reload(); }}>Clear</Button>}
                                        </Td>
                                    )}
                                </tr>
                            );
                        })}
                    </TBody>
                </Table>
            </Card>
            <div className="grid gap-6 lg:grid-cols-2">
                <PolicyCard level="organization" title="Organization defaults" editable={!!access.data?.canManageConnections} connections={conns.data!.filter((c) => c.scope === 'organization')} policy={policies.data!.organization} onSaved={policies.reload} />
                <PolicyCard level="brand" title={`${brand.name} defaults`} editable={canAssign} connections={conns.data!} policy={policies.data!.brand} onSaved={policies.reload} />
            </div>
            {editing && <AssignDialog agent={editing} current={byAgent.get(editing.id) ?? null} connections={conns.data!} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); assignments.reload(); }} />}
        </Page>
    );
}

function AssignDialog({ agent, current, connections, onClose, onSaved }: { agent: AgentInstance; current: AiAssignmentView | null; connections: AiConnectionView[]; onClose: () => void; onSaved: () => void }) {
    const { brand } = useBrand();
    const usable = connections.filter((c) => c.enabled);
    const [form, setForm] = useState({
        connectionId: current?.connectionId ?? usable[0]?.id ?? '', modelId: current?.modelId ?? '', temperature: current?.generationConfig.temperature?.toString() ?? '',
        fallbackPolicy: (current?.fallbackPolicy ?? 'disabled') as FallbackPolicy, fallbackConnectionId: current?.fallbackConnectionId ?? '', fallbackModelId: current?.fallbackModelId ?? '',
    });
    const conn = connections.find((c) => c.id === form.connectionId);
    useEffect(() => {
        if (!form.modelId && conn) setForm((f) => ({ ...f, modelId: conn.defaultModel ?? conn.verifiedModels[0] ?? (conn.provider === 'simulated' ? 'sim-deterministic-1' : '') }));
    }, [conn, form.modelId]);
    const save = useAction((a) => a.ai.assign(brand.id, agent.id, {
        connectionId: form.connectionId, modelId: form.modelId.trim(), temperature: toNum(form.temperature), fallbackPolicy: form.fallbackPolicy,
        fallbackConnectionId: form.fallbackConnectionId || null, fallbackModelId: form.fallbackModelId.trim() || null,
    }));
    const errors = fieldErrors(save.error);
    return (
        <Dialog open title={`AI model for ${agent.displayName}`} onClose={onClose}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.pending} onClick={async () => { if (await save.run()) onSaved(); }}>Save assignment</Button></>}>
            <div className="space-y-4">
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Field id="as-conn" label="Provider connection" required>
                    <Select id="as-conn" value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value, modelId: '' })}>
                        {usable.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({CONNECTION_STATUS[c.status].label})</option>)}
                    </Select>
                </Field>
                {errors.connectionId && <p className="text-xs text-danger">{errors.connectionId}</p>}
                <Field id="as-model" label="Model id" required>
                    {conn && conn.verifiedModels.length ? (
                        <Select id="as-model" value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })}>
                            {conn.verifiedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                    ) : (
                        <Input id="as-model" value={form.modelId} error={errors.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="Test the connection to list models" />
                    )}
                </Field>
                <Field id="as-temp" label="Temperature (optional, 0–2)"><Input id="as-temp" type="number" step="0.1" min={0} max={2} value={form.temperature} error={errors.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} /></Field>
                <Field id="as-fallback" label="Fallback policy">
                    <Select id="as-fallback" value={form.fallbackPolicy} onChange={(e) => setForm({ ...form, fallbackPolicy: e.target.value as FallbackPolicy })}>
                        {(Object.keys(FALLBACK_LABEL) as FallbackPolicy[]).map((p) => <option key={p} value={p}>{FALLBACK_LABEL[p]}</option>)}
                    </Select>
                </Field>
                {form.fallbackPolicy === 'secondary_provider' && (
                    <Field id="as-fb-conn" label="Fallback connection">
                        <Select id="as-fb-conn" value={form.fallbackConnectionId} onChange={(e) => setForm({ ...form, fallbackConnectionId: e.target.value })}>
                            <option value="">Choose…</option>
                            {usable.filter((c) => c.id !== form.connectionId).map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                        </Select>
                    </Field>
                )}
                {errors.fallbackConnectionId && <p className="text-xs text-danger">{errors.fallbackConnectionId}</p>}
                {(form.fallbackPolicy === 'secondary_model' || form.fallbackPolicy === 'secondary_provider') && (
                    <Field id="as-fb-model" label="Fallback model id"><Input id="as-fb-model" value={form.fallbackModelId} error={errors.fallbackModelId} onChange={(e) => setForm({ ...form, fallbackModelId: e.target.value })} /></Field>
                )}
                <p className="text-xs text-fg-muted">Agent instructions, tools and SEO skills stay the same whichever provider you choose.</p>
            </div>
        </Dialog>
    );
}

function PolicyCard({ level, title, editable, connections, policy, onSaved }: {
    level: 'organization' | 'brand'; title: string; editable: boolean; connections: AiConnectionView[];
    policy: import('@/domain/aiProviders').AiRoutingPolicy | null; onSaved: () => void;
}) {
    const { brand } = useBrand();
    const init = () => ({
        defaultConnectionId: policy?.defaultConnectionId ?? '', defaultModel: policy?.defaultModel ?? '', allow: policy?.allowCrossProviderFallback ?? false,
        monthlyBudgetUsd: policy?.monthlyBudgetUsd?.toString() ?? '', perUser: policy?.perUserMonthlyBudgetUsd?.toString() ?? '', perRequest: policy?.maxCostPerRequestUsd?.toString() ?? '',
        requests: policy?.monthlyRequestLimit?.toString() ?? '', tokens: policy?.monthlyTokenLimit?.toString() ?? '',
    });
    const [f, setF] = useState(init);
    const [saved, setSaved] = useState(false);
    useEffect(() => setF(init()), [policy]); // eslint-disable-line react-hooks/exhaustive-deps
    const save = useAction((a) => a.ai.updatePolicy(brand.id, level, {
        defaultConnectionId: f.defaultConnectionId || null, defaultModel: f.defaultModel.trim() || null, allowCrossProviderFallback: f.allow,
        monthlyBudgetUsd: toNum(f.monthlyBudgetUsd), perUserMonthlyBudgetUsd: toNum(f.perUser), maxCostPerRequestUsd: toNum(f.perRequest),
        monthlyRequestLimit: toNum(f.requests), monthlyTokenLimit: toNum(f.tokens),
    }));
    const errors = fieldErrors(save.error);
    const id = (s: string) => `${level}-${s}`;
    return (
        <Card>
            <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
            <CardContent>
                <form className="space-y-3" noValidate onSubmit={async (e) => { e.preventDefault(); setSaved(false); if (await save.run()) { setSaved(true); onSaved(); } }}>
                    {saved && <Alert tone="success">Saved.</Alert>}
                    {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                    <fieldset disabled={!editable} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field id={id('conn')} label="Default connection">
                                <Select id={id('conn')} value={f.defaultConnectionId} onChange={(e) => setF({ ...f, defaultConnectionId: e.target.value })}>
                                    <option value="">None</option>
                                    {connections.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                                </Select>
                            </Field>
                            <Field id={id('model')} label="Default model id"><Input id={id('model')} value={f.defaultModel} error={errors.defaultModel} onChange={(e) => setF({ ...f, defaultModel: e.target.value })} /></Field>
                        </div>
                        {errors.defaultConnectionId && <p className="text-xs text-danger">{errors.defaultConnectionId}</p>}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field id={id('tokens')} label="Monthly token limit"><Input id={id('tokens')} type="number" min={1} value={f.tokens} error={errors.monthlyTokenLimit} onChange={(e) => setF({ ...f, tokens: e.target.value })} /></Field>
                            <Field id={id('requests')} label="Monthly request limit"><Input id={id('requests')} type="number" min={1} value={f.requests} error={errors.monthlyRequestLimit} onChange={(e) => setF({ ...f, requests: e.target.value })} /></Field>
                            <Field id={id('budget')} label="Monthly budget (USD)"><Input id={id('budget')} type="number" min={0} value={f.monthlyBudgetUsd} error={errors.monthlyBudgetUsd} onChange={(e) => setF({ ...f, monthlyBudgetUsd: e.target.value })} /></Field>
                            <Field id={id('user')} label="Per-user monthly budget (USD)"><Input id={id('user')} type="number" min={0} value={f.perUser} error={errors.perUserMonthlyBudgetUsd} onChange={(e) => setF({ ...f, perUser: e.target.value })} /></Field>
                            <Field id={id('request')} label="Max cost per request (USD)"><Input id={id('request')} type="number" min={0} step="0.01" value={f.perRequest} error={errors.maxCostPerRequestUsd} onChange={(e) => setF({ ...f, perRequest: e.target.value })} /></Field>
                        </div>
                        <label className="flex items-start gap-2 text-sm text-fg-secondary">
                            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line-strong" checked={f.allow} onChange={(e) => setF({ ...f, allow: e.target.checked })} />
                            <span>Allow fallback to a <strong>different provider</strong>. Company data may then be sent to that provider. Both the organization and the brand must allow it.</span>
                        </label>
                    </fieldset>
                    {editable ? <Button type="submit" loading={save.pending}>Save {level === 'organization' ? 'organization' : 'brand'} policy</Button> : <p className="text-xs text-fg-muted">{level === 'organization' ? 'Only agency administrators change organization policy.' : 'Only brand administrators change this policy.'}</p>}
                </form>
            </CardContent>
        </Card>
    );
}

// ── Usage ─────────────────────────────────────────────────────────────────

function UsageTable({ title, rows }: { title: string; rows: AiUsageRow[] }) {
    return (
        <Card>
            <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
            {rows.length ? (
                <Table aria-label={title}>
                    <THead><tr><Th>Name</Th><Th>Requests</Th><Th>Failures</Th><Th className="hidden sm:table-cell">Input tokens</Th><Th className="hidden sm:table-cell">Output tokens</Th><Th>Cost</Th></tr></THead>
                    <TBody>
                        {rows.map((r) => (
                            <tr key={r.key}>
                                <Td>{r.label}</Td><Td>{formatNumber(r.requests)}</Td><Td>{formatNumber(r.failures)}</Td>
                                <Td className="hidden sm:table-cell">{formatNumber(r.inputTokens)}</Td><Td className="hidden sm:table-cell">{formatNumber(r.outputTokens)}</Td>
                                <Td>{usd(r.estimatedCostUsd)}{r.unpriced > 0 && <span className="block text-xs text-warning-ink">{r.unpriced} unpriced</span>}</Td>
                            </tr>
                        ))}
                    </TBody>
                </Table>
            ) : <CardContent><p className="text-sm text-fg-muted">No requests in this window.</p></CardContent>}
        </Card>
    );
}

export function AiUsagePage() {
    const { brand } = useBrand();
    const today = new Date().toISOString().slice(0, 10);
    const [range, setRange] = useState({ from: new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10), to: today });
    const usage = useQuery((a) => a.ai.usage(brand.id, range), [brand.id, range.from, range.to]);
    return (
        <Page title="AI Usage" description="Requests, tokens and cost by provider, model, agent and user. Costs appear only for models with verified prices.">
            <AiTabs />
            <div className="flex flex-wrap items-end gap-3">
                <Field id="u-from" label="From"><Input id="u-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
                <Field id="u-to" label="To"><Input id="u-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
            </div>
            {usage.loading ? <LoadingState /> : usage.error ? <ErrorState error={usage.error} /> : (() => {
                const u = usage.data!;
                return (
                    <>
                        {u.scope === 'own' && <Alert tone="info">You are seeing your own requests. Brand administrators see all usage.</Alert>}
                        <Alert tone="info">These numbers come from execution records. They are safeguards, not invoices: check the provider console for billing.</Alert>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard label="Requests" value={formatNumber(u.totals.requests)} hint={`${formatNumber(u.totals.failures)} failed`} />
                            <StatCard label="Input tokens" value={formatNumber(u.totals.inputTokens)} />
                            <StatCard label="Output tokens" value={formatNumber(u.totals.outputTokens)} />
                            <StatCard label="Cost" value={usd(u.totals.estimatedCostUsd)} hint={u.totals.unpriced ? `${u.totals.unpriced} request(s) with unknown cost` : 'From verified prices only'} />
                        </div>
                        <div className="grid gap-6 lg:grid-cols-2">
                            <UsageTable title="By provider" rows={u.byProvider} />
                            <UsageTable title="By model" rows={u.byModel} />
                            <UsageTable title="By agent" rows={u.byAgent} />
                            <UsageTable title="By user" rows={u.byUser} />
                        </div>
                        <Card>
                            <CardHeader><CardTitle>Daily</CardTitle></CardHeader>
                            {u.daily.length ? (
                                <Table aria-label="Daily usage">
                                    <THead><tr><Th>Date</Th><Th>Requests</Th><Th>Tokens</Th><Th>Failures</Th></tr></THead>
                                    <TBody>{u.daily.map((d) => <tr key={d.date}><Td>{d.date}</Td><Td>{formatNumber(d.requests)}</Td><Td>{formatNumber(d.tokens)}</Td><Td>{formatNumber(d.failures)}</Td></tr>)}</TBody>
                                </Table>
                            ) : <CardContent><p className="text-sm text-fg-muted">No requests in this window.</p></CardContent>}
                        </Card>
                    </>
                );
            })()}
        </Page>
    );
}
