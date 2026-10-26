import { addDays } from '@/domain/analytics';
import type { ReportSource } from '@/domain/analytics';
import { Input, Label, Select } from '@/components/ui';

export const PRESETS = [7, 28, 90] as const;

export interface FilterValue {
    from: string;
    to: string;
    websiteId: string | null;
    source?: ReportSource;
}

/** Last N days ending on the latest date that has data (fixtures/syncs lag "today"). */
export function presetRange(end: string, days: number): { from: string; to: string } {
    return { from: addDays(end, -(days - 1)), to: end };
}

/** One row of filters above the content they scope: date range first. */
export function ReportFiltersBar({
    value,
    onChange,
    dataEnd,
    websites,
    showSource = false,
}: {
    value: FilterValue;
    onChange: (v: FilterValue) => void;
    dataEnd: string | null;
    websites: Array<{ id: string; name: string }>;
    showSource?: boolean;
}) {
    const activePreset = dataEnd ? PRESETS.find((d) => presetRange(dataEnd, d).from === value.from && value.to === dataEnd) : undefined;
    return (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
            {dataEnd && (
                <div>
                    <span className="block text-sm font-medium text-fg-secondary mb-1">Range</span>
                    <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
                        {PRESETS.map((d) => (
                            <button
                                key={d}
                                type="button"
                                aria-pressed={activePreset === d}
                                onClick={() => onChange({ ...value, ...presetRange(dataEnd, d) })}
                                className={`rounded-md px-3 py-1.5 text-sm ${activePreset === d ? 'bg-indigo-600 text-white' : 'text-fg-secondary hover:bg-surface-strong'}`}
                            >
                                {d}d
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div>
                <Label htmlFor="filter-from">From</Label>
                <Input id="filter-from" type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
            </div>
            <div>
                <Label htmlFor="filter-to">To</Label>
                <Input id="filter-to" type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
            </div>
            <div className="min-w-48">
                <Label htmlFor="filter-website">Website</Label>
                <Select id="filter-website" value={value.websiteId ?? ''} onChange={(e) => onChange({ ...value, websiteId: e.target.value || null })}>
                    <option value="">All websites</option>
                    {websites.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </Select>
            </div>
            {showSource && (
                <div>
                    <Label htmlFor="filter-source">Source</Label>
                    <Select id="filter-source" value={value.source ?? 'all'} onChange={(e) => onChange({ ...value, source: e.target.value as ReportSource })}>
                        <option value="all">GA4 + GSC</option>
                        <option value="ga4">GA4 only</option>
                        <option value="gsc">GSC only</option>
                    </Select>
                </div>
            )}
        </div>
    );
}
