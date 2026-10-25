import React from 'react';
import { usePage } from '@inertiajs/react';

interface Props {
    status: number;
    message: string;
}

interface SharedProps {
    auth?: { user?: { name: string } };
    currentOrganization?: { slug: string };
}

export default function Error({ status, message }: Props) {
    const { auth, currentOrganization } = usePage().props as unknown as SharedProps;

    const href = currentOrganization
        ? `/${currentOrganization.slug}/dashboard`
        : '/';

    const isAuthenticated = !!auth?.user;

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="text-center max-w-sm">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-indigo-100 flex items-center justify-center">
                    <svg
                        className="w-8 h-8 text-indigo-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                        />
                    </svg>
                </div>

                <p className="text-7xl font-bold text-indigo-600 mb-4">{status}</p>
                <p className="text-lg font-medium text-slate-800 mb-2">{message}</p>

                <a
                    href={href}
                    className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    {isAuthenticated ? 'Back to Dashboard' : 'Go to Home'}
                </a>
            </div>
        </div>
    );
}
