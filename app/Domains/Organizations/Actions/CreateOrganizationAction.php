<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Support\Str;

class CreateOrganizationAction
{
    public function execute(User $owner, string $name, string $timezone = 'UTC', string $currency = 'USD'): Organization
    {
        $slug = $this->uniqueSlug($name);

        $organization = Organization::create([
            'name' => $name,
            'slug' => $slug,
            'timezone' => $timezone,
            'currency' => $currency,
        ]);

        OrganizationMember::create([
            'organization_id' => $organization->id,
            'user_id' => $owner->id,
            'role' => MemberRole::Owner,
        ]);

        return $organization;
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name);
        $slug = $base;
        $count = 1;

        while (Organization::where('slug', $slug)->exists()) {
            $slug = "{$base}-{$count}";
            $count++;
        }

        return $slug;
    }
}
