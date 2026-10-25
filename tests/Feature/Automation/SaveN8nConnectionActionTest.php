<?php

declare(strict_types=1);

namespace Tests\Feature\Automation;

use App\Domains\Automation\Actions\SaveN8nConnectionAction;
use App\Domains\Automation\Models\N8nConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SaveN8nConnectionActionTest extends TestCase
{
    use RefreshDatabase;

    private SaveN8nConnectionAction $action;

    protected function setUp(): void
    {
        parent::setUp();
        $this->action = new SaveN8nConnectionAction();
    }

    public function test_save_creates_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = $this->action->execute(
            org: $org,
            connectedBy: $owner,
            webhookUrl: 'https://n8n.example.com/webhook/test',
            secret: 'my-secret',
            isEnabled: true,
        );

        $this->assertInstanceOf(N8nConnection::class, $connection);
        $this->assertDatabaseHas('n8n_connections', [
            'organization_id' => $org->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/test',
            'is_enabled'      => true,
        ]);
    }

    public function test_save_updates_existing_n8n_connection(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/v1', 'secret-1', true);

        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/v2', 'secret-2', true);

        $this->assertSame(1, N8nConnection::where('organization_id', $org->id)->count());
        $this->assertDatabaseHas('n8n_connections', [
            'organization_id' => $org->id,
            'webhook_url'     => 'https://n8n.example.com/webhook/v2',
        ]);
    }

    public function test_blank_secret_keeps_existing_encrypted_secret(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/test', 'original-secret', true);

        // Update URL but pass blank secret
        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/updated', '', true);

        $connection = N8nConnection::where('organization_id', $org->id)->firstOrFail();
        // The decrypted value must still be the original secret
        $this->assertSame('original-secret', $connection->webhook_secret);
        $this->assertSame('https://n8n.example.com/webhook/updated', $connection->webhook_url);
    }

    public function test_new_secret_replaces_existing_secret(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/test', 'old-secret', true);
        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/test', 'new-secret', true);

        $connection = N8nConnection::where('organization_id', $org->id)->firstOrFail();
        $this->assertSame('new-secret', $connection->webhook_secret);
    }

    public function test_save_clears_stale_last_error(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        N8nConnection::factory()->create([
            'organization_id' => $org->id,
            'connected_by'    => $owner->id,
            'last_error'      => 'Previous connection error',
        ]);

        $this->action->execute($org, $owner, 'https://n8n.example.com/webhook/test', 'secret', true);

        $this->assertDatabaseHas('n8n_connections', [
            'organization_id' => $org->id,
            'last_error'      => null,
        ]);
    }

    public function test_invalid_url_scheme_is_rejected(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->expectException(\InvalidArgumentException::class);

        $this->action->execute($org, $owner, 'ftp://example.com/webhook', 'secret', true);
    }

    public function test_non_url_string_is_rejected(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $this->expectException(\InvalidArgumentException::class);

        $this->action->execute($org, $owner, 'not-a-url-at-all', 'secret', true);
    }

    public function test_http_url_is_accepted(): void
    {
        [$org, $owner] = $this->createOrgWithOwner();

        $connection = $this->action->execute(
            $org, $owner, 'http://internal.example.com/webhook', 'secret', true
        );

        $this->assertDatabaseHas('n8n_connections', [
            'organization_id' => $org->id,
            'webhook_url'     => 'http://internal.example.com/webhook',
        ]);
    }
}
