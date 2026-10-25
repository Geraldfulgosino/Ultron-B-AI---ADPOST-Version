<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Reports\Actions\BuildReportCsvAction;
use App\Domains\Reports\Actions\GetReportPreviewAction;
use App\Http\Requests\Reports\ReportsIndexRequest;
use Symfony\Component\HttpFoundation\Response;

class ReportExportController extends Controller
{
    public function __invoke(
        ReportsIndexRequest $request,
        OrganizationContextService $context,
        GetReportPreviewAction $preview,
        BuildReportCsvAction $csv,
    ): Response {
        $organization      = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();
        $filters           = $request->filters();

        $data    = $preview->execute($organization, $filters, $allowedWebsiteIds);
        $content = $csv->execute($data, $organization->name);

        $filename = 'report-'.$filters['date_from'].'-'.$filters['date_to'].'.csv';

        return response($content, 200, [
            'Content-Type'        => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
        ]);
    }
}
