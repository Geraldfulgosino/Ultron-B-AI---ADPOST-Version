<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Http\Request;

class BulkUpdateSeoInsightStatusAction
{
    public function execute(
        Organization $org,
        array $ids,
        User $actor,
        SeoInsightStatus $newStatus,
        ?string $reviewNotes,
        Request $request,
        string $auditEvent,
    ): int {
        $fields = $newStatus === SeoInsightStatus::Pending
            ? [
                'status' => $newStatus->value,
                'reviewed_by' => null,
                'reviewed_at' => null,
                'review_notes' => null,
            ]
            : [
                'status' => $newStatus->value,
                'reviewed_by' => $actor->id,
                'reviewed_at' => now(),
                'review_notes' => $reviewNotes,
            ];

        $count = SeoInsight::query()
            ->where('organization_id', $org->id)
            ->whereIn('id', $ids)
            ->update($fields);

        AuditLogger::log(
            event: $auditEvent,
            auditableType: SeoInsight::class,
            auditableId: null,
            organizationId: $org->id,
            actor: $actor,
            oldValues: [],
            newValues: ['count' => $count, 'ids' => $ids, 'status' => $newStatus->value],
            request: $request,
        );

        return $count;
    }
}
