import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Button';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<AlertTone, string> = {
    info:    'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error:   'bg-red-50 border-red-200 text-red-800',
};

export function Alert({ tone = 'info', children, className }: { tone?: AlertTone; children: React.ReactNode; className?: string }) {
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} className={cn('p-4 border rounded-lg text-sm', tones[tone], className)}>
            {children}
        </div>
    );
}

export function EmptyState({
    title,
    description,
    action,
}: {
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
            {action && <div className="mt-4 flex justify-center">{action}</div>}
        </div>
    );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
    return (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500" role="status">
            <Spinner className="h-5 w-5 text-indigo-600" />
            {label}
        </div>
    );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    return (
        <Alert tone="error">
            <div className="flex items-center justify-between gap-4">
                <span>{message}</span>
                {onRetry && (
                    <button type="button" onClick={onRetry} className="font-medium underline">
                        Retry
                    </button>
                )}
            </div>
        </Alert>
    );
}
