<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Reports\Actions\BuildReportPdfAction;
use App\Domains\Reports\Actions\GetReportPreviewAction;
use App\Http\Requests\Reports\ReportsIndexRequest;
use Symfony\Component\HttpFoundation\Response;

class ReportPdfExportController extends Controller
{
    public function __invoke(
        ReportsIndexRequest $request,
        OrganizationContextService $context,
        GetReportPreviewAction $preview,
        BuildReportPdfAction $pdf,
    ): Response {
        $organization      = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();
        $filters           = $request->filters();

        $data    = $preview->execute($organization, $filters, $allowedWebsiteIds);
        $content = $pdf->execute($data, $organization->name);

        $filename = 'report-'.$filters['date_from'].'-'.$filters['date_to'].'.pdf';

        return response($content, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
        ]);
    }
}
