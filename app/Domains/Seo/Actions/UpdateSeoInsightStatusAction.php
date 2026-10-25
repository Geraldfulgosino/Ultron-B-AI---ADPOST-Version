<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Audit\Services\AuditLogger;
use App\Domains\Identity\Models\User;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Http\Request;

class UpdateSeoInsightStatusAction
{
    public function execute(
        SeoInsight $insight,
        User $actor,
        SeoInsightStatus $newStatus,
        ?string $reviewNotes,
        Request $request,
        string $auditEvent,
    ): SeoInsight {
        $oldStatus = $insight->status;

        $insight->status = $newStatus;

        if ($newStatus === SeoInsightStatus::Pending) {
            $insight->reviewed_by = null;
            $insight->reviewed_at = null;
            $insight->review_notes = null;
        } else {
            $insight->reviewed_by = $actor->id;
            $insight->reviewed_at = now();
            $insight->review_notes = $reviewNotes;
        }

        $insight->save();

        AuditLogger::log(
            event: $auditEvent,
            auditableType: SeoInsight::class,
            auditableId: $insight->id,
            organizationId: $insight->organization_id,
            actor: $actor,
            oldValues: ['status' => $oldStatus->value],
            newValues: ['status' => $newStatus->value, 'review_notes' => $reviewNotes],
            request: $request,
        );

        return $insight->refresh();
    }
}
