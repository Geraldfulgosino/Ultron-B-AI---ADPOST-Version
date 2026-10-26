import React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue';

interface BadgeProps {
    variant?: BadgeVariant;
    children: React.ReactNode;
    className?: string;
}

const styles: Record<BadgeVariant, string> = {
    green:  'bg-success-muted text-success-ink',
    yellow: 'bg-warning-muted text-warning-ink',
    red:    'bg-danger-muted text-danger-ink',
    gray:   'bg-surface-strong text-fg-secondary',
    indigo: 'bg-accent-muted text-accent-ink',
    blue:   'bg-info-muted text-info-ink',
};

export function Badge({ variant = 'gray', children, className }: BadgeProps) {
    return (
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', styles[variant], className)}>
            {children}
        </span>
    );
}
