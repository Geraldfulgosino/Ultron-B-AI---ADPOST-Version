import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Button';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<AlertTone, string> = {
    info:    'bg-info-soft border-info-line text-info-ink',
    success: 'bg-success-soft border-success-line text-success-ink',
    warning: 'bg-warning-soft border-warning-line text-warning-ink',
    error:   'bg-danger-soft border-danger-line text-danger-ink',
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
        <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <p className="text-sm font-semibold text-fg">{title}</p>
            {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
            {action && <div className="mt-4 flex justify-center">{action}</div>}
        </div>
    );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
    return (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg-muted" role="status">
            <Spinner className="h-5 w-5 text-accent" />
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
