<?php

declare(strict_types=1);

namespace App\Domains\Clients\Actions;

use App\Domains\Clients\Models\Client;

class UpdateClientAction
{
    /**
     * @param  array{name?: string, status?: string, timezone?: string, currency?: string, business_goals?: string|null}  $data
     */
    public function execute(Client $client, array $data): Client
    {
        $client->update($data);

        return $client->refresh();
    }
}
