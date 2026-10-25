<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Analytics\Actions\GetDashboardSummaryAction;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __invoke(Request $request, OrganizationContextService $context, GetDashboardSummaryAction $summary): Response
    {
        $organization = $context->current();
        $member = $context->currentMember();
        $allowedWebsiteIds = $context->allowedWebsiteIds();
        $scopedClientId = $context->currentClientId();
        $stats = $summary->execute($organization, $scopedClientId, $allowedWebsiteIds);

        return Inertia::render('Dashboard', [
            'organization' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'slug' => $organization->slug,
                'timezone' => $organization->timezone,
            ],
            'member' => [
                'role' => $member->role->value,
                'label' => $member->role->label(),
            ],
            'stats' => $stats,
        ]);
    }
}
