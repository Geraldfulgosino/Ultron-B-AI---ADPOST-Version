<?php

declare(strict_types=1);

namespace App\Domains\Clients\Models;

use App\Domains\Clients\Enums\WebsiteStatus;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Database\Factories\WebsiteFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Website extends Model
{
    use HasFactory, SoftDeletes;

    protected static function newFactory(): WebsiteFactory
    {
        return WebsiteFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'client_id',
        'created_by',
        'name',
        'domain',
        'platform',
        'status',
        'timezone',
        'currency',
        'primary_conversion',
        'ga4_property_id',
        'gsc_site_url',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'status' => WebsiteStatus::class,
            'metadata' => 'array',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function integrations(): HasMany
    {
        return $this->hasMany(Integration::class);
    }
}
