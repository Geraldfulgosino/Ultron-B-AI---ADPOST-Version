import React from 'react';
import { useForm, Head } from '@inertiajs/react';
import AuthLayout from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';

interface VerifyEmailProps {
    status?: string;
}

export default function VerifyEmail({ status }: VerifyEmailProps) {
    const { post, processing } = useForm({});

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('verification.send'));
    };

    return (
        <AuthLayout title="Verify your email address">
            <Head title="Email Verification" />

            <p className="text-sm text-gray-600 mb-4">
                Thanks for signing up! Before getting started, please verify your email address by clicking on the
                link we sent you. If you didn't receive the email, we'll gladly send another.
            </p>

            {status === 'verification-link-sent' && (
                <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    A new verification link has been sent to your email address.
                </div>
            )}

            <form onSubmit={submit}>
                <Button type="submit" className="w-full" loading={processing}>
                    Resend verification email
                </Button>
            </form>
        </AuthLayout>
    );
}
