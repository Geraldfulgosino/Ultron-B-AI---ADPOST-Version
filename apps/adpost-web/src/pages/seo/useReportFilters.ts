import { useEffect, useState } from 'react';
import { useBrand, useQuery } from '@/app/backend';
import { presetRange, type FilterValue } from '@/components/filters/ReportFilters';

/** Filters default to the 28 days ending on the latest data date (legacy default window). */
export function useReportFilters(withSource = false) {
    const { brand } = useBrand();
    const range = useQuery((api) => api.analytics.dataRange(brand.id), [brand.id]);
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const [filters, setFilters] = useState<FilterValue | null>(null);

    useEffect(() => {
        if (filters || range.loading) return;
        const end = range.data?.to ?? new Date().toISOString().slice(0, 10);
        setFilters({ ...presetRange(end, 28), websiteId: null, ...(withSource ? { source: 'all' as const } : {}) });
    }, [range.loading, range.data, filters, withSource]);

    return { filters, setFilters, dataEnd: range.data?.to ?? null, websites: websites.data ?? [], ready: filters !== null };
}
