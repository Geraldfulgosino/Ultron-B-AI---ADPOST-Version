<?php

declare(strict_types=1);

namespace App\Domains\Identity\Models;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable implements MustVerifyEmail
{
    use HasFactory, Notifiable;

    protected static function newFactory(): UserFactory
    {
        return UserFactory::new();
    }

    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        'mfa_secret',
        'mfa_recovery_codes',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'mfa_enabled' => 'boolean',
            'mfa_recovery_codes' => 'encrypted:array',
        ];
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(OrganizationMember::class);
    }

    public function organizations(): HasManyThrough
    {
        return $this->hasManyThrough(
            Organization::class,
            OrganizationMember::class,
            'user_id',
            'id',
            'id',
            'organization_id'
        );
    }

    public function isMemberOf(Organization $organization): bool
    {
        return $this->memberships()
            ->where('organization_id', $organization->id)
            ->exists();
    }

    public function membershipFor(Organization $organization): ?OrganizationMember
    {
        return $this->memberships()
            ->where('organization_id', $organization->id)
            ->first();
    }
}
