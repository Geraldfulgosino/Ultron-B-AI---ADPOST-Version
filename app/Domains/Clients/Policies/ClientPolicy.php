<?php

declare(strict_types=1);

namespace App\Domains\Clients\Policies;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class ClientPolicy
{
    use HandlesAuthorization;

    public function view(User $user, Client $client): bool
    {
        return $this->memberCan($user, $client, 'client.view');
    }

    public function create(User $user, int $organizationId): bool
    {
        return $user->memberships()
            ->where('organization_id', $organizationId)
            ->first()
            ?->can('client.create') ?? false;
    }

    public function update(User $user, Client $client): bool
    {
        return $this->memberCan($user, $client, 'client.manage');
    }

    public function delete(User $user, Client $client): bool
    {
        return $this->memberCan($user, $client, 'client.manage');
    }

    private function memberCan(User $user, Client $client, string $permission): bool
    {
        if ($client->organization_id === null) {
            return false;
        }

        $member = $user->memberships()
            ->where('organization_id', $client->organization_id)
            ->first();

        return $member?->can($permission) ?? false;
    }
}
