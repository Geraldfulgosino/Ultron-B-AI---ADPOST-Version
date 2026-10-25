<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Models\OrganizationMember;
use App\Domains\Seo\Models\SeoInsight;
use Database\Seeders\DemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class DemoSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_seeder_runs_in_local_environment(): void
    {
        $this->assertDatabaseMissing('users', ['email' => 'demo@example.com']);

        app(DemoSeeder::class)->run();

        $this->assertDatabaseHas('users', ['email' => 'demo@example.com']);
    }

    public function test_demo_seeder_creates_expected_record_counts(): void
    {
        $before = [
            'users' => User::count(),
            'orgs' => Organization::count(),
            'members' => OrganizationMember::count(),
            'clients' => Client::count(),
            'websites' => Website::count(),
            'integrations' => Integration::count(),
            'insights' => SeoInsight::count(),
        ];

        app(DemoSeeder::class)->run();

        $this->assertEquals($before['users'] + 4, User::count(), '4 demo users created');
        $this->assertEquals($before['orgs'] + 1, Organization::count(), '1 demo org created');
        $this->assertEquals($before['members'] + 4, OrganizationMember::count(), '4 org members created');
        $this->assertEquals($before['clients'] + 3, Client::count(), '3 clients (including archived) created');
        $this->assertEquals($before['websites'] + 4, Website::count(), '4 websites (including archived) created');
        $this->assertEquals($before['integrations'] + 1, Integration::count(), '1 integration created');
        $this->assertEquals($before['insights'] + 8, SeoInsight::count(), '8 seo insights created');
    }

    public function test_demo_seeder_creates_users_with_all_roles(): void
    {
        app(DemoSeeder::class)->run();

        $org = Organization::where('slug', 'demo-agency')->firstOrFail();

        $this->assertTrue(
            OrganizationMember::where('organization_id', $org->id)->where('role', 'owner')->exists()
        );
        $this->assertTrue(
            OrganizationMember::where('organization_id', $org->id)->where('role', 'admin')->exists()
        );
        $this->assertTrue(
            OrganizationMember::where('organization_id', $org->id)->where('role', 'member')->exists()
        );
        $this->assertTrue(
            OrganizationMember::where('organization_id', $org->id)->where('role', 'viewer')->exists()
        );
    }

    public function test_demo_seeder_seeds_analytics_data(): void
    {
        app(DemoSeeder::class)->run();

        $this->assertDatabaseCount('analytics_daily_metrics', 30);
        $this->assertDatabaseCount('analytics_landing_pages', 5);
        $this->assertDatabaseCount('analytics_search_queries', 5);
        $this->assertDatabaseCount('analytics_sync_histories', 1);
    }

    public function test_demo_seeder_creates_insights_with_mixed_statuses(): void
    {
        app(DemoSeeder::class)->run();

        $org = Organization::where('slug', 'demo-agency')->firstOrFail();
        $insights = SeoInsight::where('organization_id', $org->id)->get();

        $statuses = $insights->pluck('status')->map(fn ($s) => $s->value)->toArray();

        $this->assertContains('pending', $statuses);
        $this->assertContains('reviewed', $statuses);
        $this->assertContains('approved', $statuses);
        $this->assertContains('dismissed', $statuses);
    }

    public function test_demo_seeder_aborts_in_production(): void
    {
        $this->app->detectEnvironment(fn () => 'production');

        $this->expectException(HttpException::class);

        // Call run() directly — using $this->seed() goes through artisan SeedCommand
        // which shows a confirmation prompt in production before calling run().
        app(DemoSeeder::class)->run();
    }

    public function test_all_demo_records_belong_to_the_same_organization(): void
    {
        app(DemoSeeder::class)->run();

        $org = Organization::where('slug', 'demo-agency')->firstOrFail();

        $this->assertEquals(
            $org->id,
            Client::where('name', 'Acme Corp')->firstOrFail()->organization_id
        );
        $this->assertEquals(
            $org->id,
            Website::where('name', 'Acme Main Site')->firstOrFail()->organization_id
        );
        $this->assertEquals(
            $org->id,
            Integration::where('external_account_id', '123456789')->firstOrFail()->organization_id
        );
        $this->assertEquals(
            $org->id,
            SeoInsight::where('title', 'Critical click drop on homepage')->firstOrFail()->organization_id
        );
    }
}
