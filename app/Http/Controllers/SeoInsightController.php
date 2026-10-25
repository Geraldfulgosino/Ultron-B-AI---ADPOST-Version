<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Clients\Models\Website;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Actions\BulkUpdateSeoInsightStatusAction;
use App\Domains\Seo\Actions\GenerateSeoInsightsAction;
use App\Domains\Seo\Actions\GetSeoInsightDetailAction;
use App\Domains\Seo\Actions\GetSeoInsightListAction;
use App\Domains\Seo\Actions\UpdateSeoInsightStatusAction;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use App\Http\Requests\Seo\BulkUpdateSeoInsightStatusRequest;
use App\Http\Requests\Seo\GenerateSeoInsightsRequest;
use App\Http\Requests\Seo\SeoInsightIndexRequest;
use App\Http\Requests\Seo\UpdateSeoInsightStatusRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class SeoInsightController extends Controller
{
    public function index(
        SeoInsightIndexRequest $request,
        OrganizationContextService $context,
        GetSeoInsightListAction $action,
    ): Response {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        return Inertia::render('seo/InsightsIndex', [
            'insights' => $action->execute($organization, $request->filters(), $allowedWebsiteIds),
            'filters' => $request->filters(),
            'websites' => Website::where('organization_id', $organization->id)
                ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
                ->select('id', 'name', 'domain')
                ->orderBy('name')
                ->get(),
            'canUpdateStatus' => $context->memberCan('approval.decide'),
        ]);
    }

    public function show(
        string $organization,
        SeoInsight $insight,
        OrganizationContextService $context,
        GetSeoInsightDetailAction $action,
    ): Response {
        $this->authorize('view', $insight);

        return Inertia::render('seo/InsightShow', [
            'insight' => $action->execute($insight),
            'canUpdateStatus' => $context->memberCan('approval.decide'),
        ]);
    }

    public function generate(
        GenerateSeoInsightsRequest $request,
        OrganizationContextService $context,
        GenerateSeoInsightsAction $action,
    ): RedirectResponse {
        $count = $action->execute($context->current(), $request->user());

        return back()->with('success', "{$count} SEO insights generated from local analytics data.");
    }

    public function markReviewed(
        UpdateSeoInsightStatusRequest $request,
        string $organization,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Reviewed, $request->input('review_notes'), $request, 'insight.reviewed');

        return back()->with('success', 'Insight marked as reviewed.');
    }

    public function markApproved(
        UpdateSeoInsightStatusRequest $request,
        string $organization,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Approved, $request->input('review_notes'), $request, 'insight.approved');

        return back()->with('success', 'Insight approved.');
    }

    public function markDismissed(
        UpdateSeoInsightStatusRequest $request,
        string $organization,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Dismissed, $request->input('review_notes'), $request, 'insight.dismissed');

        return back()->with('success', 'Insight dismissed.');
    }

    public function reopen(
        UpdateSeoInsightStatusRequest $request,
        string $organization,
        SeoInsight $insight,
        UpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $action->execute($insight, $request->user(), SeoInsightStatus::Pending, null, $request, 'insight.reopened');

        return back()->with('success', 'Insight reopened.');
    }

    public function bulkReviewed(
        BulkUpdateSeoInsightStatusRequest $request,
        OrganizationContextService $context,
        BulkUpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $count = $action->execute(
            $context->current(),
            $request->input('ids'),
            $request->user(),
            SeoInsightStatus::Reviewed,
            $request->input('review_notes'),
            $request,
            'insight.bulk_reviewed',
        );

        return back()->with('success', "{$count} insights marked as reviewed.");
    }

    public function bulkDismissed(
        BulkUpdateSeoInsightStatusRequest $request,
        OrganizationContextService $context,
        BulkUpdateSeoInsightStatusAction $action,
    ): RedirectResponse {
        $count = $action->execute(
            $context->current(),
            $request->input('ids'),
            $request->user(),
            SeoInsightStatus::Dismissed,
            null,
            $request,
            'insight.bulk_dismissed',
        );

        return back()->with('success', "{$count} insights dismissed.");
    }
}
