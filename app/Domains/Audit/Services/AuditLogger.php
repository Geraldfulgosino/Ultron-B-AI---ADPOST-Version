<?php

declare(strict_types=1);

namespace App\Domains\Audit\Services;

use App\Domains\Audit\Models\AuditLog;
use App\Domains\Identity\Models\User;
use Illuminate\Http\Request;

class AuditLogger
{
    public static function log(
        string $event,
        string $auditableType,
        ?int $auditableId,
        int $organizationId,
        User $actor,
        array $oldValues,
        array $newValues,
        Request $request,
    ): void {
        AuditLog::create([
            'organization_id' => $organizationId,
            'user_id' => $actor->id,
            'event' => $event,
            'auditable_type' => $auditableType,
            'auditable_id' => $auditableId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'url' => $request->fullUrl(),
            'created_at' => now(),
        ]);
    }
}
