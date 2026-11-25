import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { formatNumber } from '@/lib/utils';

export interface BarListRow {
    label: string;
    value: number;
    /** Optional display text instead of the formatted value. */
    display?: string;
    /** Emphasised row (e.g. "this website" among competitors). */
    emphasis?: boolean;
}

/**
 * Magnitude as a ranked list of thin single-hue bars. Every value is printed as text beside its
 * bar, so the chart is also its own table view (no colour-only encoding, no hover required).
 */
export function BarList({ title, rows, description, total, max, unit = '' }: { title: string; rows: BarListRow[]; description?: string; total?: number; max?: number; unit?: string }) {
    const top = max ?? Math.max(1, ...rows.map((r) => r.value));
    const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                {description && <p className="text-xs text-fg-muted">{description}</p>}
            </CardHeader>
            <CardContent>
                {rows.length ? (
                    <ul className="space-y-2.5" aria-label={title}>
                        {rows.map((r) => {
                            const share = sum ? r.value / sum : 0;
                            const text = r.display ?? `${formatNumber(r.value)}${unit}`;
                            return (
                                <li key={r.label} title={`${r.label}: ${text}${total !== undefined || max === undefined ? ` (${(share * 100).toFixed(1)}%)` : ''}`}>
                                    <div className="flex items-baseline justify-between gap-2 text-sm">
                                        <span className={r.emphasis ? 'font-semibold text-fg' : 'text-fg-secondary'}>{r.label}</span>
                                        <span className="tabular-nums text-fg">
                                            {text}
                                            {max === undefined && <span className="ml-1.5 text-xs text-fg-muted">{(share * 100).toFixed(1)}%</span>}
                                        </span>
                                    </div>
                                    <div className="mt-1 h-1.5 rounded-full bg-surface-strong" aria-hidden="true">
                                        <div className="h-1.5 rounded-full" style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: 'var(--chart-series)', opacity: r.emphasis || max === undefined ? 1 : 0.75 }} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="text-sm text-fg-muted">No data for this range.</p>
                )}
            </CardContent>
        </Card>
    );
}
