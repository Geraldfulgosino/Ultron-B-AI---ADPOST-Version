<?php

declare(strict_types=1);

namespace Tests\Feature\ErrorPages;

use App\Domains\Clients\Models\Client;
use App\Domains\Identity\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class FriendlyErrorPagesTest extends TestCase
{
    use RefreshDatabase;

    public function test_403_renders_friendly_inertia_error_page(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $this->actingAs($clientUser)
            ->get(route('organization.members', ['organization' => $org->slug]))
            ->assertStatus(403)
            ->assertInertia(fn ($page) => $page
                ->component('Error')
                ->where('status', 403)
                ->where('message', 'You do not have access to this page.')
            );
    }

    public function test_404_renders_friendly_inertia_error_page(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->get('/this-route-does-not-exist-at-all')
            ->assertStatus(404)
            ->assertInertia(fn ($page) => $page
                ->component('Error')
                ->where('status', 404)
                ->where('message', 'Page not found.')
            );
    }

    public function test_429_renders_friendly_inertia_error_page(): void
    {
        $user = User::factory()->create();

        // Exhaust the throttle:6,1 limit on the verification resend route
        for ($i = 0; $i < 6; $i++) {
            $this->actingAs($user)->post(route('verification.send'));
        }

        $this->actingAs($user)
            ->post(route('verification.send'))
            ->assertStatus(429)
            ->assertInertia(fn ($page) => $page
                ->component('Error')
                ->where('status', 429)
                ->where('message', 'Too many requests.')
            );
    }

    public function test_500_renders_friendly_inertia_error_page(): void
    {
        // 500 friendly page only activates when APP_DEBUG=false (production).
        // Temporarily disable debug so the handler renders the Error component.
        config(['app.debug' => false]);

        Route::get('/_test/abort-500', fn () => abort(500));

        $this->get('/_test/abort-500')
            ->assertStatus(500)
            ->assertInertia(fn ($page) => $page
                ->component('Error')
                ->where('status', 500)
                ->where('message', 'Something went wrong.')
            );
    }

    public function test_client_access_denial_to_members_page_uses_friendly_403(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        [$clientUser] = $this->createClientUser($org, $client);

        $response = $this->actingAs($clientUser)
            ->get(route('organization.members', ['organization' => $org->slug]));

        $response->assertStatus(403);
        $response->assertInertia(fn ($page) => $page->component('Error'));
        // Ensure no member data leaks in the rendered page
        $response->assertDontSee($admin->email);
    }
}
