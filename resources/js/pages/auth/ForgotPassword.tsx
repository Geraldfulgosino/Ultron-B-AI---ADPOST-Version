import React from 'react';
import { useForm, Link, Head } from '@inertiajs/react';
import AuthLayout from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

interface ForgotPasswordProps {
    status?: string;
}

export default function ForgotPassword({ status }: ForgotPasswordProps) {
    const { data, setData, post, processing, errors } = useForm({ email: '' });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('password.email'));
    };

    return (
        <AuthLayout title="Reset your password" description="We'll send you a reset link">
            <Head title="Forgot Password" />

            {status && (
                <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    {status}
                </div>
            )}

            <p className="text-sm text-gray-600 mb-4">
                Enter the email address associated with your account and we'll send you a link to reset your password.
            </p>

            <form onSubmit={submit} className="space-y-4">
                <div>
                    <Label htmlFor="email" required>Email address</Label>
                    <Input
                        id="email"
                        type="email"
                        value={data.email}
                        onChange={(e) => setData('email', e.target.value)}
                        placeholder="you@example.com"
                        autoFocus
                        error={errors.email}
                    />
                </div>

                <Button type="submit" className="w-full" loading={processing}>
                    Send reset link
                </Button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
                <Link href={route('login')} className="text-indigo-600 hover:text-indigo-500">
                    Back to sign in
                </Link>
            </p>
        </AuthLayout>
    );
}
