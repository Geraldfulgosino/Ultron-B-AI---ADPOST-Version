<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Support\Carbon;
use Laravel\Socialite\Contracts\User as SocialiteUser;

class CompleteGoogleOAuthAction
{
    public function execute(Organization $organization, User $user, SocialiteUser $googleUser, string $state): Integration
    {
        /** @var array{organization_id: int, website_id?: int|null, provider: string, user_id: int} $payload */
        $payload = decrypt($state);

        abort_unless((int) $payload['organization_id'] === $organization->id, 403);
        abort_unless((int) $payload['user_id'] === $user->id, 403);

        return Integration::create([
            'organization_id' => $organization->id,
            'website_id' => $payload['website_id'] ?? null,
            'created_by' => $user->id,
            'provider' => IntegrationProvider::from($payload['provider']),
            'status' => IntegrationStatus::Connected,
            'external_account_id' => $googleUser->getId(),
            'external_account_name' => $googleUser->getEmail() ?: $googleUser->getName(),
            'access_token' => $googleUser->token,
            'refresh_token' => $googleUser->refreshToken,
            'token_expires_at' => $googleUser->expiresIn ? Carbon::now()->addSeconds($googleUser->expiresIn) : null,
            'metadata' => ['oauth_provider' => 'google'],
        ]);
    }
}
