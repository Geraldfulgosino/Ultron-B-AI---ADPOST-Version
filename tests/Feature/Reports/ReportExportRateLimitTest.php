<?php

declare(strict_types=1);

namespace Tests\Feature\Reports;

use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class ReportExportRateLimitTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Flush all rate-limiter hits so tests are isolated from each other.
        Cache::flush();

        // Override production limits with 1 req/min so each test needs only 2 requests
        // to verify throttling, rather than 20 (CSV) or 10 (PDF).
        RateLimiter::for('report-csv-export', fn (Request $request): Limit =>
            Limit::perMinute(1)->by($request->user()?->id ?: $request->ip())
        );
        RateLimiter::for('report-pdf-export', fn (Request $request): Limit =>
            Limit::perMinute(1)->by($request->user()?->id ?: $request->ip())
        );
    }

    // ── CSV export ─────────────────────────────────────────────────────────────

    public function test_csv_export_succeeds_before_rate_limit(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('reports.export', [
                'organization' => $org->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
            ]))
            ->assertOk()
            ->assertDownload();
    }

    public function test_csv_export_is_rate_limited_after_limit_exhausted(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $url = route('reports.export', [
            'organization' => $org->slug,
            'date_from'    => '2026-06-01',
            'date_to'      => '2026-06-30',
        ]);

        $this->actingAs($user)->get($url)->assertOk();
        $this->actingAs($user)->get($url)->assertTooManyRequests();
    }

    // ── PDF export ─────────────────────────────────────────────────────────────

    public function test_pdf_export_succeeds_before_rate_limit(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('reports.export.pdf', [
                'organization' => $org->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
            ]))
            ->assertOk()
            ->assertDownload()
            ->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_pdf_export_is_rate_limited_after_limit_exhausted(): void
    {
        [$org, $user] = $this->createOrgWithOwner();

        $url = route('reports.export.pdf', [
            'organization' => $org->slug,
            'date_from'    => '2026-06-01',
            'date_to'      => '2026-06-30',
        ]);

        $this->actingAs($user)->get($url)->assertOk();
        $this->actingAs($user)->get($url)->assertTooManyRequests();
    }

    // ── Client scoping still enforced after rate limiting added ────────────────

    public function test_csv_client_scoping_still_enforced_after_rate_limit_added(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $myClient    = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.export', [
                'organization' => $org->slug,
                'website_id'   => $otherWebsite->id,
            ]))
            ->assertSessionHasErrors('website_id');
    }

    public function test_pdf_client_scoping_still_enforced_after_rate_limit_added(): void
    {
        [$org, $admin] = $this->createOrgWithUser('admin');
        $myClient    = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->id]);
        Website::factory()->create(['organization_id' => $org->id, 'client_id' => $myClient->id, 'created_by' => $admin->id]);
        $otherWebsite = Website::factory()->create(['organization_id' => $org->id, 'client_id' => $otherClient->id, 'created_by' => $admin->id]);

        [$clientUser] = $this->createClientUser($org, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.export.pdf', [
                'organization' => $org->slug,
                'website_id'   => $otherWebsite->id,
            ]))
            ->assertSessionHasErrors('website_id');
    }
}
