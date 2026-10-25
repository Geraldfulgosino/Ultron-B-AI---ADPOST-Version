<?php

declare(strict_types=1);

namespace App\Domains\Clients\Policies;

use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class WebsitePolicy
{
    use HandlesAuthorization;

    public function view(User $user, Website $website): bool
    {
        return $this->memberCan($user, $website, 'website.view');
    }

    public function create(User $user, int $organizationId): bool
    {
        return $user->memberships()
            ->where('organization_id', $organizationId)
            ->first()
            ?->can('website.create') ?? false;
    }

    public function update(User $user, Website $website): bool
    {
        return $this->memberCan($user, $website, 'website.manage');
    }

    public function delete(User $user, Website $website): bool
    {
        return $this->memberCan($user, $website, 'website.manage');
    }

    private function memberCan(User $user, Website $website, string $permission): bool
    {
        $member = $user->memberships()
            ->where('organization_id', $website->organization_id)
            ->first();

        return $member?->can($permission) ?? false;
    }
}
