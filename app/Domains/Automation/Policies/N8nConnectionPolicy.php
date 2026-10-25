<?php

declare(strict_types=1);

namespace App\Domains\Automation\Policies;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Identity\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class N8nConnectionPolicy
{
    use HandlesAuthorization;

    public function view(User $user, N8nConnection $connection): bool
    {
        return $this->memberCan($user, $connection->organization_id, 'automation.view');
    }

    public function configure(User $user, int $organizationId): bool
    {
        return $this->memberCan($user, $organizationId, 'automation.configure');
    }

    public function disconnect(User $user, N8nConnection $connection): bool
    {
        return $this->memberCan($user, $connection->organization_id, 'automation.configure');
    }

    private function memberCan(User $user, int $organizationId, string $permission): bool
    {
        $member = $user->memberships()
            ->where('organization_id', $organizationId)
            ->first();

        return $member?->can($permission) ?? false;
    }
}
