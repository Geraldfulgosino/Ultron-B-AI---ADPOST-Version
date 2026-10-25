<?php

declare(strict_types=1);

namespace App\Domains\Automation\Actions;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Organizations\Models\Organization;

class DisconnectN8nConnectionAction
{
    public function execute(Organization $org): void
    {
        N8nConnection::where('organization_id', $org->id)
            ->update(['is_enabled' => false]);
    }
}
