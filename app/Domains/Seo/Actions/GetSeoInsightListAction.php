<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Pagination\LengthAwarePaginator;

class GetSeoInsightListAction
{
    /**
     * @param  list<int>|null  $allowedWebsiteIds  null = no restriction, array = client scope
     */
    public function execute(Organization $organization, array $filters, ?array $allowedWebsiteIds = null): LengthAwarePaginator
    {
        $query = SeoInsight::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->with(['website', 'reviewedBy'])
            ->latest();

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['website_id'])) {
            $query->where('website_id', (int) $filters['website_id']);
        }
        if (! empty($filters['severity'])) {
            $query->where('severity', $filters['severity']);
        }
        if (! empty($filters['date_from'])) {
            $query->where('date_from', '>=', $filters['date_from']);
        }
        if (! empty($filters['date_to'])) {
            $query->where('date_to', '<=', $filters['date_to']);
        }

        return $query->paginate(20)->through(fn (SeoInsight $insight) => [
            'id' => $insight->id,
            'type' => $insight->type->value,
            'type_label' => $insight->type->label(),
            'status' => $insight->status->value,
            'status_label' => $insight->status->label(),
            'severity' => $insight->severity,
            'title' => $insight->title,
            'website_name' => $insight->website?->name,
            'reviewed_by_name' => $insight->reviewedBy?->name,
            'created_at' => $insight->created_at?->toDateTimeString(),
        ])->withQueryString();
    }
}
