<?php

declare(strict_types=1);

namespace App\Domains\Seo\Policies;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Auth\Access\HandlesAuthorization;

class SeoInsightPolicy
{
    use HandlesAuthorization;

    public function view(User $user, SeoInsight $insight): bool
    {
        if (! $this->memberCan($user, $insight->organization_id, 'report.view')) {
            return false;
        }

        $member = $user->memberships()
            ->where('organization_id', $insight->organization_id)
            ->first();

        if ($member?->role === MemberRole::Client && $member->client_id !== null) {
            return $insight->website?->client_id === $member->client_id;
        }

        return true;
    }

    public function viewList(User $user, int $organizationId): bool
    {
        return $this->memberCan($user, $organizationId, 'report.view');
    }

    public function generate(User $user, int $organizationId): bool
    {
        return $this->memberCan($user, $organizationId, 'seo.insights.generate');
    }

    public function updateStatus(User $user, SeoInsight $insight): bool
    {
        return $this->memberCan($user, $insight->organization_id, 'approval.decide');
    }

    private function memberCan(User $user, int $organizationId, string $permission): bool
    {
        $member = $user->memberships()
            ->where('organization_id', $organizationId)
            ->first();

        return $member?->can($permission) ?? false;
    }
}
