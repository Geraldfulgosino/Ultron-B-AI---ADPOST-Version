<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Policies;

use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Models\Integration;
use Illuminate\Auth\Access\HandlesAuthorization;

class IntegrationPolicy
{
    use HandlesAuthorization;

    public function view(User $user, Integration $integration): bool
    {
        return $this->memberCan($user, $integration, 'integration.view');
    }

    public function connect(User $user, int $organizationId): bool
    {
        return $user->memberships()
            ->where('organization_id', $organizationId)
            ->first()
            ?->can('integration.connect') ?? false;
    }

    public function disconnect(User $user, Integration $integration): bool
    {
        return $this->memberCan($user, $integration, 'integration.disconnect');
    }

    public function sync(User $user, Integration $integration): bool
    {
        return $this->memberCan($user, $integration, 'analytics.sync');
    }

    public function purge(User $user, Integration $integration): bool
    {
        return $this->memberCan($user, $integration, 'integration.disconnect');
    }

    private function memberCan(User $user, Integration $integration, string $permission): bool
    {
        $member = $user->memberships()
            ->where('organization_id', $integration->organization_id)
            ->first();

        return $member?->can($permission) ?? false;
    }
}
