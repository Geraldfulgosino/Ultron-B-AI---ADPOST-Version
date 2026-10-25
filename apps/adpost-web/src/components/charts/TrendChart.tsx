import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SeriesPoint } from '@/domain/analytics';
import { formatDate, formatNumber } from '@/lib/utils';

/** Validated series color (dataviz validator: PASS on light surface). */
const SERIES = '#4f46e5';
const GRID = '#e5e7eb';
const H = 180;
const PAD = { top: 12, right: 16, bottom: 24, left: 44 };

export function compact(v: number): string {
    if (Math.abs(v) >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${+(v / 1_000).toFixed(1)}K`;
    return String(Math.round(v));
}

/** Clean axis ticks: 0 … max rounded to 1/2/2.5/5 × 10^n steps. */
export function niceTicks(max: number, count = 4): number[] {
    if (max <= 0) return [0];
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
    const ticks: number[] = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
    return ticks;
}

/**
 * Single-series line + area wash. Crosshair tooltip on hover and on keyboard
 * (focus the chart, use ←/→). A table view exposes every value without hovering.
 */
export function TrendChart({ title, data, unit = '' }: { title: string; data: SeriesPoint[]; unit?: string }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(600);
    const [active, setActive] = useState<number | null>(null);
    const [showTable, setShowTable] = useState(false);
    const titleId = useId();

    useEffect(() => {
        const el = wrapRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(240, entry.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const geo = useMemo(() => {
        const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
        const top = ticks[ticks.length - 1] || 1;
        const innerW = width - PAD.left - PAD.right;
        const innerH = H - PAD.top - PAD.bottom;
        const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
        const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
        const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
        const area = data.length ? `${line}L${x(data.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
        return { ticks, x, y, line, area, innerW };
    }, [data, width]);

    if (!data.length) {
        return (
            <figure className="rounded-xl border border-gray-200 bg-white p-4">
                <figcaption className="text-sm font-semibold text-gray-900">{title}</figcaption>
                <p className="py-10 text-center text-sm text-gray-500">No data for this range.</p>
            </figure>
        );
    }

    const last = data[data.length - 1]!;
    const pointAt = (clientX: number) => {
        const rect = wrapRef.current!.getBoundingClientRect();
        const rel = clientX - rect.left - PAD.left;
        const i = Math.round((rel / geo.innerW) * (data.length - 1));
        return Math.min(data.length - 1, Math.max(0, i));
    };
    const a = active !== null ? data[active] : undefined;
    const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(width / 110)));

    return (
        <figure className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby={titleId}>
            <div className="flex items-baseline justify-between gap-2">
                <figcaption id={titleId} className="text-sm font-semibold text-gray-900">
                    {title}
                </figcaption>
                <button type="button" className="text-xs font-medium text-indigo-600 hover:text-indigo-700" onClick={() => setShowTable((s) => !s)}>
                    {showTable ? 'View as chart' : 'View as table'}
                </button>
            </div>

            {showTable ? (
                <div className="mt-3 max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                        <caption className="sr-only">{title}</caption>
                        <thead className="text-left text-xs text-gray-500">
                            <tr><th className="py-1">Date</th><th className="py-1 text-right">Value</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 tabular-nums">
                            {data.map((d) => (
                                <tr key={d.date}><td className="py-1 text-gray-700">{d.date}</td><td className="py-1 text-right text-gray-900">{formatNumber(d.value)}{unit}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div
                    ref={wrapRef}
                    className="relative mt-3 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                    tabIndex={0}
                    role="img"
                    aria-label={`${title}: ${data.length} days, latest ${formatNumber(last.value)}${unit}. Use left and right arrows to read values.`}
                    onPointerMove={(e) => setActive(pointAt(e.clientX))}
                    onPointerLeave={() => setActive(null)}
                    onBlur={() => setActive(null)}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') setActive((i) => Math.min(data.length - 1, (i ?? -1) + 1));
                        else if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? data.length) - 1));
                        else if (e.key === 'Escape') setActive(null);
                        else return;
                        e.preventDefault();
                    }}
                >
                    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
                        {geo.ticks.map((t) => (
                            <g key={t}>
                                <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} stroke={GRID} strokeWidth={1} />
                                <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-gray-500 text-[10px]">{compact(t)}</text>
                            </g>
                        ))}
                        {data.map((d, i) =>
                            i % labelEvery === 0 ? (
                                <text key={d.date} x={geo.x(i)} y={H - 6} textAnchor="middle" className="fill-gray-500 text-[10px]">{d.date.slice(5)}</text>
                            ) : null,
                        )}
                        <path d={geo.area} fill={SERIES} fillOpacity={0.1} />
                        <path d={geo.line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        <circle cx={geo.x(data.length - 1)} cy={geo.y(last.value)} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />
                        {a && (
                            <>
                                <line x1={geo.x(active!)} x2={geo.x(active!)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9ca3af" strokeWidth={1} />
                                <circle cx={geo.x(active!)} cy={geo.y(a.value)} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />
                            </>
                        )}
                    </svg>
                    {a && (
                        <div
                            role="status"
                            className="pointer-events-none absolute top-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm"
                            style={{ left: Math.min(Math.max(0, geo.x(active!) - 60), width - 130) }}
                        >
                            <p className="font-semibold text-gray-900 tabular-nums">{formatNumber(a.value)}{unit}</p>
                            <p className="text-gray-500">{formatDate(a.date + 'T00:00:00Z')}</p>
                        </div>
                    )}
                    <p className="sr-only">Latest {formatNumber(last.value)}{unit} on {last.date}</p>
                </div>
            )}
        </figure>
    );
}
