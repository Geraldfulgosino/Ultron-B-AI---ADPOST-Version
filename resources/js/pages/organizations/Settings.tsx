import React from 'react';
import { useForm, Head } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

interface SettingsProps {
    organization: {
        id: number;
        name: string;
        slug: string;
        timezone: string;
        currency: string;
    };
}

const TIMEZONES = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Singapore', 'Asia/Manila', 'Australia/Sydney',
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'PHP', 'JPY'];

export default function Settings({ organization }: SettingsProps) {
    const { data, setData, patch, processing, errors } = useForm({
        name:     organization.name,
        timezone: organization.timezone,
        currency: organization.currency,
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        patch(route('organization.update', { organization: organization.slug }));
    };

    return (
        <AppLayout title="Organization Settings">
            <Head title="Settings" />

            <div className="max-w-2xl space-y-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Organization Settings</h2>
                    <p className="mt-1 text-sm text-gray-500">Manage your organization details.</p>
                </div>

                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">General</h3>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submit} className="space-y-4">
                            <div>
                                <Label htmlFor="name" required>Organization name</Label>
                                <Input
                                    id="name"
                                    value={data.name}
                                    onChange={(e) => setData('name', e.target.value)}
                                    error={errors.name}
                                />
                            </div>

                            <div>
                                <Label htmlFor="timezone" required>Timezone</Label>
                                <select
                                    id="timezone"
                                    value={data.timezone}
                                    onChange={(e) => setData('timezone', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    {TIMEZONES.map((tz) => (
                                        <option key={tz} value={tz}>{tz}</option>
                                    ))}
                                </select>
                                {errors.timezone && (
                                    <p className="mt-1 text-xs text-red-600">{errors.timezone}</p>
                                )}
                            </div>

                            <div>
                                <Label htmlFor="currency" required>Default currency</Label>
                                <select
                                    id="currency"
                                    value={data.currency}
                                    onChange={(e) => setData('currency', e.target.value)}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    {CURRENCIES.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                                {errors.currency && (
                                    <p className="mt-1 text-xs text-red-600">{errors.currency}</p>
                                )}
                            </div>

                            <div className="pt-2">
                                <Button type="submit" loading={processing}>
                                    Save changes
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">Organization slug</h3>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-gray-500 mb-2">
                            Your organization URL identifier. Contact support to change it.
                        </p>
                        <code className="block bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 font-mono">
                            {organization.slug}
                        </code>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
