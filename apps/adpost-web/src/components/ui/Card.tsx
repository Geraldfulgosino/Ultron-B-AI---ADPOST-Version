import React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('bg-surface rounded-xl border border-line shadow-sm', className)} {...props}>
            {children}
        </div>
    );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('px-6 py-4 border-b border-line-subtle', className)} {...props}>
            {children}
        </div>
    );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    return (
        <h2 className={cn('text-sm font-semibold text-fg', className)} {...props}>
            {children}
        </h2>
    );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('px-6 py-4', className)} {...props}>
            {children}
        </div>
    );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
    return (
        <Card>
            <CardContent>
                <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-fg tabular-nums">{value}</p>
                {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
            </CardContent>
        </Card>
    );
}
