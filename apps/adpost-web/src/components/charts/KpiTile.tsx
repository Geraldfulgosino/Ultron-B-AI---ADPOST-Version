import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import { cn, formatNumber } from '@/lib/utils';
import { compact } from './TrendChart';

/** Stat tile: label · value · signed delta vs a named period (direction × good/bad). */
export function KpiTile({ label, value, delta, period = 'previous period', upIsGood = true, format = 'number' }: {
    label: string;
    value: number;
    delta?: number | null;
    period?: string;
    upIsGood?: boolean;
    format?: 'number' | 'percent' | 'decimal';
}) {
    const shown = format === 'percent' ? `${(value * 100).toFixed(2)}%` : format === 'decimal' ? value.toFixed(1) : value >= 10_000 ? compact(value) : formatNumber(value);
    const hasDelta = delta !== undefined && delta !== null;
    const good = hasDelta && (delta > 0) === upIsGood;
    const Icon = !hasDelta || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
    return (
        <Card>
            <CardContent>
                <p className="text-xs font-medium text-fg-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-fg tabular-nums" title={format === 'number' ? formatNumber(value) : undefined}>
                    {shown}
                </p>
                {delta !== undefined && (
                    <p className={cn('mt-1 flex items-center gap-1 text-xs tabular-nums', !hasDelta || delta === 0 ? 'text-fg-muted' : good ? 'text-success' : 'text-danger-strong')}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {hasDelta ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%` : 'No baseline'}
                        <span className="text-fg-muted">vs {period}</span>
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
