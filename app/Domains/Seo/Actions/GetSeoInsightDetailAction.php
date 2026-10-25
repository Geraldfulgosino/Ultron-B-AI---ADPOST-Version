<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Seo\Models\SeoInsight;

class GetSeoInsightDetailAction
{
    /** @return array<string, mixed> */
    public function execute(SeoInsight $insight): array
    {
        $insight->load(['website', 'generatedBy', 'reviewedBy']);

        return [
            'id' => $insight->id,
            'type' => $insight->type->value,
            'type_label' => $insight->type->label(),
            'status' => $insight->status->value,
            'status_label' => $insight->status->label(),
            'severity' => $insight->severity,
            'title' => $insight->title,
            'summary' => $insight->summary,
            'recommendation' => $insight->recommendation,
            'evidence' => $insight->evidence,
            'subject_type' => $insight->subject_type,
            'subject_value' => $insight->subject_value,
            'website_name' => $insight->website?->name,
            'generated_by_name' => $insight->generatedBy?->name,
            'reviewed_by_name' => $insight->reviewedBy?->name,
            'review_notes' => $insight->review_notes,
            'date_from' => $insight->date_from?->toDateString(),
            'date_to' => $insight->date_to?->toDateString(),
            'created_at' => $insight->created_at?->toDateTimeString(),
            'reviewed_at' => $insight->reviewed_at?->toDateTimeString(),
        ];
    }
}
