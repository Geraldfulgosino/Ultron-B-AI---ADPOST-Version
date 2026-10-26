import React from 'react';
import { cn } from '@/lib/utils';

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('overflow-x-auto rounded-xl border border-line bg-surface shadow-sm', className)}>
            <table className="min-w-full divide-y divide-line text-sm">{children}</table>
        </div>
    );
}

export function THead({ children }: { children: React.ReactNode }) {
    return <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-muted">{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
    return <tbody className="divide-y divide-line-subtle">{children}</tbody>;
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
    return (
        <th scope="col" className={cn('px-4 py-3', className)}>
            {children}
        </th>
    );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
    return <td className={cn('px-4 py-3 text-fg-secondary', className)}>{children}</td>;
}
