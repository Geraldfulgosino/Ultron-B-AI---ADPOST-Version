<?php

declare(strict_types=1);

namespace App\Domains\Analytics\Models;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Database\Factories\AnalyticsSyncHistoryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AnalyticsSyncHistory extends Model
{
    use HasFactory;

    protected static function newFactory(): AnalyticsSyncHistoryFactory
    {
        return AnalyticsSyncHistoryFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'website_id',
        'integration_id',
        'requested_by',
        'provider',
        'status',
        'date_from',
        'date_to',
        'records_synced',
        'started_at',
        'finished_at',
        'failed_at',
        'error_message',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'provider' => IntegrationProvider::class,
            'status' => AnalyticsSyncStatus::class,
            'date_from' => 'date',
            'date_to' => 'date',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'failed_at' => 'datetime',
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

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }
}
