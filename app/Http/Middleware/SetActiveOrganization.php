<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use App\Domains\Organizations\Services\OrganizationContextService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetActiveOrganization
{
    public function __construct(private readonly OrganizationContextService $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $slug = $request->route('organization');

        if ($slug === null) {
            return $next($request);
        }

        $organization = Organization::where('slug', $slug)->first();

        if ($organization === null) {
            abort(404);
        }

        if (! $organization->isAccessible()) {
            abort(403, 'This organization is not accessible.');
        }

        $member = OrganizationMember::where('organization_id', $organization->id)
            ->where('user_id', $request->user()->id)
            ->first();

        if ($member === null) {
            abort(403, 'You are not a member of this organization.');
        }

        $this->context->set($organization, $member);

        return $next($request);
    }
}
