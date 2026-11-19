import { Link, useNavigate, useParams } from 'react-router';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Alert, Badge, Button, ErrorState, LoadingState } from '@/components/ui';
import { useAction, useBackend, useQuery } from '@/app/backend';
import { ROLE_LABELS } from '@/data/access';
import { formatDate } from '@/lib/utils';

/**
 * Client invitation. Signed-out visitors reach it through /login?next= (or /register?next=).
 * The data layer re-checks status, expiry and the invited email on accept; the checks here only
 * explain why the button is unavailable.
 */
export function AcceptInvitationPage() {
    const { token = '' } = useParams();
    const { session } = useBackend();
    const navigate = useNavigate();
    const preview = useQuery((api) => api.invitations.preview(token), [token]);
    const accept = useAction((api) => api.invitations.accept(token));
    const inv = preview.data;
    const wrongAccount = !!inv && inv.email !== session?.user.email.toLowerCase();

    return (
        <AuthLayout title="Join a client workspace">
            {preview.loading && <LoadingState />}
            {preview.error ? <ErrorState error={preview.error} /> : null}
            {inv && (
                <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">
                        You have been invited to <strong>{inv.brandName}</strong> as <Badge variant="indigo">{ROLE_LABELS[inv.role]}</Badge>
                    </p>
                    <p className="text-xs text-fg-muted">
                        Sent to {inv.email} · expires {formatDate(inv.expiresAt)}
                    </p>
                    {inv.status === 'expired' && <Alert tone="warning">This invitation has expired. Ask the person who invited you to send a new one.</Alert>}
                    {inv.status !== 'pending' && inv.status !== 'expired' && <Alert tone="warning">This invitation is {inv.status}.</Alert>}
                    {inv.status === 'pending' && wrongAccount && (
                        <Alert tone="warning">You are signed in as {session?.user.email}. Sign out, then sign in with the invited email to accept.</Alert>
                    )}
                    {accept.error ? <ErrorState error={accept.error} /> : null}
                    <Button
                        className="w-full"
                        loading={accept.pending}
                        disabled={inv.status !== 'pending' || wrongAccount}
                        onClick={async () => {
                            const res = await accept.run();
                            if (res) navigate(`/b/${res.brandSlug}/dashboard`, { replace: true });
                        }}
                    >
                        Accept invitation
                    </Button>
                </div>
            )}
            <Link to="/home" className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-strong">
                Go to my workspace
            </Link>
        </AuthLayout>
    );
}
