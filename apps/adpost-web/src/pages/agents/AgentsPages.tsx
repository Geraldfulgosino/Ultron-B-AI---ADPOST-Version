import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Bot } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Field, Input, Label, LoadingState, Select, Table, TBody, Td, Textarea, Th, THead } from '@/components/ui';
import { fieldErrors, useAction, useApi, useBrand, useQuery } from '@/app/backend';
import { MODEL_CATALOG, TOOL_LABELS, ALL_TOOLS, modelOption, templateByKey } from '@/domain/agents';
import type { AgentInstance, ExecutionMode, ExecutionStatus, ToolKey } from '@/domain/types';
import type { AgentUsage } from '@/data/contracts';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';

export const EXEC_STATUS: Record<ExecutionStatus, { label: string; variant: 'green' | 'red' | 'yellow' | 'blue' }> = {
    succeeded: { label: 'Succeeded', variant: 'green' },
    failed: { label: 'Failed', variant: 'red' },
    limited: { label: 'Limited', variant: 'yellow' },
    running: { label: 'Running', variant: 'blue' },
};

export function ModeBadge({ mode }: { mode: ExecutionMode }) {
    return mode === 'simulated' ? <Badge variant="blue">Simulated</Badge> : <Badge variant="green">Live</Badge>;
}

function UsageLine({ agent, usage }: { agent: AgentInstance; usage?: AgentUsage }) {
    if (!usage) return null;
    const pct = agent.limits.monthlyBudgetUsd ? Math.min(1, usage.costMonthUsd / agent.limits.monthlyBudgetUsd) : 1;
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs text-fg-muted">
                <span>{formatCurrency(usage.costMonthUsd)} of {formatCurrency(agent.limits.monthlyBudgetUsd)} this month</span>
                <span>{usage.runsToday}/{agent.limits.maxRunsPerDay} runs today</span>
            </div>
            <div className="h-1.5 rounded-full bg-accent-muted" role="meter" aria-label={`${agent.displayName} monthly budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
                <div className={`h-1.5 rounded-full ${pct >= 0.9 ? 'bg-red-600' : pct >= 0.7 ? 'bg-warning-soft0' : 'bg-indigo-600'}`} style={{ width: `${pct * 100}%` }} />
            </div>
        </div>
    );
}

export function AgentsPage() {
    const { brand, can } = useBrand();
    const api = useApi();
    const agents = useQuery((a) => a.agents.list(brand.id), [brand.id]);
    const usage = useQuery((a) => a.agents.usage(brand.id), [brand.id]);
    const toggle = useAction((a, agent: AgentInstance) => a.agents.update(brand.id, agent.id, { active: !agent.active }));
    const provision = useAction((a, key: AgentInstance['templateKey']) => a.agents.provision(brand.id, key));
    const missing = api.agents.templates().filter((t) => !agents.data?.some((a) => a.templateKey === t.key));

    return (
        <Page title="AI Agents" description={`${brand.name}'s specialist workforce. Each agent is configured for this brand only.`}>
            <Alert tone="info">
                Agents run on the <strong>simulated</strong> offline provider until Supabase and server-side model keys are connected (Phase 17). Simulated replies are always labelled.
            </Alert>
            {toggle.error || provision.error ? <ErrorState error={toggle.error ?? provision.error} /> : null}
            {agents.loading ? (
                <LoadingState />
            ) : agents.error ? (
                <ErrorState error={agents.error} onRetry={agents.reload} />
            ) : (
                <>
                    {!agents.data!.length && <EmptyState title="No agents provisioned" />}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {agents.data!.map((a) => {
                            const t = templateByKey(a.templateKey);
                            return (
                                <Card key={a.id} className="flex flex-col">
                                    <CardHeader className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <Link to={a.id} className="font-semibold text-fg hover:text-accent-strong">{a.displayName}</Link>
                                            <p className="text-xs text-fg-muted">@{a.handle} · {t.team === 'seo' ? 'SEO team' : 'Web team'}</p>
                                        </div>
                                        <Badge variant={a.active ? 'green' : 'gray'}>{a.active ? 'Active' : 'Inactive'}</Badge>
                                    </CardHeader>
                                    <CardContent className="flex-1 space-y-3">
                                        <p className="text-sm text-fg-soft">{t.description}</p>
                                        <p className="text-xs text-fg-muted">{modelOption(a.model)?.label ?? a.model.model} · {a.tools.length} tools</p>
                                        <UsageLine agent={a} usage={usage.data?.find((u) => u.agentInstanceId === a.id)} />
                                    </CardContent>
                                    <div className="flex gap-2 border-t border-line-subtle px-6 py-3">
                                        <Link to={a.id} className="text-sm font-medium text-accent hover:text-accent-strong">Configure</Link>
                                        {can.admin && (
                                            <button type="button" className="ml-auto text-sm text-fg-soft hover:text-fg" onClick={() => void toggle.run(a)}>
                                                {a.active ? 'Deactivate' : 'Activate'}
                                            </button>
                                        )}
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                    {can.admin && missing.length > 0 && (
                        <Card>
                            <CardHeader><CardTitle>Add specialists</CardTitle></CardHeader>
                            <CardContent className="flex flex-wrap gap-2">
                                {missing.map((t) => (
                                    <Button key={t.key} variant="secondary" size="sm" onClick={() => void provision.run(t.key)}>
                                        <Bot className="h-4 w-4" aria-hidden="true" /> {t.name}
                                    </Button>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </Page>
    );
}

export function AgentDetailPage() {
    const { agentId = '' } = useParams();
    const { brand, can } = useBrand();
    const agent = useQuery((a) => a.agents.get(brand.id, agentId), [brand.id, agentId]);
    const versions = useQuery((a) => a.agents.instructionVersions(brand.id, agentId), [brand.id, agentId]);
    const usage = useQuery((a) => a.agents.usage(brand.id), [brand.id]);
    const recent = useQuery((a) => a.agents.executions(brand.id, { agentInstanceId: agentId }), [brand.id, agentId]);

    if (agent.loading) return <Page title="Agent"><LoadingState /></Page>;
    if (agent.error || !agent.data) return <Page title="Agent"><ErrorState error={agent.error} /></Page>;
    const a = agent.data;
    const t = templateByKey(a.templateKey);
    const u = usage.data?.find((x) => x.agentInstanceId === a.id);

    return (
        <Page title={a.displayName} description={`${t.name} · @${a.handle}`} actions={<Link to={`/b/${brand.slug}/agents`} className="text-sm text-accent hover:text-accent-strong">All agents</Link>}>
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                    <ConfigCard agent={a} readOnly={!can.admin} />
                    <InstructionsCard agent={a} versions={versions.data ?? []} readOnly={!can.admin} />
                </div>
                <div className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle>Usage this month</CardTitle></CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <UsageLine agent={a} usage={u} />
                            {u && (
                                <dl className="grid grid-cols-2 gap-y-1">
                                    <dt className="text-fg-muted">Runs</dt><dd className="text-right tabular-nums">{formatNumber(u.runsMonth)}</dd>
                                    <dt className="text-fg-muted">Tokens</dt><dd className="text-right tabular-nums">{formatNumber(u.tokensMonth)}</dd>
                                    <dt className="text-fg-muted">Est. cost</dt><dd className="text-right tabular-nums">{formatCurrency(u.costMonthUsd)}</dd>
                                    <dt className="text-fg-muted">Budget left</dt><dd className="text-right tabular-nums">{formatCurrency(u.budgetRemainingUsd)}</dd>
                                </dl>
                            )}
                            {u && u.unpricedRunsMonth > 0 && <p className="text-xs text-warning-ink">{u.unpricedRunsMonth} run(s) used a model with no configured rate. Their cost is unknown, not zero.</p>}
                            <p className="text-xs text-fg-muted">Costs are estimates from token counts (~4 characters per token).</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
                        <CardContent>
                            <ul className="list-disc pl-5 text-sm text-fg-secondary space-y-0.5">{t.capabilities.map((c) => <li key={c}>{c}</li>)}</ul>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex items-center justify-between">
                            <CardTitle>Recent runs</CardTitle>
                            <Link to={`/b/${brand.slug}/executions`} className="text-xs font-medium text-accent">All</Link>
                        </CardHeader>
                        <CardContent>
                            {recent.data?.length ? (
                                <ul className="divide-y divide-line-subtle text-sm">
                                    {recent.data.slice(0, 6).map((e) => (
                                        <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                                            <span className="text-xs text-fg-muted">{formatDateTime(e.startedAt)}</span>
                                            <Badge variant={EXEC_STATUS[e.status].variant}>{EXEC_STATUS[e.status].label}</Badge>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-fg-muted">No runs yet. Start a conversation in Agent Chat.</p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </Page>
    );
}

function ConfigCard({ agent, readOnly }: { agent: AgentInstance; readOnly: boolean }) {
    const { brand } = useBrand();
    const [form, setForm] = useState(() => toForm(agent));
    const [saved, setSaved] = useState(false);
    useEffect(() => setForm(toForm(agent)), [agent]);
    const save = useAction((a) =>
        a.agents.update(brand.id, agent.id, {
            displayName: form.displayName,
            active: form.active,
            model: MODEL_CATALOG[Number(form.modelIndex)]!,
            tools: form.tools,
            limits: { maxOutputTokens: Number(form.maxOutputTokens), maxRunsPerDay: Number(form.maxRunsPerDay), monthlyBudgetUsd: Number(form.monthlyBudgetUsd) },
        }),
    );
    const errors = fieldErrors(save.error);
    const model = MODEL_CATALOG[Number(form.modelIndex)];

    return (
        <Card>
            <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
            <CardContent>
                <form
                    className="space-y-4"
                    noValidate
                    onSubmit={async (e) => {
                        e.preventDefault();
                        setSaved(false);
                        if (await save.run()) setSaved(true);
                    }}
                >
                    {saved && <Alert tone="success">Agent configuration saved.</Alert>}
                    {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field id="agent-name" label="Display name" required>
                            <Input id="agent-name" value={form.displayName} disabled={readOnly} error={errors.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                        </Field>
                        <Field id="agent-model" label="Model">
                            <Select id="agent-model" value={form.modelIndex} disabled={readOnly} onChange={(e) => setForm({ ...form, modelIndex: e.target.value })}>
                                {MODEL_CATALOG.map((m, i) => <option key={m.model} value={i}>{m.label}</option>)}
                            </Select>
                        </Field>
                    </div>
                    {model?.live && <Alert tone="warning">Live models only run through the server-side agent-execute function (Phase 17). In local mode, runs with this model fail with an explanation.</Alert>}
                    <fieldset>
                        <legend className="text-sm font-medium text-fg-secondary mb-1">Tool permissions</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {ALL_TOOLS.map((tool) => (
                                <label key={tool} className="flex items-start gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 rounded border-line-strong"
                                        disabled={readOnly}
                                        checked={form.tools.includes(tool)}
                                        onChange={() => setForm({ ...form, tools: form.tools.includes(tool) ? form.tools.filter((x) => x !== tool) : [...form.tools, tool] })}
                                    />
                                    <span>
                                        <span className="text-fg">{TOOL_LABELS[tool].label}</span>
                                        {TOOL_LABELS[tool].external && <Badge variant="yellow" className="ml-1">needs approval</Badge>}
                                        <span className="block text-xs text-fg-muted">{TOOL_LABELS[tool].description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Field id="agent-max-tokens" label="Max output tokens">
                            <Input id="agent-max-tokens" type="number" min={64} max={16384} value={form.maxOutputTokens} disabled={readOnly} error={errors.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} />
                        </Field>
                        <Field id="agent-runs" label="Runs per day">
                            <Input id="agent-runs" type="number" min={1} value={form.maxRunsPerDay} disabled={readOnly} error={errors.maxRunsPerDay} onChange={(e) => setForm({ ...form, maxRunsPerDay: e.target.value })} />
                        </Field>
                        <Field id="agent-budget" label="Monthly budget (USD)">
                            <Input id="agent-budget" type="number" min={0} step="0.5" value={form.monthlyBudgetUsd} disabled={readOnly} error={errors.monthlyBudgetUsd} onChange={(e) => setForm({ ...form, monthlyBudgetUsd: e.target.value })} />
                        </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-fg-secondary">
                        <input type="checkbox" className="h-4 w-4 rounded border-line-strong" disabled={readOnly} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                        Active (inactive agents ignore messages and @mentions)
                    </label>
                    {!readOnly && <Button type="submit" loading={save.pending}>Save configuration</Button>}
                </form>
            </CardContent>
        </Card>
    );
}

function toForm(a: AgentInstance) {
    return {
        displayName: a.displayName,
        active: a.active,
        modelIndex: String(Math.max(0, MODEL_CATALOG.findIndex((m) => m.provider === a.model.provider && m.model === a.model.model))),
        tools: [...a.tools] as ToolKey[],
        maxOutputTokens: String(a.limits.maxOutputTokens),
        maxRunsPerDay: String(a.limits.maxRunsPerDay),
        monthlyBudgetUsd: String(a.limits.monthlyBudgetUsd),
    };
}

function InstructionsCard({ agent, versions, readOnly }: { agent: AgentInstance; versions: Array<{ id: string; version: number; instructions: string; note: string; createdAt: string }>; readOnly: boolean }) {
    const { brand } = useBrand();
    const active = versions.find((v) => v.id === agent.activeInstructionVersionId);
    const [text, setText] = useState(active?.instructions ?? '');
    const [note, setNote] = useState('');
    useEffect(() => setText(active?.instructions ?? ''), [active?.id, active?.instructions]);
    const publish = useAction((a) => a.agents.publishInstructions(brand.id, agent.id, { instructions: text, note }));
    const activate = useAction((a, id: string) => a.agents.activateVersion(brand.id, agent.id, id));
    const errors = fieldErrors(publish.error);

    return (
        <Card>
            <CardHeader className="flex items-center justify-between">
                <CardTitle>Instructions</CardTitle>
                {active && <Badge variant="indigo">v{active.version} active</Badge>}
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="agent-instructions">System instructions</Label>
                    <Textarea id="agent-instructions" rows={6} value={text} disabled={readOnly} onChange={(e) => setText(e.target.value)} />
                    {errors.instructions && <p className="mt-1 text-xs text-danger">{errors.instructions}</p>}
                </div>
                {!readOnly && (
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="flex-1 min-w-48">
                            <Field id="agent-version-note" label="Change note" required>
                                <Input id="agent-version-note" value={note} error={errors.note} onChange={(e) => setNote(e.target.value)} />
                            </Field>
                        </div>
                        <Button loading={publish.pending} disabled={text === active?.instructions} onClick={async () => { if (await publish.run()) setNote(''); }}>
                            Publish new version
                        </Button>
                    </div>
                )}
                {activate.error ? <ErrorState error={activate.error} /> : null}
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Version history</h3>
                    <ul className="divide-y divide-line-subtle">
                        {versions.map((v) => (
                            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                                <div className="min-w-0">
                                    <span className="font-medium text-fg">v{v.version}</span> <span className="text-fg-soft">{v.note}</span>
                                    <p className="text-xs text-fg-muted">{formatDateTime(v.createdAt)}</p>
                                </div>
                                {v.id === agent.activeInstructionVersionId ? (
                                    <Badge variant="green">Active</Badge>
                                ) : (
                                    !readOnly && <Button size="sm" variant="ghost" onClick={() => void activate.run(v.id)}>Activate</Button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}

export function ExecutionsPage() {
    const { brand } = useBrand();
    const [agentId, setAgentId] = useState('');
    const [status, setStatus] = useState<ExecutionStatus | ''>('');
    const agents = useQuery((a) => a.agents.list(brand.id), [brand.id]);
    const list = useQuery((a) => a.agents.executions(brand.id, { agentInstanceId: agentId || undefined, status: status || undefined }), [brand.id, agentId, status]);
    const name = (id: string) => agents.data?.find((a) => a.id === id)?.displayName ?? 'Removed agent';
    const rows = list.data ?? [];
    const totalTokens = rows.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
    const totalCost = rows.reduce((s, e) => s + e.costUsd, 0);

    return (
        <Page title="Executions" description="Every agent run with status, mode, tokens and estimated cost">
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
                <div>
                    <Label htmlFor="exe-agent">Agent</Label>
                    <Select id="exe-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                        <option value="">All agents</option>
                        {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
                    </Select>
                </div>
                <div>
                    <Label htmlFor="exe-status">Status</Label>
                    <Select id="exe-status" value={status} onChange={(e) => setStatus(e.target.value as ExecutionStatus | '')}>
                        <option value="">All</option>
                        {Object.entries(EXEC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select>
                </div>
                <p className="ml-auto text-sm text-fg-soft tabular-nums">
                    {formatNumber(rows.length)} runs · {formatNumber(totalTokens)} tokens · {formatCurrency(totalCost)} est.
                </p>
            </div>
            {list.loading ? (
                <LoadingState />
            ) : list.error ? (
                <ErrorState error={list.error} onRetry={list.reload} />
            ) : !rows.length ? (
                <EmptyState title="No executions yet" description="Runs appear here when agents reply in Agent Chat or Team Chat." />
            ) : (
                <Table>
                    <THead>
                        <tr><Th>When</Th><Th>Agent</Th><Th>Status</Th><Th>Mode</Th><Th className="text-right">Tokens</Th><Th className="text-right">Cost</Th><Th className="hidden lg:table-cell">Detail</Th></tr>
                    </THead>
                    <TBody>
                        {rows.map((e) => (
                            <tr key={e.id}>
                                <Td className="whitespace-nowrap text-xs">{formatDateTime(e.startedAt)}</Td>
                                <Td>{name(e.agentInstanceId)}{e.handoffDepth > 0 && <span className="ml-1 text-xs text-fg-muted">(handoff {e.handoffDepth})</span>}</Td>
                                <Td><Badge variant={EXEC_STATUS[e.status].variant}>{EXEC_STATUS[e.status].label}</Badge></Td>
                                <Td><ModeBadge mode={e.mode} /></Td>
                                <Td className="text-right tabular-nums">{formatNumber(e.inputTokens + e.outputTokens)}</Td>
                                <Td className="text-right tabular-nums">{formatCurrency(e.costUsd)}</Td>
                                <Td className="hidden lg:table-cell text-xs text-fg-muted max-w-xs truncate">{e.error ?? `${e.model} · instructions v${e.instructionVersion}`}</Td>
                            </tr>
                        ))}
                    </TBody>
                </Table>
            )}
        </Page>
    );
}
