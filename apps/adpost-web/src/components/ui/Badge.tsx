import React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'blue';

interface BadgeProps {
    variant?: BadgeVariant;
    children: React.ReactNode;
    className?: string;
}

const styles: Record<BadgeVariant, string> = {
    green:  'bg-green-100 text-green-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    red:    'bg-red-100 text-red-800',
    gray:   'bg-gray-100 text-gray-700',
    indigo: 'bg-indigo-100 text-indigo-800',
    blue:   'bg-blue-100 text-blue-800',
};

export function Badge({ variant = 'gray', children, className }: BadgeProps) {
    return (
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', styles[variant], className)}>
            {children}
        </span>
    );
}
