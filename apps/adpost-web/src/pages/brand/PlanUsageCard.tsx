import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@/components/ui';
import { useQuery } from '@/app/backend';
import { FEATURE_LABELS, PLANS, usageVsLimits, type Feature } from '@/domain/plans';
import { formatNumber } from '@/lib/utils';

/** Agency staff only: the agency plan, metered usage and included features. */
export function PlanUsageCard() {
    const q = useQuery((api) => api.workspace.agencyUsage(), []);
    if (q.error) return <ErrorState error={q.error} />;
    if (!q.data) return null;
    const plan = PLANS[q.data.planKey];
    return (
        <Card>
            <CardHeader className="flex items-center justify-between">
                <CardTitle>Agency plan & usage</CardTitle>
                <Badge variant="indigo">{plan.name}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
                <ul className="space-y-3" aria-label="Usage">
                    {usageVsLimits(q.data).map((r) => (
                        <li key={r.label} className="text-sm">
                            <div className="flex justify-between text-gray-700">
                                <span>{r.label}</span>
                                <span className="tabular-nums">{formatNumber(r.used)}{r.limit === null ? ' · unlimited' : ` / ${formatNumber(r.limit)}`}</span>
                            </div>
                            {r.ratio !== null && (
                                <div className="mt-1 h-1.5 rounded-full bg-indigo-100" role="meter" aria-label={r.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, r.ratio) * 100)}>
                                    <div className={`h-1.5 rounded-full ${r.ratio >= 0.9 ? 'bg-red-600' : r.ratio >= 0.7 ? 'bg-yellow-500' : 'bg-indigo-600'}`} style={{ width: `${Math.min(1, r.ratio) * 100}%` }} />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
                <div className="flex flex-wrap gap-1">
                    {(Object.keys(FEATURE_LABELS) as Feature[]).map((f) => (
                        <Badge key={f} variant={plan.features.includes(f) ? 'green' : 'gray'}>{plan.features.includes(f) ? '✓' : '—'} {FEATURE_LABELS[f]}</Badge>
                    ))}
                </div>
                <p className="text-xs text-gray-500">Billing is not connected. Plans are enforced by the data layer today and by Edge Functions after Phase 17.</p>
            </CardContent>
        </Card>
    );
}
