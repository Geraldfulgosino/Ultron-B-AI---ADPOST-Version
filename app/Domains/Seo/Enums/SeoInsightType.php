<?php

declare(strict_types=1);

namespace App\Domains\Seo\Enums;

enum SeoInsightType: string
{
    case DecliningPageClicks = 'declining_page_clicks';
    case HighImpressionLowCtrQuery = 'high_impression_low_ctr_query';
    case ImprovingPageImpressions = 'improving_page_impressions';
    case RankingOpportunity = 'ranking_opportunity';
    case MissingOrStaleSync = 'missing_or_stale_sync';

    public function label(): string
    {
        return match ($this) {
            self::DecliningPageClicks => 'Declining page clicks',
            self::HighImpressionLowCtrQuery => 'High impressions, low CTR',
            self::ImprovingPageImpressions => 'Improving page impressions',
            self::RankingOpportunity => 'Ranking opportunity',
            self::MissingOrStaleSync => 'Missing or stale sync',
        };
    }
}
