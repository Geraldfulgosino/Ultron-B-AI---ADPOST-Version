<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Actions;

use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;

class DisconnectIntegrationAction
{
    public function execute(Integration $integration): Integration
    {
        $integration->update([
            'status' => IntegrationStatus::Disconnected,
            'access_token' => null,
            'refresh_token' => null,
            'token_expires_at' => null,
            'last_error_at' => null,
            'last_error_message' => null,
        ]);

        return $integration->refresh();
    }
}
