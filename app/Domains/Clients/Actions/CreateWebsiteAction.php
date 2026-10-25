<?php

declare(strict_types=1);

namespace App\Domains\Clients\Actions;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;

class CreateWebsiteAction
{
    /**
     * @param  array{name: string, domain: string, client_id: int, platform?: string|null, status?: string, timezone?: string, currency?: string, primary_conversion?: string|null, ga4_property_id?: string|null, gsc_site_url?: string|null}  $data
     */
    public function execute(Organization $organization, User $user, array $data): Website
    {
        $client = Client::where('organization_id', $organization->id)->findOrFail($data['client_id']);

        return Website::create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
            'name' => $data['name'],
            'domain' => $data['domain'],
            'platform' => $data['platform'] ?? null,
            'status' => $data['status'] ?? 'active',
            'timezone' => $data['timezone'] ?? $organization->timezone,
            'currency' => $data['currency'] ?? $organization->currency,
            'primary_conversion' => $data['primary_conversion'] ?? null,
            'ga4_property_id' => $data['ga4_property_id'] ?? null,
            'gsc_site_url' => $data['gsc_site_url'] ?? null,
        ]);
    }
}
