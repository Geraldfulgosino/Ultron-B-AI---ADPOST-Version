<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganizationMember>
 */
class OrganizationMemberFactory extends Factory
{
    protected $model = OrganizationMember::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'role' => MemberRole::Member->value,
        ];
    }

    public function owner(): static
    {
        return $this->state(['role' => MemberRole::Owner->value]);
    }

    public function admin(): static
    {
        return $this->state(['role' => MemberRole::Admin->value]);
    }

    public function viewer(): static
    {
        return $this->state(['role' => MemberRole::Viewer->value]);
    }
}
