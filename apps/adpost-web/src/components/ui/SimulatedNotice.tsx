import { FlaskConical } from 'lucide-react';
import { Badge } from './Badge';

/** Shown wherever synthetic demo data is on screen. Never conditional on styling alone. */
export function SimulatedNotice({ what = 'data on this page' }: { what?: string }) {
    return (
        <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-ink">
            <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
            <Badge variant="yellow">Simulated</Badge>
            <span>
                Demo dataset: the {what} is synthetic, generated locally for demonstration. It is not measured client performance and no
                provider (GA4, Search Console, crawler, AI model) was contacted.
            </span>
        </div>
    );
}

export function SimulatedBadge() {
    return <Badge variant="yellow">Simulated</Badge>;
}
