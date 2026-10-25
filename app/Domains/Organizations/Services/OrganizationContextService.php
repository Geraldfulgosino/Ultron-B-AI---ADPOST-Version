<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Services;

use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;

class OrganizationContextService
{
    public function current(): ?Organization
    {
        return app()->has('current.organization')
            ? app('current.organization')
            : null;
    }

    public function currentMember(): ?OrganizationMember
    {
        return app()->has('current.member')
            ? app('current.member')
            : null;
    }

    public function set(Organization $organization, OrganizationMember $member): void
    {
        app()->instance('current.organization', $organization);
        app()->instance('current.member', $member);
    }

    public function memberCan(string $permission): bool
    {
        return $this->currentMember()?->can($permission) ?? false;
    }

    public function isClientUser(): bool
    {
        return $this->currentMember()?->isClientUser() ?? false;
    }

    public function currentClientId(): ?int
    {
        $member = $this->currentMember();

        return ($member?->isClientUser() === true)
            ? $member->client_id
            : null;
    }

    /**
     * Returns allowed website IDs for the current member, or null if unrestricted.
     *
     * @return list<int>|null
     */
    public function allowedWebsiteIds(): ?array
    {
        $clientId = $this->currentClientId();

        if ($clientId === null) {
            return null;
        }

        return Website::where('client_id', $clientId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
    }

    /** @return list<array{id: int, name: string, slug: string, role: string}> */
    public function userOrganizations(User $user): array
    {
        return $user->memberships()
            ->with('organization')
            ->get()
            ->filter(fn ($m) => $m->organization->isAccessible())
            ->map(fn ($m) => [
                'id' => $m->organization->id,
                'name' => $m->organization->name,
                'slug' => $m->organization->slug,
                'role' => $m->role->value,
            ])
            ->values()
            ->toArray();
    }
}
