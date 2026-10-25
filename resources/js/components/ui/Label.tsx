import React from 'react';
import { cn } from '@/lib/utils';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    required?: boolean;
}

export function Label({ required, children, className, ...props }: LabelProps) {
    return (
        <label
            className={cn('block text-sm font-medium text-gray-700 mb-1', className)}
            {...props}
        >
            {children}
            {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
    );
}
