import { useNavigate, useParams } from 'react-router';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Alert, Badge, Button, ErrorState, LoadingState } from '@/components/ui';
import { useAction, useBackend, useQuery } from '@/app/backend';
import { ROLE_LABELS } from '@/data/access';
import { formatDate } from '@/lib/utils';

export function AcceptInvitationPage() {
    const { token = '' } = useParams();
    const { session } = useBackend();
    const navigate = useNavigate();
    const preview = useQuery((api) => api.invitations.preview(token), [token]);
    const accept = useAction((api) => api.invitations.accept(token));

    return (
        <AuthLayout title="Join a brand">
            {preview.loading && <LoadingState />}
            {preview.error ? <ErrorState error={preview.error} /> : null}
            {preview.data && (
                <div className="space-y-4">
                    <p className="text-sm text-gray-700">
                        You have been invited to <strong>{preview.data.brandName}</strong> as <Badge variant="indigo">{ROLE_LABELS[preview.data.role]}</Badge>
                    </p>
                    <p className="text-xs text-gray-500">
                        Sent to {preview.data.email} · expires {formatDate(preview.data.expiresAt)}
                    </p>
                    {preview.data.status !== 'pending' && <Alert tone="warning">This invitation is {preview.data.status}.</Alert>}
                    {preview.data.email !== session?.user.email.toLowerCase() && (
                        <Alert tone="warning">You are signed in as {session?.user.email}. Sign in with the invited email to accept.</Alert>
                    )}
                    {accept.error ? <ErrorState error={accept.error} /> : null}
                    <Button
                        className="w-full"
                        loading={accept.pending}
                        disabled={preview.data.status !== 'pending'}
                        onClick={async () => {
                            const res = await accept.run();
                            if (res) navigate(`/b/${res.brandSlug}/dashboard`, { replace: true });
                        }}
                    >
                        Accept invitation
                    </Button>
                </div>
            )}
        </AuthLayout>
    );
}
