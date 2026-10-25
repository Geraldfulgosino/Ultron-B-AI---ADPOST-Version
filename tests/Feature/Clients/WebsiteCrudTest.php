<?php

declare(strict_types=1);

namespace Tests\Feature\Clients;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebsiteCrudTest extends TestCase
{
    use RefreshDatabase;

    public function test_member_can_create_website_for_organization_client(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->post(route('websites.store', ['organization' => $organization->slug]), [
                'client_id' => $client->id,
                'name' => 'Acme Site',
                'domain' => 'Example.COM',
                'platform' => 'WordPress',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
                'primary_conversion' => 'Demo requests',
                'organization_id' => 999999,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('websites', [
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $user->id,
            'domain' => 'example.com',
        ]);
        $this->assertDatabaseMissing('websites', ['organization_id' => 999999]);
    }

    public function test_admin_can_update_website(): void
    {
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
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id,
                'name' => 'Updated Site',
                'domain' => 'updated.test',
                'platform' => 'Custom',
                'status' => 'active',
                'timezone' => 'Asia/Manila',
                'currency' => 'PHP',
                'primary_conversion' => null,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('websites', [
            'id' => $website->id,
            'name' => 'Updated Site',
            'domain' => 'updated.test',
        ]);
    }

    public function test_viewer_cannot_create_website(): void
    {
        [$organization, $user] = $this->createOrgWithUser('viewer');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)
            ->post(route('websites.store', ['organization' => $organization->slug]), [
                'client_id' => $client->id,
                'name' => 'Denied Site',
                'domain' => 'denied.test',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
            ])
            ->assertForbidden();
    }

    public function test_cross_organization_client_is_rejected_when_creating_website(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        [$otherOrganization, $otherUser] = $this->createOrgWithOwner();
        $otherClient = Client::factory()->create([
            'organization_id' => $otherOrganization->id,
            'created_by' => $otherUser->id,
        ]);

        $this->actingAs($user)
            ->post(route('websites.store', ['organization' => $organization->slug]), [
                'client_id' => $otherClient->id,
                'name' => 'Cross Org Site',
                'domain' => 'cross.test',
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
            ])
            ->assertSessionHasErrors('client_id');
    }

    public function test_gsc_site_url_accepts_url_prefix_property(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        $this->actingAs($user)
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id, 'name' => $website->name, 'domain' => $website->domain,
                'status' => 'active', 'timezone' => 'UTC', 'currency' => 'USD',
                'gsc_site_url' => 'https://example.com/',
            ])
            ->assertRedirect()
            ->assertSessionHasNoErrors();

        $this->assertDatabaseHas('websites', ['id' => $website->id, 'gsc_site_url' => 'https://example.com/']);
    }

    public function test_gsc_site_url_accepts_www_url_prefix_property(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        $this->actingAs($user)
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id, 'name' => $website->name, 'domain' => $website->domain,
                'status' => 'active', 'timezone' => 'UTC', 'currency' => 'USD',
                'gsc_site_url' => 'https://www.example.com/',
            ])
            ->assertRedirect()
            ->assertSessionHasNoErrors();

        $this->assertDatabaseHas('websites', ['id' => $website->id, 'gsc_site_url' => 'https://www.example.com/']);
    }

    public function test_gsc_site_url_accepts_sc_domain_property(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        $this->actingAs($user)
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id, 'name' => $website->name, 'domain' => $website->domain,
                'status' => 'active', 'timezone' => 'UTC', 'currency' => 'USD',
                'gsc_site_url' => 'sc-domain:example.com',
            ])
            ->assertRedirect()
            ->assertSessionHasNoErrors();

        $this->assertDatabaseHas('websites', ['id' => $website->id, 'gsc_site_url' => 'sc-domain:example.com']);
    }

    public function test_gsc_site_url_rejects_invalid_value(): void
    {
        [$organization, $user] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create(['organization_id' => $organization->id, 'client_id' => $client->id, 'created_by' => $user->id]);

        $this->actingAs($user)
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id, 'name' => $website->name, 'domain' => $website->domain,
                'status' => 'active', 'timezone' => 'UTC', 'currency' => 'USD',
                'gsc_site_url' => 'not-a-valid-url-or-sc-domain',
            ])
            ->assertSessionHasErrors('gsc_site_url');
    }

    public function test_admin_can_save_ga4_property_id_on_website(): void
    {
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
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id,
                'name' => $website->name,
                'domain' => $website->domain,
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
                'ga4_property_id' => '516552354',
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('websites', [
            'id' => $website->id,
            'ga4_property_id' => '516552354',
        ]);
    }

    public function test_admin_can_save_gsc_site_url_on_website(): void
    {
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
            ->patch(route('websites.update', ['organization' => $organization->slug, 'website' => $website->id]), [
                'client_id' => $client->id,
                'name' => $website->name,
                'domain' => $website->domain,
                'status' => 'active',
                'timezone' => 'UTC',
                'currency' => 'USD',
                'gsc_site_url' => 'https://lugenixdigitalservices.com/',
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('websites', [
            'id' => $website->id,
            'gsc_site_url' => 'https://lugenixdigitalservices.com/',
        ]);
    }

    public function test_admin_can_delete_website(): void
    {
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
            ->delete(route('websites.destroy', ['organization' => $organization->slug, 'website' => $website->id]))
            ->assertRedirect();

        $this->assertSoftDeleted('websites', ['id' => $website->id]);
    }

    public function test_viewer_cannot_delete_website(): void
    {
        [$organization, $owner] = $this->createOrgWithOwner();
        $viewer = User::factory()->create();
        OrganizationMember::factory()->create([
            'organization_id' => $organization->id,
            'user_id' => $viewer->id,
            'role' => 'viewer',
        ]);
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $owner->id,
        ]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id' => $client->id,
            'created_by' => $owner->id,
        ]);

        $this->actingAs($viewer)
            ->delete(route('websites.destroy', ['organization' => $organization->slug, 'website' => $website->id]))
            ->assertForbidden();

        $this->assertNotSoftDeleted('websites', ['id' => $website->id]);
    }
}
