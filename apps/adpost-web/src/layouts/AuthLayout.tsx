import React from 'react';
import { Zap } from 'lucide-react';

export function AuthLayout({ children, title, description }: { children: React.ReactNode; title: string; description?: string }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 mb-4">
                        <Zap className="w-7 h-7 text-white" aria-hidden="true" />
                    </div>
                    <p className="text-2xl font-bold text-white">ULTRON-B AI</p>
                    <p className="mt-1 text-sm text-slate-400">{description ?? 'ADPOST Edition'}</p>
                </div>
                <div className="bg-surface rounded-2xl shadow-xl p-6 sm:p-8">
                    <h1 className="text-xl font-semibold text-fg mb-6">{title}</h1>
                    {children}
                </div>
            </div>
        </div>
    );
}
