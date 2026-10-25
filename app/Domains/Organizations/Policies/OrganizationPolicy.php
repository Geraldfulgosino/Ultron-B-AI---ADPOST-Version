<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Policies;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Auth\Access\HandlesAuthorization;

class OrganizationPolicy
{
    use HandlesAuthorization;

    public function view(User $user, Organization $organization): bool
    {
        return $organization->members()->where('user_id', $user->id)->exists();
    }

    public function viewMembers(User $user, Organization $organization): bool
    {
        return $this->memberCan($user, $organization, 'organization.view');
    }

    public function update(User $user, Organization $organization): bool
    {
        return $this->memberCan($user, $organization, 'organization.update');
    }

    public function manageMembers(User $user, Organization $organization): bool
    {
        return $this->memberCan($user, $organization, 'organization.manage_users');
    }

    public function inviteMembers(User $user, Organization $organization): bool
    {
        return $this->memberCan($user, $organization, 'member.invite');
    }

    public function transferOwnership(User $user, Organization $organization): bool
    {
        return $organization->members()
            ->where('user_id', $user->id)
            ->where('role', 'owner')
            ->exists();
    }

    private function memberCan(User $user, Organization $organization, string $permission): bool
    {
        $member = $organization->members()->where('user_id', $user->id)->first();

        return $member?->can($permission) ?? false;
    }
}
