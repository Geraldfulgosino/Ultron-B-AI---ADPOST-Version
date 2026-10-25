<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Policies\N8nConnectionPolicy;
use App\Domains\Clients\Models\Client;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class N8nConnectionPolicyTest extends TestCase
{
    use RefreshDatabase;

    private N8nConnectionPolicy $policy;

    protected function setUp(): void
    {
        parent::setUp();
        $this->policy = new N8nConnectionPolicy();
    }

    // ── configure (owner / admin) ──────────────────────────────────────────

    public function test_owner_can_configure_n8n(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->assertTrue($this->policy->configure($owner, $org->id));
    }

    public function test_admin_can_configure_n8n(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->assertTrue($this->policy->configure($admin, $org->id));
    }

    public function test_member_cannot_configure_n8n(): void
    {
        [$org, $member] = $this->createOrgWithUser('member');

        $this->assertFalse($this->policy->configure($member, $org->id));
    }

    public function test_viewer_cannot_configure_n8n(): void
    {
        [$org, $viewer] = $this->createOrgWithUser('viewer');

        $this->assertFalse($this->policy->configure($viewer, $org->id));
    }

    public function test_client_cannot_configure_n8n(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->assertFalse($this->policy->configure($clientUser, $org->id));
    }

    // ── view ───────────────────────────────────────────────────────────────

    public function test_owner_can_view_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $owner->id,
        ]);

        $this->assertTrue($this->policy->view($owner, $connection));
    }

    public function test_member_can_view_n8n_connection(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $admin->id,
        ]);

        [$org2, $member] = $this->createOrgWithUser('member');
        // Member of org with connection:
        $connection2 = N8nConnection::factory()->create([
            'organization_id' => $org2->id,
            'connected_by' => $member->id,
        ]);

        $this->assertTrue($this->policy->view($member, $connection2));
    }

    public function test_client_cannot_view_n8n_connection(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $connection = N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by' => $admin->id,
        ]);
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->assertFalse($this->policy->view($clientUser, $connection));
    }

    // ── tenant isolation ───────────────────────────────────────────────────

    public function test_user_cannot_configure_another_orgs_n8n(): void
    {
        [$orgA, $adminA] = $this->createOrgWithUser('admin');
        [$orgB] = $this->createOrgWithUser('admin');

        $this->assertFalse($this->policy->configure($adminA, $orgB->id));
    }

    public function test_user_cannot_view_another_orgs_n8n_connection(): void
    {
        [$orgA, $adminA] = $this->createOrgWithUser('admin');
        [$orgB, $adminB] = $this->createOrgWithUser('admin');

        $connection = N8nConnection::factory()->create([
            'organization_id' => $orgB->id,
            'connected_by' => $adminB->id,
        ]);

        $this->assertFalse($this->policy->view($adminA, $connection));
    }
}
