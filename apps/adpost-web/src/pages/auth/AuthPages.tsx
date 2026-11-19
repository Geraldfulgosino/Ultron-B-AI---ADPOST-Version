import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Alert, Button, Field, Input, LoadingState } from '@/components/ui';
import { fieldErrors, useBackend } from '@/app/backend';
import { authLinkError, hasAuthTokens, safeNext } from '@/app/redirects';
import { PendingConfirmationError } from '@/data/errors';
import { DEV_PASSWORD } from '@/data/local/fixtures';
import { LocalDatabase } from '@/data/local/db';
import { LOCAL_PERSIST_KEY } from '@/data/local/backend';
import { selectProvider } from '@/data/supabase/config';
import { SAMPLE_USERS } from '@/data/local/sampleSeed';

export { safeNext };

const isMockMode = () => {
    try {
        return selectProvider(import.meta.env) === 'mock';
    } catch {
        return false;
    }
};

/** Notices the sign-in page shows after a redirect. Known keys only; text never comes from the URL. */
const LOGIN_NOTICES: Record<string, string> = {
    'password-reset': 'Your password was changed. Sign in with your new password.',
};

/** `?next=` carried to the other auth pages, already validated. */
const nextQuery = (params: URLSearchParams) => (params.get('next') ? `?next=${encodeURIComponent(safeNext(params.get('next')))}` : '');

export function LoginPage() {
    const { session, sessionEnded, signIn } = useBackend();
    const [params] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const next = safeNext(params.get('next'));
    // A confirmation link that could not be used comes back with an error code in the URL.
    const linkError = authLinkError(location);
    const notice = LOGIN_NOTICES[params.get('notice') ?? ''];

    if (session) return <Navigate to={next} replace />;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
            await signIn(email, password);
            navigate(next, { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-in failed.');
        } finally {
            setPending(false);
        }
    };

    return (
        <AuthLayout title="Sign in">
            <form onSubmit={submit} className="space-y-4" noValidate aria-busy={pending}>
                {error && <Alert tone="error">{error}</Alert>}
                {!error && linkError && <Alert tone="error">{linkError}</Alert>}
                {!error && sessionEnded && <Alert tone="warning">Your session ended. Sign in again to continue.</Alert>}
                {!error && notice && <Alert tone="success">{notice}</Alert>}
                <Field id="email" label="Email" required>
                    <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field id="password" label="Password" required>
                    <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <div className="flex items-center justify-between text-sm">
                    <Link to="/forgot-password" className="text-accent hover:text-accent-strong">
                        Forgot password?
                    </Link>
                    <Link to={`/register${nextQuery(params)}`} className="text-accent hover:text-accent-strong">
                        Create account
                    </Link>
                </div>
                <Button type="submit" className="w-full" loading={pending}>
                    Sign in
                </Button>
            </form>
            <DevAccountsHint onPick={(e) => { setEmail(e); setPassword(DEV_PASSWORD); }} />
        </AuthLayout>
    );
}

/** Synthetic sample accounts of the dev dataset (src/data/local/sampleSeed.ts). */
const DEV_ACCOUNTS: Array<[string, string]> = SAMPLE_USERS.map((u) => [u.email, u.hint]);

/** Local-adapter only: synthetic accounts for exercising roles. */
function DevAccountsHint({ onPick }: { onPick: (email: string) => void }) {
    // Synthetic accounts exist only in mock mode; they are never offered against a real backend.
    if (!isMockMode()) return null;
    return (
        <details className="mt-6 rounded-lg bg-surface-muted p-3 text-xs text-fg-soft">
            <summary className="cursor-pointer font-medium text-fg-secondary">Local dev accounts (synthetic)</summary>
            <p className="mt-2">
                Password for all: <code className="font-mono">{DEV_PASSWORD}</code>
            </p>
            <button
                type="button"
                className="mt-2 text-danger-strong hover:underline"
                onClick={() => {
                    if (!confirm('Reset all local demo data to the synthetic fixtures?')) return;
                    LocalDatabase.reset(LOCAL_PERSIST_KEY);
                    try { sessionStorage.clear(); } catch { /* ignore */ }
                    window.location.reload();
                }}
            >
                Reset local demo data
            </button>
            <ul className="mt-2 space-y-1">
                {DEV_ACCOUNTS.map(([email, label]) => (
                    <li key={email}>
                        <button type="button" className="text-accent hover:underline" onClick={() => onPick(email)}>
                            {email}
                        </button>{' '}
                        <span className="text-fg-muted">— {label}</span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

export function RegisterPage() {
    const { session, register } = useBackend();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState(false);
    const [confirmEmail, setConfirmEmail] = useState(false);
    const errors = fieldErrors(error);
    const next = safeNext(params.get('next'));

    if (session) return <Navigate to={next} replace />;

    if (confirmEmail) {
        return (
            <AuthLayout title="Check your email">
                {/* Same answer for a new and an existing address (no account enumeration). */}
                <Alert tone="success">
                    If this address can be registered, we sent a confirmation link to it. Open the link, then sign in. If you were invited, open the invitation link again after signing in.
                </Alert>
                <Link to={`/login${nextQuery(params)}`} className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-strong">
                    Back to sign in
                </Link>
            </AuthLayout>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
            await register(form);
            navigate(next, { replace: true });
        } catch (err) {
            if (err instanceof PendingConfirmationError) setConfirmEmail(true);
            else setError(err);
        } finally {
            setPending(false);
        }
    };
    const formError = error && !Object.keys(errors).length ? (error instanceof Error ? error.message : 'Registration failed.') : null;

    return (
        <AuthLayout title="Create account">
            <form onSubmit={submit} className="space-y-4" noValidate aria-busy={pending}>
                {formError && <Alert tone="error">{formError}</Alert>}
                <Field id="name" label="Name" required>
                    <Input id="name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </Field>
                <Field id="reg-email" label="Email" required>
                    <Input id="reg-email" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </Field>
                <Field id="reg-password" label="Password" required hint="At least 8 characters.">
                    <Input id="reg-password" type="password" autoComplete="new-password" aria-describedby="reg-password-hint" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                </Field>
                <Button type="submit" className="w-full" loading={pending}>
                    Create account
                </Button>
                <p className="text-center text-sm text-fg-muted">
                    Already registered?{' '}
                    <Link to={`/login${nextQuery(params)}`} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                        Sign in
                    </Link>
                </p>
            </form>
        </AuthLayout>
    );
}

export function ForgotPasswordPage() {
    const { backend } = useBackend();
    const [email, setEmail] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState(false);
    const [sent, setSent] = useState(false);
    const errors = fieldErrors(error);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
            await backend.auth.requestPasswordReset(email);
            setSent(true);
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <AuthLayout title="Reset password">
            {sent ? (
                <div className="space-y-4">
                    {/* The same answer whether or not the account exists (no account enumeration). */}
                    <Alert tone="success">If an account exists for that email, we sent a link to reset its password. The link expires after a short time.</Alert>
                    {isMockMode() && <p className="text-xs text-fg-muted">Local mode sends no email. Local accounts use the dev password shown on the sign-in page.</p>}
                </div>
            ) : (
                <form onSubmit={submit} className="space-y-4" noValidate aria-busy={pending}>
                    {error && !errors.email ? <Alert tone="error">{error instanceof Error ? error.message : 'The request failed.'}</Alert> : null}
                    <p className="text-sm text-fg-muted">Enter the email address you sign in with. We will send you a link to choose a new password.</p>
                    <Field id="reset-email" label="Email" required>
                        <Input id="reset-email" type="email" autoComplete="email" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} required />
                    </Field>
                    <Button type="submit" className="w-full" loading={pending}>
                        Send reset link
                    </Button>
                </form>
            )}
            <Link to="/login" className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-strong">
                Back to sign in
            </Link>
        </AuthLayout>
    );
}

/** How long the reset page waits for the SDK to turn a link's tokens into a recovery session. */
export const RECOVERY_WAIT_MS = 5000;

export function ResetPasswordPage() {
    const { backend, session, signOut } = useBackend();
    const location = useLocation();
    const navigate = useNavigate();
    const [form, setForm] = useState({ password: '', confirm: '' });
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState(false);
    const [done, setDone] = useState(false);
    const linkError = authLinkError(location);
    const [waiting, setWaiting] = useState(() => !linkError && hasAuthTokens(location));
    // `session` comes from context, so the page re-renders when the recovery session arrives.
    const recovery = !!session && backend.auth.inRecovery();
    const errors = fieldErrors(error);

    useEffect(() => {
        if (!waiting) return;
        const timer = setTimeout(() => setWaiting(false), RECOVERY_WAIT_MS);
        return () => clearTimeout(timer);
    }, [waiting]);

    // Between the reset and the redirect the session is already gone; say what happened.
    if (done) {
        return (
            <AuthLayout title="Choose a new password">
                <Alert tone="success">Your password was changed.</Alert>
            </AuthLayout>
        );
    }

    if (!recovery) {
        if (waiting) {
            return (
                <AuthLayout title="Choose a new password">
                    <LoadingState label="Checking your reset link…" />
                </AuthLayout>
            );
        }
        return (
            <AuthLayout title="Choose a new password">
                <Alert tone="error">{linkError ?? 'This reset link is invalid or has expired. Request a new one.'}</Alert>
                <Link to="/forgot-password" className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-strong">
                    Request a new link
                </Link>
            </AuthLayout>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (form.password !== form.confirm) {
            setError({ fields: { confirm: 'The passwords do not match.' } });
            return;
        }
        setPending(true);
        setError(null);
        try {
            await backend.auth.completePasswordReset(form.password);
            setDone(true);
            // End the recovery session: the user signs in again with the new password.
            await signOut();
            navigate('/login?notice=password-reset', { replace: true });
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };
    const formError = error instanceof Error && !Object.keys(errors).length ? error.message : null;

    return (
        <AuthLayout title="Choose a new password">
            <form onSubmit={submit} className="space-y-4" noValidate aria-busy={pending}>
                {formError && <Alert tone="error">{formError}</Alert>}
                <p className="text-sm text-fg-muted">Choose a new password for {session.user.email}.</p>
                <Field id="new-password" label="New password" required hint="At least 8 characters.">
                    <Input id="new-password" type="password" autoComplete="new-password" aria-describedby="new-password-hint" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                </Field>
                <Field id="confirm-password" label="Confirm new password" required>
                    <Input id="confirm-password" type="password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
                </Field>
                <Button type="submit" className="w-full" loading={pending}>
                    Change password
                </Button>
            </form>
        </AuthLayout>
    );
}
