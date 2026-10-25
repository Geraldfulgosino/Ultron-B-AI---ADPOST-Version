import React from 'react';
import { useForm, Head, Link } from '@inertiajs/react';
import AuthLayout from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';

interface InvitationAcceptProps {
    invitation: {
        token: string;
        organization_name: string;
        role_label: string;
        email: string;
        expires_at: string;
    };
}

export default function AcceptInvitation({ invitation }: InvitationAcceptProps) {
    const { post, processing } = useForm({});

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('invitations.accept', { token: invitation.token }));
    };

    return (
        <AuthLayout title="You've been invited">
            <Head title="Accept Invitation" />

            <div className="text-center mb-6">
                <p className="text-sm text-gray-600">
                    You've been invited to join <span className="font-semibold">{invitation.organization_name}</span>{' '}
                    as a <span className="font-semibold">{invitation.role_label}</span>.
                </p>
                <p className="mt-1 text-xs text-gray-400">
                    This invitation was sent to {invitation.email} · Expires {invitation.expires_at}
                </p>
            </div>

            <form onSubmit={submit} className="space-y-3">
                <Button type="submit" className="w-full" loading={processing}>
                    Accept invitation
                </Button>
                <Link href={route('login')} className="block text-center text-sm text-gray-500 hover:text-gray-700">
                    Sign in with a different account
                </Link>
            </form>
        </AuthLayout>
    );
}
