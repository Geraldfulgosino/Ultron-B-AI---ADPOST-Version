<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Support\Collection;

class GetSeoInsightsForDashboardAction
{
    /**
     * @param  list<int>|null  $allowedWebsiteIds  null = no restriction, array = client scope
     * @return Collection<int, array{id: int, type: string, type_label: string, status: string, status_label: string, severity: string, title: string, summary: string, recommendation: string|null, subject_type: string|null, subject_value: string|null, website_name: string|null, created_at: string|null}>
     */
    public function execute(Organization $organization, ?array $allowedWebsiteIds = null): Collection
    {
        return SeoInsight::query()
            ->where('organization_id', $organization->id)
            ->whereIn('status', [
                SeoInsightStatus::Pending->value,
                SeoInsightStatus::Reviewed->value,
                SeoInsightStatus::Approved->value,
            ])
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->with('website')
            ->latest()
            ->limit(8)
            ->get()
            ->map(fn (SeoInsight $insight) => [
                'id' => $insight->id,
                'type' => $insight->type->value,
                'type_label' => $insight->type->label(),
                'status' => $insight->status->value,
                'status_label' => $insight->status->label(),
                'severity' => $insight->severity,
                'title' => $insight->title,
                'summary' => $insight->summary,
                'recommendation' => $insight->recommendation,
                'subject_type' => $insight->subject_type,
                'subject_value' => $insight->subject_value,
                'website_name' => $insight->website?->name,
                'created_at' => $insight->created_at?->toDateTimeString(),
            ]);
    }
}
