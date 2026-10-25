<?php

declare(strict_types=1);

namespace Tests\Feature\ClientPortal;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Models\Integration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientPortalAccessTest extends TestCase
{
    use RefreshDatabase;

    // ── Client list ────────────────────────────────────────────────────────────

    public function test_client_user_sees_only_their_own_client(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('clients/Index')
                ->where('clients.0.id', $myClient->id)
                ->has('clients', 1)
            );
    }

    public function test_client_user_cannot_see_other_orgs_clients(): void
    {
        [$org1, $admin1] = $this->createOrgWithUser('admin');
        [$org2, $admin2] = $this->createOrgWithUser('admin');

        $clientInOrg1 = Client::factory()->create(['organization_id' => $org1->id, 'created_by' => $admin1->id]);
        $clientInOrg2 = Client::factory()->create(['organization_id' => $org2->id, 'created_by' => $admin2->id]);

        [$clientUser] = $this->createClientUser($org1, $clientInOrg1);

        // Client user from org1 trying to access org2
        $this->actingAs($clientUser)
            ->get(route('clients.index', ['organization' => $org2->slug]))
            ->assertForbidden();
    }

    public function test_admin_sees_all_clients_unchanged(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        Client::factory()->count(3)->create(['organization_id' => $org->id, 'created_by' => $admin->id]);

        $this->actingAs($admin)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('clients/Index')
                ->has('clients', 3)
            );
    }

    // ── Website list ───────────────────────────────────────────────────────────

    public function test_client_user_sees_only_their_clients_websites(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);

        $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('websites.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('websites/Index')
                ->where('websites.0.id', $myWebsite->id)
                ->has('websites', 1)
            );
    }

    public function test_client_user_clients_dropdown_contains_only_their_client(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('websites.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('websites/Index')
                ->has('clients', 1)
                ->where('clients.0.id', $myClient->id)
            );
    }

    public function test_admin_sees_all_websites_unchanged(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        Website::factory()->count(3)->create(['organization_id' => $org->id, 'client_id' => $client->id, 'created_by' => $admin->id]);

        $this->actingAs($admin)
            ->get(route('websites.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('websites/Index')
                ->has('websites', 3)
            );
    }

    // ── Integration list ───────────────────────────────────────────────────────

    public function test_client_user_sees_only_integrations_for_their_websites(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);

        $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        $myIntegration = Integration::factory()->create([
            'organization_id' => $org->id,
            'website_id' => $myWebsite->id,
            'created_by' => $admin->id,
        ]);
        Integration::factory()->create([
            'organization_id' => $org->id,
            'website_id' => $otherWebsite->id,
            'created_by' => $admin->id,
        ]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->where('integrations.0.id', $myIntegration->id)
                ->has('integrations', 1)
            );
    }

    public function test_client_user_websites_dropdown_on_integrations_page_is_scoped(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);

        $myWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->has('websites', 1)
                ->where('websites.0.id', $myWebsite->id)
            );
    }

    public function test_admin_sees_all_integrations_unchanged(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $website = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $client->id, 'created_by' => $admin->id]);
        Integration::factory()->count(3)->create([
            'organization_id' => $org->id,
            'website_id' => $website->id,
            'created_by' => $admin->id,
        ]);

        $this->actingAs($admin)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('integrations/Index')
                ->has('integrations', 1)
                ->has('inactiveIntegrations', 2)
            );
    }

    // ── Read-only prop contract (drives frontend notice vs form) ──────────────

    public function test_admin_can_create_and_manage_clients(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', true)
                ->where('canManage', true)
            );
    }

    public function test_client_user_cannot_create_or_manage_clients(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', false)
                ->where('canManage', false)
            );
    }

    public function test_viewer_cannot_create_or_manage_clients(): void
    {
        [$org, $viewer] = $this->createOrgWithUser('viewer');

        $this->actingAs($viewer)
            ->get(route('clients.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', false)
                ->where('canManage', false)
            );
    }

    public function test_client_user_cannot_create_or_manage_websites(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('websites.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', false)
                ->where('canManage', false)
            );
    }

    public function test_viewer_cannot_create_or_manage_websites(): void
    {
        [$org, $viewer] = $this->createOrgWithUser('viewer');

        $this->actingAs($viewer)
            ->get(route('websites.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('canCreate', false)
                ->where('canManage', false)
            );
    }

    public function test_client_user_cannot_connect_integrations(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('canConnect', false));
    }

    public function test_viewer_cannot_connect_integrations(): void
    {
        [$org, $viewer] = $this->createOrgWithUser('viewer');

        $this->actingAs($viewer)
            ->get(route('integrations.index', ['organization' => $org->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('canConnect', false));
    }
}
