<?php

declare(strict_types=1);

namespace App\Domains\Automation\Models;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Database\Factories\N8nConnectionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class N8nConnection extends Model
{
    use HasFactory;

    protected static function newFactory(): N8nConnectionFactory
    {
        return N8nConnectionFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'connected_by',
        'webhook_url',
        'webhook_secret',
        'is_enabled',
        'last_tested_at',
        'last_status',
        'last_error',
    ];

    protected $hidden = ['webhook_secret'];

    protected function casts(): array
    {
        return [
            'webhook_secret' => 'encrypted',
            'is_enabled'     => 'boolean',
            'last_tested_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function connectedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'connected_by');
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(N8nWebhookDelivery::class);
    }
}
