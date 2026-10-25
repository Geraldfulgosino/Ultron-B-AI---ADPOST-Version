<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Reports\Actions\GetReportPreviewAction;
use App\Http\Requests\Reports\ReportsIndexRequest;
use Inertia\Inertia;
use Inertia\Response;

class ReportsController extends Controller
{
    public function __invoke(
        ReportsIndexRequest $request,
        OrganizationContextService $context,
        GetReportPreviewAction $action,
    ): Response {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        return Inertia::render('reports/Index', $action->execute($organization, $request->filters(), $allowedWebsiteIds));
    }
}
