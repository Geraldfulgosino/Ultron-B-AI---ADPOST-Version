<?php

declare(strict_types=1);

namespace Tests\Feature\Integrations;

use App\Domains\Analytics\Enums\AnalyticsSyncStatus;
use App\Domains\Analytics\Models\AnalyticsSyncHistory;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Actions\StartGoogleOAuthAction;
use App\Domains\Integrations\Enums\IntegrationProvider;
use App\Domains\Integrations\Enums\IntegrationStatus;
use App\Domains\Integrations\Models\Integration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\RedirectResponse;
use Tests\TestCase;

class IntegrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_create_google_oauth_placeholder_when_credentials_are_missing(): void
    {
        config([
            'services.google.client_id' => null,
            'services.google.client_secret' => null,
            'services.google.redirect' => null,
        ]);

        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->post(route('integrations.google.connect', ['organization' => $organization->slug]), [
                'provider' => 'google_analytics',
                'website_id' => $website->id,
                'organization_id' => 999999,
            ])
            ->assertRedirect()
            ->assertSessionHas('error');

        $this->assertDatabaseHas('integrations', [
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'provider' => 'google_analytics',
            'status' => IntegrationStatus::Pending->value,
            'access_token' => null,
            'refresh_token' => null,
        ]);
        $this->assertDatabaseMissing('integrations', ['organization_id' => 999999]);
    }

    public function test_member_cannot_connect_integration(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->post(route('integrations.google.connect', ['organization' => $organization->slug]), [
                'provider' => 'google_analytics',
            ])
            ->assertForbidden();
    }

    public function test_cross_organization_disconnect_is_forbidden(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        [$otherOrganization, $otherUser] = $this->createOrgWithOwner();
        $integration = Integration::factory()->create([
            'organization_id' => $otherOrganization->id,
            'created_by' => $otherUser->id,
        ]);

        $this->actingAs($user)
            ->delete(route('integrations.destroy', ['organization' => $organization->slug, 'integration' => $integration->id]))
            ->assertForbidden();
    }

    public function test_google_configured_prop_is_false_when_credentials_missing(): void
    {
        config([
            'services.google.client_id' => null,
            'services.google.client_secret' => null,
            'services.google.redirect' => null,
        ]);

        [$organization, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('googleConfigured', false)
            );
    }

    public function test_google_configured_prop_is_true_when_credentials_present(): void
    {
        config([
            'services.google.client_id' => 'fake-client-id',
            'services.google.client_secret' => 'fake-client-secret',
            'services.google.redirect' => 'http://localhost/callback',
        ]);

        [$organization, $user] = $this->createOrgWithUser('admin');

        $this->actingAs($user)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('googleConfigured', true)
            );
    }

    public function test_viewer_can_view_integrations_index_but_cannot_connect(): void
    {
        [$organization, $user] = $this->createOrgWithUser('viewer');

        $this->actingAs($user)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('canConnect', false)
                ->where('canDisconnect', false)
            );
    }

    public function test_connect_with_google_credentials_returns_inertia_location_for_inertia_requests(): void
    {
        config([
            'services.google.client_id' => 'fake-client-id',
            'services.google.client_secret' => 'fake-client-secret',
            'services.google.redirect' => 'http://localhost/callback',
        ]);

        [$organization, $user] = $this->createOrgWithUser('admin');

        $fakeGoogleUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=fake&fake=1';

        $this->mock(StartGoogleOAuthAction::class, function ($mock) use ($fakeGoogleUrl) {
            $mock->shouldReceive('execute')
                ->once()
                ->andReturn([
                    'redirect' => new RedirectResponse($fakeGoogleUrl),
                    'placeholder' => null,
                ]);
        });

        $response = $this->actingAs($user)
            ->withHeaders(['X-Inertia' => 'true'])
            ->post(
                route('integrations.google.connect', ['organization' => $organization->slug]),
                ['provider' => 'google_analytics'],
            );

        $response->assertStatus(409);
        $response->assertHeader('X-Inertia-Location', $fakeGoogleUrl);
    }

    public function test_index_does_not_expose_tokens(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
            'access_token' => 'secret-access-token',
            'refresh_token' => 'secret-refresh-token',
        ]);

        $response = $this->actingAs($user)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('integrations/Index'));

        $response->assertDontSee('secret-access-token');
        $response->assertDontSee('secret-refresh-token');
    }

    public function test_owner_sees_all_integrations(): void
    {
        [$organization, $owner] = $this->createOrgWithOwner();
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $owner->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $owner->id,
        ]);

        Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => null,
            'created_by' => $owner->id,
        ]);
        Integration::factory()->count(2)->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $owner->id,
        ])->each(function (Integration $integration, int $index): void {
            $integration->update([
                'provider' => $index === 0
                    ? IntegrationProvider::GoogleAnalytics->value
                    : IntegrationProvider::GoogleSearchConsole->value,
            ]);
        });

        $this->actingAs($owner)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->has('integrations', 3)
                ->has('inactiveIntegrations', 0)
            );
    }

    public function test_client_sees_only_assigned_integrations_and_cannot_disconnect(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $myWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);
        $myIntegration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'created_by' => $admin->id,
        ]);
        $myInactiveIntegration = Integration::factory()->disconnected()->create([
            'organization_id' => $organization->id,
            'website_id' => $myWebsite->id,
            'created_by' => $admin->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
        ]);
        Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'created_by' => $admin->id,
        ]);
        Integration::factory()->disconnected()->create([
            'organization_id' => $organization->id,
            'website_id' => $otherWebsite->id,
            'created_by' => $admin->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->has('integrations', 1)
                ->where('integrations.0.id', $myIntegration->id)
                ->where('integrations.0.can_disconnect', false)
                ->where('integrations.0.can_sync', false)
                ->has('inactiveIntegrations', 1)
                ->where('inactiveIntegrations.0.id', $myInactiveIntegration->id)
                ->where('inactiveIntegrations.0.can_disconnect', false)
                ->where('inactiveIntegrations.0.can_sync', false)
            );
    }

    public function test_latest_connected_integration_is_active_and_duplicate_history_is_inactive(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $admin->id]);

        $disconnected = Integration::factory()->disconnected()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $admin->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
            'created_at' => now()->subDays(2),
        ]);
        $failed = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $admin->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
            'status' => IntegrationStatus::Error->value,
            'last_error_message' => 'Missing Search Console permission.',
            'created_at' => now()->subDay(),
        ]);
        $connected = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $admin->id,
            'provider' => IntegrationProvider::GoogleSearchConsole->value,
            'status' => IntegrationStatus::Connected->value,
            'created_at' => now(),
        ]);

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->has('integrations', 1)
                ->where('integrations.0.id', $connected->id)
                ->where('integrations.0.connection_status_label', 'Connected')
                ->where('integrations.0.can_sync', true)
                ->where('integrations.0.can_disconnect', true)
                ->has('inactiveIntegrations', 2)
                ->where('inactiveIntegrations.0.id', $failed->id)
                ->where('inactiveIntegrations.0.connection_status_label', 'Error')
                ->where('inactiveIntegrations.0.can_sync', false)
                ->where('inactiveIntegrations.0.can_disconnect', false)
                ->where('inactiveIntegrations.0.inactive_note', 'This connection is inactive.')
                ->where('inactiveIntegrations.1.id', $disconnected->id)
                ->where('inactiveIntegrations.1.connection_status_label', 'Disconnected')
                ->where('inactiveIntegrations.1.can_sync', false)
                ->where('inactiveIntegrations.1.can_disconnect', false)
            );
    }

    public function test_failed_integration_without_connected_replacement_is_not_active(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
            'status' => IntegrationStatus::Error->value,
            'last_error_message' => 'GA4 property id is missing.',
        ]);
        AnalyticsSyncHistory::factory()->create([
            'organization_id' => $organization->id,
            'integration_id' => $integration->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => AnalyticsSyncStatus::Failed->value,
            'error_message' => 'GA4 property id is missing.',
        ]);

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->has('integrations', 0)
                ->has('inactiveIntegrations', 1)
                ->where('inactiveIntegrations.0.id', $integration->id)
                ->where('inactiveIntegrations.0.connection_status_label', 'Error')
                ->where('inactiveIntegrations.0.last_sync_status_label', 'Failed')
                ->where('inactiveIntegrations.0.last_sync_error_message', 'GA4 property id is missing.')
                ->where('inactiveIntegrations.0.can_sync', false)
                ->where('inactiveIntegrations.0.can_disconnect', false)
            );
    }

    public function test_integration_cards_receive_provider_status_website_and_sync_display_props(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $admin->id,
            'name' => 'Acme Site',
            'domain' => 'acme.test',
        ]);
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'created_by' => $admin->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => IntegrationStatus::Connected->value,
            'external_account_name' => 'analytics@example.com',
            'external_property_name' => 'Acme GA4',
        ]);
        AnalyticsSyncHistory::factory()->create([
            'organization_id' => $organization->id,
            'website_id' => $website->id,
            'integration_id' => $integration->id,
            'provider' => IntegrationProvider::GoogleAnalytics->value,
            'status' => AnalyticsSyncStatus::Completed->value,
            'finished_at' => '2026-06-12 10:15:00',
        ]);

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('integrations.0.provider_label', 'Google Analytics 4')
                ->where('integrations.0.connection_status_label', 'Connected')
                ->where('integrations.0.website_name', 'Acme Site')
                ->where('integrations.0.website_domain', 'acme.test')
                ->where('integrations.0.scope_label', 'Acme Site (acme.test)')
                ->where('integrations.0.external_account_name', 'analytics@example.com')
                ->where('integrations.0.external_property_name', 'Acme GA4')
                ->where('integrations.0.last_sync_status_label', 'Completed')
                ->where('integrations.0.last_synced_at', '2026-06-12 10:15:00')
            );
    }

    public function test_integrations_index_returns_can_configure_automation_true_for_owner(): void
    {
        [$organization, $owner] = $this->createOrgWithOwner();

        $this->actingAs($owner)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('canConfigureAutomation', true)
            );
    }

    public function test_integrations_index_returns_can_configure_automation_true_for_admin(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('canConfigureAutomation', true)
            );
    }

    public function test_integrations_index_returns_can_configure_automation_false_for_viewer(): void
    {
        [$organization, $viewer] = $this->createOrgWithUser('viewer');

        $this->actingAs($viewer)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('canConfigureAutomation', false)
            );
    }

    public function test_viewer_sees_n8n_connection_props_when_connection_exists(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        N8nConnection::factory()->create([
            'organization_id' => $organization->id,
            'connected_by'    => $admin->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/viewer-test',
            'is_enabled'      => true,
            'last_status'     => 'success',
        ]);

        [, $viewer] = $this->createOrgWithUser('viewer');
        $viewer->memberships()->update(['organization_id' => $organization->id]);

        $this->actingAs($viewer)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('canConfigureAutomation', false)
                ->has('n8nConnection')
                ->where('n8nConnection.webhook_url', 'https://n8n.example.com/webhook/viewer-test')
                ->where('n8nConnection.last_status', 'success')
                ->missing('n8nConnection.webhook_secret')
            );
    }

    public function test_disconnect_button_permission_props_follow_role_permissions(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $integration = Integration::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
            'status' => IntegrationStatus::Connected->value,
        ]);

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('integrations.0.id', $integration->id)
                ->where('integrations.0.can_disconnect', true)
                ->where('integrations.0.can_sync', true)
            );

        [, $viewer] = $this->createOrgWithUser('viewer');
        $viewer->memberships()->update(['organization_id' => $organization->id]);

        $this->actingAs($viewer)
            ->get(route('integrations.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('integrations.0.id', $integration->id)
                ->where('integrations.0.can_disconnect', false)
                ->where('integrations.0.can_sync', false)
            );
    }
}
