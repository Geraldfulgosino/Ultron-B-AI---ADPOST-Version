/** Home routing by role, My Profile, and agency-invitation acceptance. */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useAction, useBackend, useQuery, fieldErrors } from '@/app/backend';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Field, Input, LoadingState } from '@/components/ui';
import { ThemeToggle } from '@/theme/ThemeToggle';
import { clientBase } from '@/app/paths';
import { PERMISSION_LABEL } from '@/pages/users/UsersManager';
import { AccessPendingPage } from '@/pages/StatusPages';

/**
 * After sign-in: Super Admin → /platform; Admin → their agency; Client User → their client (or a
 * client picker); no membership → /access-pending. The target comes from the data layer, never
 * from a role label held by the browser. Errors stay on this page (with Retry), so a failing
 * lookup cannot bounce between pages.
 */
export function HomeRedirect() {
    const home = useQuery((api) => api.users.home(), []);
    if (home.error) {
        return (
            <main id="main" className="mx-auto max-w-lg px-4 py-12">
                <h1 className="mb-4 text-lg font-semibold text-fg">Your workspace could not be opened</h1>
                <ErrorState error={home.error} onRetry={home.reload} />
            </main>
        );
    }
    if (!home.data) return <LoadingState label="Opening your workspace…" />;
    return <Navigate to={home.data.path} replace />;
}

/** /access-pending, but only for users who really have no access (anyone else goes home). */
export function AccessPendingRoute() {
    const home = useQuery((api) => api.users.home(), []);
    if (home.loading) return <LoadingState />;
    if (home.data && home.data.reason !== 'none') return <Navigate to={home.data.path} replace />;
    return <AccessPendingPage />;
}

export function MyProfilePage() {
    const { session, backend, signOut, refreshSession } = useBackend();
    const navigate = useNavigate();
    const brands = useQuery((api) => api.workspace.listBrands(), []);
    const [name, setName] = useState(session?.user.name ?? '');
    const [pw, setPw] = useState({ current: '', next: '' });
    const [msg, setMsg] = useState<string | null>(null);
    const saveName = useAction(async () => { const s = await backend.auth.updateProfile({ name }); refreshSession(); return s; });
    const savePw = useAction(() => backend.auth.changePassword(pw.current, pw.next).then(() => true));
    const nameErr = fieldErrors(saveName.error);
    const pwErr = fieldErrors(savePw.error);
    useEffect(() => setName(session?.user.name ?? ''), [session?.user.name]);
    return (
        <div className="min-h-screen bg-canvas">
            <main id="main" tabIndex={-1} className="mx-auto max-w-3xl space-y-6 px-4 py-8 focus:outline-none">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-semibold text-fg">My profile</h1>
                    <Link to="/home" className="text-sm text-accent hover:text-accent-strong">Back to workspace</Link>
                </div>
                {msg && <Alert tone="success">{msg}</Alert>}
                <Card>
                    <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
                    <CardContent>
                        <form className="space-y-3" noValidate onSubmit={async (e) => { e.preventDefault(); if (await saveName.run()) setMsg('Profile saved.'); }}>
                            <Field id="me-name" label="Name" required><Input id="me-name" value={name} error={nameErr.name} onChange={(e) => setName(e.target.value)} /></Field>
                            <Field id="me-email" label="Email"><Input id="me-email" value={session?.user.email ?? ''} disabled readOnly /></Field>
                            <p className="text-xs text-fg-muted">Your roles and memberships are managed by administrators and cannot be changed here.</p>
                            <Button type="submit" loading={saveName.pending}>Save profile</Button>
                        </form>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Password</CardTitle></CardHeader>
                    <CardContent>
                        <form className="space-y-3" noValidate onSubmit={async (e) => { e.preventDefault(); if (await savePw.run()) { setPw({ current: '', next: '' }); setMsg('Password changed.'); } }}>
                            {savePw.error && !Object.keys(pwErr).length ? <ErrorState error={savePw.error} /> : null}
                            <Field id="me-pw-current" label="Current password" required><Input id="me-pw-current" type="password" autoComplete="current-password" value={pw.current} error={pwErr.currentPassword} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
                            <Field id="me-pw-new" label="New password" required><Input id="me-pw-new" type="password" autoComplete="new-password" value={pw.next} error={pwErr.newPassword} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                            <Button type="submit" loading={savePw.pending}>Change password</Button>
                        </form>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex items-center justify-between"><CardTitle>Appearance</CardTitle><ThemeToggle /></CardHeader>
                </Card>
                <Card>
                    <CardHeader><CardTitle>My workspaces</CardTitle></CardHeader>
                    <CardContent>
                        {brands.loading ? <LoadingState /> : brands.data?.length ? (
                            <ul className="space-y-1 text-sm">
                                {brands.data.map((b) => (
                                    <li key={b.brand.id} className="flex flex-wrap justify-between gap-2">
                                        <Link className="text-accent hover:text-accent-strong" to={`${clientBase(b.brand)}/dashboard`}>{b.brand.name}</Link>
                                        <span className="text-fg-muted">{b.roleLabel}{b.clientPermissions.length ? ` · ${b.clientPermissions.map((p) => PERMISSION_LABEL[p]).join(', ')}` : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-sm text-fg-muted">No workspaces yet.</p>}
                    </CardContent>
                </Card>
                <Button variant="secondary" onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}>Sign out</Button>
            </main>
        </div>
    );
}

export function AcceptAgencyInvitationPage() {
    const { token = '' } = useParams();
    const navigate = useNavigate();
    const accept = useAction((api) => api.users.acceptAgencyInvitation(token));
    return (
        <div className="min-h-screen bg-canvas">
            <main id="main" className="mx-auto max-w-lg space-y-4 px-4 py-12">
                <h1 className="text-lg font-semibold text-fg">Agency invitation</h1>
                <p className="text-sm text-fg-muted">Accepting adds the agency role named in the invitation to your account. It only works for the email address the invitation was sent to.</p>
                {accept.error ? <ErrorState error={accept.error} /> : null}
                <Button loading={accept.pending} onClick={async () => { const r = await accept.run(); if (r) navigate(`/a/${r.agencySlug}`, { replace: true }); }}>Accept invitation</Button>
            </main>
        </div>
    );
}
