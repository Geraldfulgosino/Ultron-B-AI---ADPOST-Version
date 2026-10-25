import type { SeoInsightType } from './types';

/** Lower-case insight type names for prose. */
export const INSIGHT_TYPE_LABELS_PLAIN: Record<SeoInsightType, string> = {
    traffic_drop: 'traffic drop',
    ctr_opportunity: 'CTR opportunity',
    ranking_opportunity: 'ranking opportunity',
    conversion_gap: 'conversion gap',
    technical_issue: 'technical issue',
    content_gap: 'content gap',
};
