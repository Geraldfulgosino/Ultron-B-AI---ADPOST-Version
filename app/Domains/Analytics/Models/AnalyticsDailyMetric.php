<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Models;

use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AnalyticsDailyMetric extends Model
{
    protected $fillable = [
        'organization_id',
        'website_id',
        'integration_id',
        'metric_date',
        'sessions',
        'active_users',
        'new_users',
        'screen_page_views',
        'conversions',
        'total_revenue',
        'clicks',
        'impressions',
        'ctr',
        'average_position',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'metric_date' => 'date',
            'total_revenue' => 'decimal:2',
            'ctr' => 'decimal:4',
            'average_position' => 'decimal:2',
            'metadata' => 'array',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function website(): BelongsTo
    {
        return $this->belongsTo(Website::class);
    }

    public function integration(): BelongsTo
    {
        return $this->belongsTo(Integration::class);
    }
}
