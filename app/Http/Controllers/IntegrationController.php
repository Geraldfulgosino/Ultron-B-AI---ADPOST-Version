<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Analytics\Actions\QueueAnalyticsSyncAction;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Integrations\Actions\CompleteGoogleOAuthAction;
use App\Domains\Integrations\Actions\DisconnectIntegrationAction;
use App\Domains\Integrations\Actions\StartGoogleOAuthAction;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Integration\ConnectIntegrationRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\URL;
use Inertia\Inertia;
use Inertia\Response;
use Laravel\Socialite\Facades\Socialite;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

class IntegrationController extends Controller
{
    public function index(OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();
        $integrations = Integration::query()
            ->where('organization_id', $organization->id)
            ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('website_id', $allowedWebsiteIds))
            ->with(['website', 'latestSyncHistory'])
            ->latest()
            ->get();
        $groupedIntegrations = $this->groupIntegrationsForDisplay($integrations);

        return Inertia::render('integrations/Index', [
            'integrations' => $groupedIntegrations['active']
                ->map(fn (Integration $integration) => $this->integrationRow($integration, $context, true))
                ->values(),
            'inactiveIntegrations' => $groupedIntegrations['inactive']
                ->map(fn (Integration $integration) => $this->integrationRow($integration, $context, false))
                ->values(),
            'websites' => $organization->websites()
                ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
                ->orderBy('name')
                ->get(['id', 'name', 'domain']),
            'providers' => array_map(
                fn (IntegrationProvider $provider) => ['value' => $provider->value, 'label' => $this->providerLabel($provider)],
                IntegrationProvider::cases(),
            ),
            'canConnect' => $context->memberCan('integration.connect'),
            'canDisconnect' => $context->memberCan('integration.disconnect'),
            'canSync' => $context->memberCan('analytics.sync'),
            'googleConfigured' => filled(config('services.google.client_id'))
                && filled(config('services.google.client_secret'))
                && filled(config('services.google.redirect')),
            'canConfigureAutomation' => $context->memberCan('automation.configure'),
            'n8nConnection' => $this->n8nConnectionProps($organization, $context),
        ]);
    }

    /** @return array<string, mixed>|null */
    private function n8nConnectionProps(Organization $organization, OrganizationContextService $context): ?array
    {
        if (! $context->memberCan('automation.view')) {
            return null;
        }

        $connection = N8nConnection::where('organization_id', $organization->id)->first();

        if ($connection === null) {
            return null;
        }

        $recentDeliveries = $connection->deliveries()
            ->latest()
            ->take(10)
            ->get()
            ->map(fn ($d) => [
                'id'            => $d->id,
                'event_name'    => $d->event_name,
                'status'        => $d->status->value,
                'response_code' => $d->response_code,
                'sent_at'       => $d->sent_at?->toDateTimeString(),
                'created_at'    => $d->created_at->toDateTimeString(),
            ])
            ->values();

        return [
            'id'               => $connection->id,
            'webhook_url'      => $connection->webhook_url,
            'is_enabled'       => $connection->is_enabled,
            'last_status'      => $connection->last_status,
            'last_tested_at'   => $connection->last_tested_at?->toDateTimeString(),
            'last_error'       => $connection->last_error,
            'recent_deliveries' => $recentDeliveries,
            // webhook_secret is intentionally excluded from all Inertia payloads
        ];
    }

    /**
     * Keep the newest connected integration for each provider/scope in the active
     * list and move older or inactive duplicates into history.
     *
     * @param  Collection<int, Integration>  $integrations
     * @return array{active: Collection<int, Integration>, inactive: Collection<int, Integration>}
     */
    private function groupIntegrationsForDisplay(Collection $integrations): array
    {
        $active = collect();
        $inactive = collect();

        $integrations
            ->groupBy(fn (Integration $integration) => $integration->provider->value.'|'.($integration->website_id ?? 'organization'))
            ->each(function ($group) use ($active, $inactive): void {
                $latestConnected = $group->first(
                    fn (Integration $integration): bool => $integration->status === IntegrationStatus::Connected
                );

                if ($latestConnected !== null) {
                    $active->push($latestConnected);
                }

                $group
                    ->reject(fn (Integration $integration): bool => $latestConnected !== null && $integration->is($latestConnected))
                    ->each(fn (Integration $integration) => $inactive->push($integration));
            });

        return [
            'active' => $active->sortByDesc('created_at')->values(),
            'inactive' => $inactive->sortByDesc('created_at')->values(),
        ];
    }

    /** @return array<string, mixed> */
    private function integrationRow(Integration $integration, OrganizationContextService $context, bool $isActive): array
    {
        /** @var AnalyticsSyncHistory|null $latestSync */
        $latestSync = $integration->latestSyncHistory;
        $connectionStatus = $this->connectionStatus($integration);
        $canSync = $context->memberCan('analytics.sync');
        $canDisconnect = $context->memberCan('integration.disconnect');

        return [
            'id' => $integration->id,
            'website_id' => $integration->website_id,
            'website_name' => $integration->website?->name,
            'website_domain' => $integration->website?->domain,
            'scope_label' => $integration->website
                ? $integration->website->name.' ('.$integration->website->domain.')'
                : 'Organization-level',
            'provider' => $integration->provider->value,
            'provider_label' => $this->providerLabel($integration->provider),
            'status' => $integration->status->value,
            'status_label' => $integration->status->label(),
            'connection_status' => $connectionStatus['value'],
            'connection_status_label' => $connectionStatus['label'],
            'external_account_name' => $integration->external_account_name,
            'external_property_name' => $integration->external_property_name,
            'last_synced_at' => $latestSync?->finished_at?->toDateTimeString()
                ?? $integration->last_synced_at?->toDateTimeString(),
            'last_sync_status' => $latestSync?->status->value,
            'last_sync_status_label' => $latestSync?->status->label(),
            'last_sync_error_message' => $latestSync?->error_message
                ?? $integration->last_error_message,
            'last_error_message' => $integration->last_error_message,
            'is_active' => $isActive,
            'inactive_note' => $isActive ? null : 'This connection is inactive.',
            'can_sync' => $isActive && $canSync && $integration->status === IntegrationStatus::Connected,
            'can_disconnect' => $isActive && $canDisconnect && $integration->status === IntegrationStatus::Connected,
            'can_delete_inactive' => ! $isActive && $canDisconnect,
        ];
    }

    /** @return array{value: string, label: string} */
    private function connectionStatus(Integration $integration): array
    {
        if ($integration->status === IntegrationStatus::Disconnected) {
            return ['value' => 'disconnected', 'label' => 'Disconnected'];
        }

        if ($integration->status === IntegrationStatus::Error) {
            return ['value' => 'error', 'label' => 'Error'];
        }

        if ($integration->status === IntegrationStatus::Connected) {
            return ['value' => 'connected', 'label' => 'Connected'];
        }

        return ['value' => 'needs_setup', 'label' => 'Needs setup'];
    }

    private function providerLabel(IntegrationProvider $provider): string
    {
        return match ($provider) {
            IntegrationProvider::GoogleAnalytics => 'Google Analytics 4',
            IntegrationProvider::GoogleSearchConsole => 'Google Search Console',
        };
    }

    public function connect(
        ConnectIntegrationRequest $request,
        OrganizationContextService $context,
        StartGoogleOAuthAction $action,
    ): SymfonyResponse {
        $result = $action->execute(
            $context->current(),
            $request->user(),
            IntegrationProvider::from($request->validated('provider')),
            $request->website(),
        );

        if ($result['redirect'] !== null) {
            // Inertia::location sends a 409 + X-Inertia-Location header so the
            // client performs a top-level window.location redirect instead of
            // following this redirect inside XHR (which CORS blocks on Google).
            return Inertia::location($result['redirect']);
        }

        return back()->with('error', 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in your .env file to enable live OAuth. A pending placeholder was created.');
    }

    public function googleCallback(
        Request $request,
        OrganizationContextService $context,
        CompleteGoogleOAuthAction $action,
    ): RedirectResponse {
        if (! filled(config('services.google.client_id')) || ! filled(config('services.google.client_secret'))) {
            return redirect()
                ->route('integrations.index', ['organization' => $context->current()->slug])
                ->with('error', 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.');
        }

        $googleUser = Socialite::driver('google')
            ->redirectUrl(URL::route('integrations.google.callback', ['organization' => $context->current()->slug]))
            ->stateless()
            ->user();

        $action->execute($context->current(), $request->user(), $googleUser, (string) $request->query('state'));

        return redirect()
            ->route('integrations.index', ['organization' => $context->current()->slug])
            ->with('success', 'Google integration connected.');
    }

    public function destroy(string $organization, Integration $integration, DisconnectIntegrationAction $action): RedirectResponse
    {
        $this->authorize('disconnect', $integration);

        $action->execute($integration);

        return back()->with('success', 'Integration disconnected.');
    }

    public function destroyInactiveRecord(
        string $organization,
        Integration $integration,
        OrganizationContextService $context,
    ): RedirectResponse {
        $this->authorize('purge', $integration);

        // Refuse to hard-delete the latest connected record for this provider/scope.
        // Active records must be disconnected first via the standard Disconnect action.
        $latestConnected = Integration::query()
            ->where('organization_id', $integration->organization_id)
            ->where('provider', $integration->provider)
            ->where('website_id', $integration->website_id)
            ->where('status', IntegrationStatus::Connected)
            ->latest()
            ->first();

        if ($latestConnected !== null && $latestConnected->id === $integration->id) {
            return back()->with('error', 'Cannot remove an active connection. Use Disconnect first.');
        }

        $integration->delete();

        return back()->with('success', 'Inactive connection removed.');
    }

    public function sync(string $organization, Integration $integration, QueueAnalyticsSyncAction $action, Request $request): RedirectResponse
    {
        $this->authorize('sync', $integration);

        try {
            $action->execute($integration, $request->user());
        } catch (RuntimeException $exception) {
            return back()->with('error', $exception->getMessage());
        }

        return back()->with('success', 'Analytics sync queued.');
    }
}
