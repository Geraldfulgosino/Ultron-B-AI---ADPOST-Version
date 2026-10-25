<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Models;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Enums\OrganizationStatus;
use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Organization extends Model
{
    use HasFactory, SoftDeletes;

    protected static function newFactory(): OrganizationFactory
    {
        return OrganizationFactory::new();
    }

    protected $fillable = ['name', 'slug', 'status', 'timezone', 'currency', 'metadata'];

    protected function casts(): array
    {
        return [
            'status' => OrganizationStatus::class,
            'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $organization) {
            if (empty($organization->slug)) {
                $organization->slug = Str::slug($organization->name);
            }
        });
    }

    public function members(): HasMany
    {
        return $this->hasMany(OrganizationMember::class);
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'organization_members')
            ->withPivot('role', 'department_id')
            ->withTimestamps();
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(OrganizationInvitation::class);
    }

    public function clients(): HasMany
    {
        return $this->hasMany(Client::class);
    }

    public function websites(): HasMany
    {
        return $this->hasMany(Website::class);
    }

    public function integrations(): HasMany
    {
        return $this->hasMany(Integration::class);
    }

    public function ownerMember(): ?OrganizationMember
    {
        return $this->members()->where('role', MemberRole::Owner)->first();
    }

    public function isAccessible(): bool
    {
        return $this->status->isAccessible();
    }
}
