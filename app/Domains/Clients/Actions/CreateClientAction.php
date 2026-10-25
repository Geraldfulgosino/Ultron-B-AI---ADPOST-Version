<?php

declare(strict_types=1);

namespace App\Domains\Clients\Actions;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;

class CreateClientAction
{
    /**
     * @param  array{name: string, status?: string, timezone?: string, currency?: string, business_goals?: string|null}  $data
     */
    public function execute(Organization $organization, User $user, array $data): Client
    {
        return Client::create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'name' => $data['name'],
            'status' => $data['status'] ?? 'active',
            'timezone' => $data['timezone'] ?? $organization->timezone,
            'currency' => $data['currency'] ?? $organization->currency,
            'business_goals' => $data['business_goals'] ?? null,
        ]);
    }
}
