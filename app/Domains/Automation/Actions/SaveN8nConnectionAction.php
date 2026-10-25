<?php

declare(strict_types=1);

namespace App\Domains\Automation\Actions;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;

class SaveN8nConnectionAction
{
    public function execute(
        Organization $org,
        User $connectedBy,
        string $webhookUrl,
        ?string $secret,
        bool $isEnabled,
    ): N8nConnection {
        $this->validateUrl($webhookUrl);

        $existing = N8nConnection::where('organization_id', $org->id)->first();

        $data = [
            'connected_by' => $connectedBy->id,
            'webhook_url'  => $webhookUrl,
            'is_enabled'   => $isEnabled,
            'last_error'   => null,
        ];

        if ($existing === null) {
            $data['organization_id'] = $org->id;
            $data['webhook_secret']  = filled($secret) ? $secret : null;

            return N8nConnection::create($data);
        }

        // On update: only overwrite the secret when a new value is explicitly provided.
        if (filled($secret)) {
            $data['webhook_secret'] = $secret;
        }

        $existing->update($data);

        return $existing->refresh();
    }

    private function validateUrl(string $url): void
    {
        $scheme = parse_url($url, PHP_URL_SCHEME);

        if (! filter_var($url, FILTER_VALIDATE_URL) || ! in_array($scheme, ['http', 'https'], strict: true)) {
            throw new \InvalidArgumentException(
                "Webhook URL must be a valid http or https URL. Received: {$url}"
            );
        }
    }
}
