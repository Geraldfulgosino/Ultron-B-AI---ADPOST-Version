import React from 'react';
import { cn } from '@/lib/utils';

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm', className)}>
            <table className="min-w-full divide-y divide-gray-200 text-sm">{children}</table>
        </div>
    );
}

export function THead({ children }: { children: React.ReactNode }) {
    return <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
    return <tbody className="divide-y divide-gray-100">{children}</tbody>;
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
    return (
        <th scope="col" className={cn('px-4 py-3', className)}>
            {children}
        </th>
    );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
    return <td className={cn('px-4 py-3 text-gray-700', className)}>{children}</td>;
}
