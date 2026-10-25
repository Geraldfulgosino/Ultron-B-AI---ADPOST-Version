import React from 'react';
import { useForm, Link, Head } from '@inertiajs/react';
import AuthLayout from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

export default function Register() {
    const { data, setData, post, processing, errors, reset } = useForm({
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('register'), { onFinish: () => reset('password', 'password_confirmation') });
    };

    return (
        <AuthLayout title="Create your account" description="Get started with ULTRON-B AI">
            <Head title="Register" />

            <form onSubmit={submit} className="space-y-4">
                <div>
                    <Label htmlFor="name" required>Full name</Label>
                    <Input
                        id="name"
                        value={data.name}
                        onChange={(e) => setData('name', e.target.value)}
                        placeholder="Jane Smith"
                        autoComplete="name"
                        autoFocus
                        error={errors.name}
                    />
                </div>

                <div>
                    <Label htmlFor="email" required>Email address</Label>
                    <Input
                        id="email"
                        type="email"
                        value={data.email}
                        onChange={(e) => setData('email', e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        error={errors.email}
                    />
                </div>

                <div>
                    <Label htmlFor="password" required>Password</Label>
                    <Input
                        id="password"
                        type="password"
                        value={data.password}
                        onChange={(e) => setData('password', e.target.value)}
                        autoComplete="new-password"
                        error={errors.password}
                    />
                </div>

                <div>
                    <Label htmlFor="password_confirmation" required>Confirm password</Label>
                    <Input
                        id="password_confirmation"
                        type="password"
                        value={data.password_confirmation}
                        onChange={(e) => setData('password_confirmation', e.target.value)}
                        autoComplete="new-password"
                        error={errors.password_confirmation}
                    />
                </div>

                <Button type="submit" className="w-full" loading={processing}>
                    Create account
                </Button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link href={route('login')} className="text-indigo-600 hover:text-indigo-500 font-medium">
                    Sign in
                </Link>
            </p>
        </AuthLayout>
    );
}
