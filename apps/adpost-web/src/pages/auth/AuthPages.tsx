import React, { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';
import { fieldErrors, useBackend } from '@/app/backend';
import { DEV_PASSWORD } from '@/data/local/fixtures';

/** Only allow same-app relative redirects (no open redirect via ?next=). */
export function safeNext(next: string | null): string {
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/brands';
}

export function LoginPage() {
    const { session, signIn } = useBackend();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const next = safeNext(params.get('next'));

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
            <form onSubmit={submit} className="space-y-4" noValidate>
                {error && <Alert tone="error">{error}</Alert>}
                <Field id="email" label="Email" required>
                    <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field id="password" label="Password" required>
                    <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <div className="flex items-center justify-between text-sm">
                    <Link to="/forgot-password" className="text-indigo-600 hover:text-indigo-700">
                        Forgot password?
                    </Link>
                    <Link to="/register" className="text-indigo-600 hover:text-indigo-700">
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

const DEV_ACCOUNTS: Array<[string, string]> = [
    ['alex@adpost.example.test', 'Agency owner: all brands'],
    ['morgan@adpost.example.test', 'ADPOST admin, POD manager'],
    ['priya@pod.example.test', 'POD owner'],
    ['dana@dmd.example.test', 'DMD manager'],
    ['vic@pod.example.test', 'POD viewer'],
    ['casey@client.example.test', 'POD client portal'],
];

/** Local-adapter only: synthetic accounts for exercising roles. */
function DevAccountsHint({ onPick }: { onPick: (email: string) => void }) {
    if (import.meta.env.VITE_BACKEND && import.meta.env.VITE_BACKEND !== 'local') return null;
    return (
        <details className="mt-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">Local dev accounts (synthetic)</summary>
            <p className="mt-2">
                Password for all: <code className="font-mono">{DEV_PASSWORD}</code>
            </p>
            <ul className="mt-2 space-y-1">
                {DEV_ACCOUNTS.map(([email, label]) => (
                    <li key={email}>
                        <button type="button" className="text-indigo-600 hover:underline" onClick={() => onPick(email)}>
                            {email}
                        </button>{' '}
                        <span className="text-gray-500">— {label}</span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

export function RegisterPage() {
    const { session, register } = useBackend();
    const navigate = useNavigate();
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState(false);
    const errors = fieldErrors(error);

    if (session) return <Navigate to="/brands" replace />;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
            await register(form);
            navigate('/brands', { replace: true });
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <AuthLayout title="Create account">
            <form onSubmit={submit} className="space-y-4" noValidate>
                <Field id="name" label="Name" required>
                    <Input id="name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field id="reg-email" label="Email" required>
                    <Input id="reg-email" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field id="reg-password" label="Password" required hint="At least 8 characters.">
                    <Input id="reg-password" type="password" autoComplete="new-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
                <Button type="submit" className="w-full" loading={pending}>
                    Create account
                </Button>
                <p className="text-center text-sm text-gray-500">
                    Already registered?{' '}
                    <Link to="/login" className="text-indigo-600 hover:text-indigo-700">
                        Sign in
                    </Link>
                </p>
            </form>
        </AuthLayout>
    );
}

export function ForgotPasswordPage() {
    return (
        <AuthLayout title="Reset password">
            <Alert tone="info">
                Password reset emails are sent by Supabase Auth, which connects in Phase 17. Local development accounts use the shared dev password shown on the sign-in page.
            </Alert>
            <Link to="/login" className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
                Back to sign in
            </Link>
        </AuthLayout>
    );
}
