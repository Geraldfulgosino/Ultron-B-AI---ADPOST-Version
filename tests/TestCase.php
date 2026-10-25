<?php

declare(strict_types=1);

namespace Tests;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Create an organization with a verified owner user.
     *
     * @return array{Organization, User}
     */
    protected function createOrgWithOwner(): array
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        OrganizationMember::factory()->owner()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
        ]);

        return [$org, $user];
    }

    /**
     * Create an organization with a verified user at the given role.
     *
     * @return array{Organization, User}
     */
    protected function createOrgWithUser(string $role = 'admin'): array
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $member = MemberRole::from($role);

        OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'role' => $member->value,
        ]);

        return [$org, $user];
    }

    /**
     * Create a client user (role=client) scoped to the given client within the org.
     *
     * @return array{User, OrganizationMember}
     */
    protected function createClientUser(Organization $org, Client $client): array
    {
        $user = User::factory()->create();
        $member = OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'role' => MemberRole::Client->value,
            'client_id' => $client->id,
        ]);

        return [$user, $member];
    }
}
