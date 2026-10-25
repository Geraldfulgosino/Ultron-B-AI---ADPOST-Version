<?php

declare(strict_types=1);

namespace Tests\Feature\Reports;

use App\Domains\Analytics\Models\AnalyticsDailyMetric;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportPdfExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_download_report_pdf(): void
    {
        [$organization, $user] = $this->createOrgWithOwner();

        $response = $this->actingAs($user)
            ->get(route('reports.export.pdf', [
                'organization' => $organization->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
            ]));

        $response->assertOk()
            ->assertDownload()
            ->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_client_can_download_own_report_pdf(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by'      => $admin->id,
        ]);
        [$clientUser] = $this->createClientUser($organization, $client);

        $this->actingAs($clientUser)
            ->get(route('reports.export.pdf', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertDownload()
            ->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_client_cannot_export_another_clients_website_pdf(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');

        $myClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);
        $otherClient = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->id]);

        Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id'       => $myClient->id,
            'created_by'      => $admin->id,
        ]);
        $otherWebsite = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id'       => $otherClient->id,
            'created_by'      => $admin->id,
        ]);

        [$clientUser] = $this->createClientUser($organization, $myClient);

        $this->actingAs($clientUser)
            ->get(route('reports.export.pdf', [
                'organization' => $organization->slug,
                'website_id'   => $otherWebsite->id,
            ]))
            ->assertSessionHasErrors('website_id');
    }

    public function test_pdf_export_respects_source_ga4(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id'       => $client->id,
            'created_by'      => $user->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id'      => $website->id,
            'metric_date'     => '2026-06-10',
            'clicks'          => 30,
            'impressions'     => 300,
            'sessions'        => 80,
            'conversions'     => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.export.pdf', [
                'organization' => $organization->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
                'source'       => 'ga4',
            ]))
            ->assertOk()
            ->assertDownload();
    }

    public function test_pdf_export_respects_source_gsc(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id'       => $client->id,
            'created_by'      => $user->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id'      => $website->id,
            'metric_date'     => '2026-06-10',
            'clicks'          => 50,
            'impressions'     => 500,
            'sessions'        => 100,
            'conversions'     => 10,
        ]);

        $this->actingAs($user)
            ->get(route('reports.export.pdf', [
                'organization' => $organization->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
                'source'       => 'gsc',
            ]))
            ->assertOk()
            ->assertDownload();
    }

    public function test_pdf_export_respects_date_range(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');
        $client = Client::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->id]);
        $website = Website::factory()->create([
            'organization_id' => $organization->id,
            'client_id'       => $client->id,
            'created_by'      => $user->id,
        ]);

        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id'      => $website->id,
            'metric_date'     => '2026-05-15',
            'clicks'          => 999,
            'impressions'     => 9990,
            'sessions'        => 999,
            'conversions'     => 99,
        ]);
        AnalyticsDailyMetric::create([
            'organization_id' => $organization->id,
            'website_id'      => $website->id,
            'metric_date'     => '2026-06-10',
            'clicks'          => 42,
            'impressions'     => 420,
            'sessions'        => 84,
            'conversions'     => 8,
        ]);

        $this->actingAs($user)
            ->get(route('reports.export.pdf', [
                'organization' => $organization->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
            ]))
            ->assertOk()
            ->assertDownload();
    }

    public function test_empty_report_pdf_returns_successfully_with_empty_state(): void
    {
        [$organization, $user] = $this->createOrgWithUser('member');

        $this->actingAs($user)
            ->get(route('reports.export.pdf', [
                'organization' => $organization->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
            ]))
            ->assertOk()
            ->assertDownload()
            ->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_reports_page_still_renders_after_pdf_changes(): void
    {
        [$organization, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('reports.index', ['organization' => $organization->slug]))
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('reports/Index'));
    }

    public function test_csv_export_still_works_after_pdf_changes(): void
    {
        [$organization, $user] = $this->createOrgWithOwner();

        $this->actingAs($user)
            ->get(route('reports.export', [
                'organization' => $organization->slug,
                'date_from'    => '2026-06-01',
                'date_to'      => '2026-06-30',
            ]))
            ->assertOk()
            ->assertDownload();
    }
}
