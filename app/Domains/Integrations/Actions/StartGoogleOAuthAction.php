<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Actions;

use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Support\Facades\URL;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse;

class StartGoogleOAuthAction
{
    /**
     * @return array{redirect: RedirectResponse|null, placeholder: Integration|null}
     */
    public function execute(
        Organization $organization,
        User $user,
        IntegrationProvider $provider,
        ?Website $website = null,
    ): array {
        if (! $this->hasGoogleCredentials()) {
            $placeholder = Integration::create([
                'organization_id' => $organization->id,
                'website_id' => $website?->id,
                'created_by' => $user->id,
                'provider' => $provider,
                'status' => IntegrationStatus::Pending,
                'metadata' => [
                    'placeholder' => true,
                    'reason' => 'google_oauth_credentials_missing',
                ],
            ]);

            return ['redirect' => null, 'placeholder' => $placeholder];
        }

        $state = encrypt([
            'organization_id' => $organization->id,
            'website_id' => $website?->id,
            'provider' => $provider->value,
            'user_id' => $user->id,
        ]);

        $redirectUrl = URL::route('integrations.google.callback', ['organization' => $organization->slug]);

        return [
            'redirect' => Socialite::driver('google')
                ->redirectUrl($redirectUrl)
                ->scopes($this->scopesFor($provider))
                ->with(['access_type' => 'offline', 'prompt' => 'consent', 'state' => $state])
                ->redirect(),
            'placeholder' => null,
        ];
    }

    private function hasGoogleCredentials(): bool
    {
        return filled(config('services.google.client_id'))
            && filled(config('services.google.client_secret'))
            && filled(config('services.google.redirect'));
    }

    /**
     * @return list<string>
     */
    private function scopesFor(IntegrationProvider $provider): array
    {
        return match ($provider) {
            IntegrationProvider::GoogleAnalytics => ['https://www.googleapis.com/auth/analytics.readonly'],
            IntegrationProvider::GoogleSearchConsole => ['https://www.googleapis.com/auth/webmasters.readonly'],
        };
    }
}
