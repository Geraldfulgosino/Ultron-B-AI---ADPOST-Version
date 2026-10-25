import type { BadgeVariant } from '@/components/ui';
import type { IntegrationProvider, IntegrationStatus, SeoInsightStatus, SeoInsightType, Severity } from '@/domain/types';

export const INSIGHT_TYPE_LABELS: Record<SeoInsightType, string> = {
    traffic_drop: 'Traffic drop',
    ctr_opportunity: 'CTR opportunity',
    ranking_opportunity: 'Ranking opportunity',
    conversion_gap: 'Conversion gap',
    technical_issue: 'Technical issue',
    content_gap: 'Content gap',
};

export const INSIGHT_STATUS: Record<SeoInsightStatus, { label: string; variant: BadgeVariant }> = {
    pending: { label: 'Pending', variant: 'yellow' },
    reviewed: { label: 'Reviewed', variant: 'blue' },
    approved: { label: 'Approved', variant: 'green' },
    dismissed: { label: 'Dismissed', variant: 'gray' },
};

/** Status colours always ship with a text label (never colour alone). */
export const SEVERITY: Record<Severity, { label: string; variant: BadgeVariant }> = {
    high: { label: 'High', variant: 'red' },
    medium: { label: 'Medium', variant: 'yellow' },
    low: { label: 'Low', variant: 'gray' },
};

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
    google_analytics: 'Google Analytics 4',
    google_search_console: 'Search Console',
};

export const INTEGRATION_STATUS: Record<IntegrationStatus, { label: string; variant: BadgeVariant }> = {
    connected: { label: 'Connected', variant: 'green' },
    pending: { label: 'Pending OAuth', variant: 'yellow' },
    error: { label: 'Error', variant: 'red' },
    disconnected: { label: 'Disconnected', variant: 'gray' },
};
