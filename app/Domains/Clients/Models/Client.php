<?php

declare(strict_types=1);

namespace App\Domains\Clients\Models;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Database\Factories\ClientFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Client extends Model
{
    use HasFactory, SoftDeletes;

    protected static function newFactory(): ClientFactory
    {
        return ClientFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'created_by',
        'name',
        'slug',
        'status',
        'timezone',
        'currency',
        'business_goals',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $client) {
            if (empty($client->slug)) {
                $base = Str::slug($client->name);
                $slug = $base;
                $count = 1;

                while (
                    static::where('organization_id', $client->organization_id)
                        ->where('slug', $slug)
                        ->exists()
                ) {
                    $slug = "{$base}-{$count}";
                    $count++;
                }

                $client->slug = $slug;
            }
        });
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function websites(): HasMany
    {
        return $this->hasMany(Website::class);
    }
}
