import React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
    'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors bg-surface placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    error?: string;
}

export function Input({ error, className, ...props }: InputProps) {
    return (
        <div className="w-full">
            <input
                aria-invalid={error ? true : undefined}
                className={cn(fieldBase, error ? 'border-danger-line-strong text-danger-ink' : 'border-line-strong text-fg', className)}
                {...props}
            />
            {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
    );
}

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    required?: boolean;
}

export function Label({ required, children, className, ...props }: LabelProps) {
    return (
        <label className={cn('block text-sm font-medium text-fg-secondary mb-1', className)} {...props}>
            {children}
            {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
    );
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, ...props }, ref) => (
        <textarea ref={ref} className={cn(fieldBase, 'border-line-strong text-fg', className)} {...props} />
    ),
);
Textarea.displayName = 'Textarea';

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select className={cn(fieldBase, 'border-line-strong text-fg pr-8', className)} {...props}>
            {children}
        </select>
    );
}

/** Label + control + optional error, wired by id. */
export function Field({
    id,
    label,
    required,
    children,
    hint,
}: {
    id: string;
    label: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <Label htmlFor={id} required={required}>
                {label}
            </Label>
            {children}
            {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
        </div>
    );
}
