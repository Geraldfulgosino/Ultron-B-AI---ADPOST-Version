import React, { useEffect, useState } from 'react';
import { Page } from '@/layouts/AppShell';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Field, Input, Select, Textarea } from '@/components/ui';
import { fieldErrors, useAction, useBrand } from '@/app/backend';
import type { Brand } from '@/domain/types';

export const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Manila', 'Asia/Singapore', 'Australia/Sydney'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'PHP', 'SGD', 'AUD'];

export function BrandSettingsPage() {
    const { brand, can } = useBrand();
    const [form, setForm] = useState(() => pick(brand));
    const [saved, setSaved] = useState(false);
    const save = useAction((api, input: ReturnType<typeof pick>) => api.workspace.updateBrand(brand.id, input));
    const errors = fieldErrors(save.error);

    useEffect(() => setForm(pick(brand)), [brand]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaved(false);
        if (await save.run(form)) setSaved(true);
    };

    const readOnly = !can.admin;
    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    return (
        <Page title="Brand settings" description={`Workspace configuration for ${brand.name}`}>
            <form onSubmit={submit} className="max-w-2xl space-y-6" noValidate>
                {saved && <Alert tone="success">Brand settings saved.</Alert>}
                {save.error && !Object.keys(errors).length ? <ErrorState error={save.error} /> : null}
                <Card>
                    <CardHeader>
                        <CardTitle>General</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Field id="brand-name" label="Name" required>
                            <Input id="brand-name" value={form.name} error={errors.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
                        </Field>
                        <Field id="brand-slug" label="URL slug" hint="The slug is fixed once the brand is created, so links keep working.">
                            <Input id="brand-slug" value={brand.slug} disabled />
                        </Field>
                        <Field id="brand-description" label="Description">
                            <Textarea id="brand-description" rows={3} value={form.description} disabled={readOnly} onChange={(e) => set('description', e.target.value)} />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-3">
                            <Field id="brand-timezone" label="Timezone">
                                <Select id="brand-timezone" value={form.timezone} disabled={readOnly} onChange={(e) => set('timezone', e.target.value)}>
                                    {withCurrent(TIMEZONES, form.timezone).map((t) => <option key={t}>{t}</option>)}
                                </Select>
                            </Field>
                            <Field id="brand-currency" label="Currency">
                                <Select id="brand-currency" value={form.currency} disabled={readOnly} onChange={(e) => set('currency', e.target.value)}>
                                    {withCurrent(CURRENCIES, form.currency).map((c) => <option key={c}>{c}</option>)}
                                </Select>
                            </Field>
                            <Field id="brand-color" label="Brand color">
                                <Input id="brand-color" type="color" className="h-10 p-1" value={form.color} error={errors.color} disabled={readOnly} onChange={(e) => set('color', e.target.value)} />
                            </Field>
                        </div>
                        <Field id="brand-status" label="Status" hint="Archived brands stay readable but are hidden from day-to-day work.">
                            <Select id="brand-status" value={form.status} disabled={readOnly} onChange={(e) => set('status', e.target.value as Brand['status'])}>
                                <option value="active">Active</option>
                                <option value="archived">Archived</option>
                            </Select>
                        </Field>
                    </CardContent>
                </Card>
                {readOnly ? (
                    <Alert tone="info">Only brand owners and admins can change these settings.</Alert>
                ) : (
                    <Button type="submit" loading={save.pending}>
                        Save settings
                    </Button>
                )}
            </form>
        </Page>
    );
}

function pick(b: Brand) {
    return { name: b.name, description: b.description, timezone: b.timezone, currency: b.currency, color: b.color, status: b.status };
}

function withCurrent(list: string[], current: string): string[] {
    return list.includes(current) ? list : [current, ...list];
}
