import React from 'react';
import { useForm, Head } from '@inertiajs/react';
import AuthLayout from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

export default function CreateOrganization() {
    const { data, setData, post, processing, errors } = useForm({
        name: '',
        timezone: 'UTC',
        currency: 'USD',
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('organizations.store'));
    };

    return (
        <AuthLayout title="Create your organization" description="Set up your workspace">
            <Head title="Create Organization" />

            <p className="text-sm text-gray-600 mb-4">
                Organizations are the primary workspace in ULTRON-B AI. You can add team members, clients, and
                websites after creating yours.
            </p>

            <form onSubmit={submit} className="space-y-4">
                <div>
                    <Label htmlFor="name" required>Organization name</Label>
                    <Input
                        id="name"
                        value={data.name}
                        onChange={(e) => setData('name', e.target.value)}
                        placeholder="Acme Marketing Agency"
                        autoFocus
                        error={errors.name}
                    />
                </div>

                <div>
                    <Label htmlFor="timezone">Timezone</Label>
                    <Input
                        id="timezone"
                        value={data.timezone}
                        onChange={(e) => setData('timezone', e.target.value)}
                        placeholder="UTC"
                        error={errors.timezone}
                    />
                </div>

                <div>
                    <Label htmlFor="currency">Currency</Label>
                    <Input
                        id="currency"
                        value={data.currency}
                        onChange={(e) => setData('currency', e.target.value.toUpperCase())}
                        placeholder="USD"
                        maxLength={3}
                        error={errors.currency}
                    />
                </div>

                <Button type="submit" className="w-full" loading={processing}>
                    Create organization
                </Button>
            </form>
        </AuthLayout>
    );
}
