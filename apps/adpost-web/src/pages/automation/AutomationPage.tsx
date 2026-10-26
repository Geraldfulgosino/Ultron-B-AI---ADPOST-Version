import { useEffect, useState } from 'react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Field, Input, LoadingState } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import { N8N_EVENTS, type N8nEvent } from '@/domain/types';
import { formatDateTime } from '@/lib/utils';

const EVENT_LABELS: Record<N8nEvent | 'connection.test', string> = {
    'report.generated': 'Report exported',
    'insight.approved': 'SEO insight approved',
    'approval.decided': 'Approval decided',
    'task.completed': 'Task completed',
    'connection.test': 'Connection test',
};

export function AutomationPage() {
    const { brand } = useBrand();
    const state = useQuery((api) => api.automation.get(brand.id), [brand.id]);
    const [form, setForm] = useState({ name: 'n8n', webhookUrl: '', events: [] as N8nEvent[], active: true });
    const save = useAction((api) => api.automation.save(brand.id, form));
    const test = useAction((api) => api.automation.test(brand.id));
    const clear = useAction((api) => api.automation.clearDeliveries(brand.id));
    const disconnect = useAction((api) => api.automation.disconnect(brand.id));
    const errors = fieldErrors(save.error);
    const conn = state.data?.connection;

    useEffect(() => {
        if (conn) setForm((f) => ({ ...f, name: conn.name, events: conn.events, active: conn.active }));
    }, [conn]);

    const toggle = (e: N8nEvent) => setForm((f) => ({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] }));
    const otherError = test.error ?? clear.error ?? disconnect.error;

    return (
        <Page title="Automation" description="n8n webhook bridge for brand events">
            <Alert tone="info">
                Local mode never sends HTTP requests. Deliveries are recorded as <strong>simulated</strong>. Signed webhook delivery runs in the server-side <code>n8n-dispatch</code> function after Supabase integration (Phase 17).
            </Alert>
            {otherError ? <ErrorState error={otherError} /> : null}
            {state.loading ? (
                <LoadingState />
            ) : state.error ? (
                <ErrorState error={state.error} onRetry={state.reload} />
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader className="flex items-center justify-between">
                            <CardTitle>Connection</CardTitle>
                            {conn ? <Badge variant={conn.active ? 'green' : 'gray'}>{conn.active ? `Active · ${conn.webhookHost}` : 'Paused'}</Badge> : <Badge>Not configured</Badge>}
                        </CardHeader>
                        <CardContent>
                            <form
                                className="space-y-4"
                                noValidate
                                onSubmit={async (e) => {
                                    e.preventDefault();
                                    if (await save.run()) setForm((f) => ({ ...f, webhookUrl: '' }));
                                }}
                            >
                                <Field id="n8n-name" label="Name" required>
                                    <Input id="n8n-name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                                </Field>
                                <Field id="n8n-url" label="Webhook URL" required hint={conn ? 'The saved URL is never displayed. Enter it again to update the connection.' : 'https://…, or http://n8n:5678 for the local container'}>
                                    <Input id="n8n-url" type="url" autoComplete="off" value={form.webhookUrl} error={errors.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
                                </Field>
                                <fieldset>
                                    <legend className="text-sm font-medium text-fg-secondary mb-1">Events</legend>
                                    <div className="space-y-1">
                                        {N8N_EVENTS.map((e) => (
                                            <label key={e} className="flex items-center gap-2 text-sm text-fg-secondary">
                                                <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={form.events.includes(e)} onChange={() => toggle(e)} />
                                                {EVENT_LABELS[e]} <code className="text-xs text-fg-subtle">{e}</code>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                                <label className="flex items-center gap-2 text-sm text-fg-secondary">
                                    <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                                    Active
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <Button type="submit" loading={save.pending}>{conn ? 'Update connection' : 'Save connection'}</Button>
                                    {conn && <Button variant="secondary" loading={test.pending} onClick={() => void test.run()}>Send test</Button>}
                                    {conn && <Button variant="ghost" onClick={() => confirm('Disconnect n8n and delete its delivery history?') && void disconnect.run()}>Disconnect</Button>}
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex items-center justify-between">
                            <CardTitle>Recent deliveries</CardTitle>
                            {!!state.data?.deliveries.length && <Button size="sm" variant="ghost" onClick={() => void clear.run()}>Clear history</Button>}
                        </CardHeader>
                        <CardContent>
                            {state.data?.deliveries.length ? (
                                <ul className="divide-y divide-line-subtle">
                                    {state.data.deliveries.map((d) => (
                                        <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                                            <div>
                                                <p className="text-fg">{EVENT_LABELS[d.event]}</p>
                                                <p className="text-xs text-fg-muted">{formatDateTime(d.createdAt)} · attempt {d.attempt}</p>
                                            </div>
                                            <Badge variant={d.status === 'delivered' ? 'green' : d.status === 'failed' ? 'red' : 'blue'}>{d.status === 'simulated' ? 'Simulated' : d.status === 'delivered' ? 'Delivered' : 'Failed'}</Badge>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <EmptyState title="No deliveries yet" />
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </Page>
    );
}
