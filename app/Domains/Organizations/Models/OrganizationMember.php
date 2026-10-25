<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Models;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use Database\Factories\OrganizationMemberFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationMember extends Model
{
    use HasFactory;

    protected static function newFactory(): OrganizationMemberFactory
    {
        return OrganizationMemberFactory::new();
    }

    protected $fillable = ['organization_id', 'user_id', 'role', 'department_id', 'client_id'];

    protected function casts(): array
    {
        return [
            'role' => MemberRole::class,
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function can(string $permission): bool
    {
        return $this->role->can($permission);
    }

    public function isOwner(): bool
    {
        return $this->role === MemberRole::Owner;
    }

    public function isAdminOrOwner(): bool
    {
        return in_array($this->role, [MemberRole::Owner, MemberRole::Admin], strict: true);
    }

    public function isClientUser(): bool
    {
        return $this->role === MemberRole::Client;
    }
}
