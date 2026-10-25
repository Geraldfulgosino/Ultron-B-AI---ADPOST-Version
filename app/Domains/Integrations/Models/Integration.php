<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Models;

use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Organizations\Models\Organization;
use Database\Factories\IntegrationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Integration extends Model
{
    use HasFactory;

    protected static function newFactory(): IntegrationFactory
    {
        return IntegrationFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'website_id',
        'created_by',
        'provider',
        'status',
        'external_account_id',
        'external_account_name',
        'external_property_id',
        'external_property_name',
        'access_token',
        'refresh_token',
        'scopes',
        'token_expires_at',
        'last_synced_at',
        'last_error_at',
        'last_error_message',
        'metadata',
    ];

    protected $hidden = ['access_token', 'refresh_token'];

    protected function casts(): array
    {
        return [
            'provider' => IntegrationProvider::class,
            'status' => IntegrationStatus::class,
            'access_token' => 'encrypted',
            'refresh_token' => 'encrypted',
            'scopes' => 'array',
            'token_expires_at' => 'datetime',
            'last_synced_at' => 'datetime',
            'last_error_at' => 'datetime',
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

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function latestSyncHistory(): HasOne
    {
        return $this->hasOne(AnalyticsSyncHistory::class)->latestOfMany();
    }

    public function isTokenExpired(): bool
    {
        return $this->token_expires_at !== null && $this->token_expires_at->isPast();
    }

    public function isHealthy(): bool
    {
        return $this->status->isHealthy() && ! $this->isTokenExpired();
    }
}
