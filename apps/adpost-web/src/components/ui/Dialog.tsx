import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

/** Accessible modal: labelled, Escape closes, focus moves in and is restored on close. */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        const focusable = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-dialog-close])');
        (focusable ?? panelRef.current)?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key !== 'Tab' || !panelRef.current) return;
            // Keep keyboard focus inside the modal.
            const items = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
            if (!items.length) return;
            const first = items[0]!;
            const last = items[items.length - 1]!;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previous?.focus?.();
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="relative w-full max-w-lg rounded-xl bg-surface shadow-xl focus:outline-none"
            >
                <div className="flex items-center justify-between border-b border-line-subtle px-6 py-4">
                    <h2 id={titleId} className="text-base font-semibold text-fg">
                        {title}
                    </h2>
                    <button type="button" data-dialog-close onClick={onClose} className="rounded p-1 text-fg-subtle hover:text-fg-soft" aria-label="Close">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
                {footer && <div className="flex justify-end gap-2 border-t border-line-subtle px-6 py-4">{footer}</div>}
            </div>
        </div>
    );
}
