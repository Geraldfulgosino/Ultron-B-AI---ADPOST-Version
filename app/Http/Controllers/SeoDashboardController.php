<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Analytics\Actions\GetSeoDashboardDataAction;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Actions\GetSeoInsightsForDashboardAction;
use App\Http\Requests\Seo\SeoDashboardRequest;
use Inertia\Inertia;
use Inertia\Response;

class SeoDashboardController extends Controller
{
    public function __invoke(
        SeoDashboardRequest $request,
        OrganizationContextService $context,
        GetSeoDashboardDataAction $action,
        GetSeoInsightsForDashboardAction $insights,
    ): Response {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        return Inertia::render('seo/Index', [
            ...$action->execute($organization, $request->filters(), $allowedWebsiteIds),
            'insights' => $insights->execute($organization, $allowedWebsiteIds),
            'canGenerateInsights' => $context->memberCan('seo.insights.generate'),
        ]);
    }
}
