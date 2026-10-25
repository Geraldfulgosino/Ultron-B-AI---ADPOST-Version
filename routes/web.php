<?php

declare(strict_types=1);

use App\Http\Controllers\ClientController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\InvitationController;
use App\Http\Controllers\N8nConnectionController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\ReportExportController;
use App\Http\Controllers\ReportPdfExportController;
use App\Http\Controllers\ReportsController;
use App\Http\Controllers\SeoDashboardController;
use App\Http\Controllers\SeoInsightController;
use App\Http\Controllers\WebsiteController;
use App\Http\Middleware\SetActiveOrganization;
use Illuminate\Support\Facades\Route;

require __DIR__.'/auth.php';

Route::get('/', fn () => redirect()->route('login'))->name('home');

Route::get('/health', fn () => response()->json(['status' => 'ok']))->name('health');

// Organization creation (auth required, no org context yet)
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/organizations/create', [OrganizationController::class, 'create'])
        ->name('organizations.create');
    Route::post('/organizations', [OrganizationController::class, 'store'])
        ->name('organizations.store');
});

// Invitation accept (no org context, but auth required)
Route::middleware('auth')->group(function () {
    Route::get('/invitations/{token}', [InvitationController::class, 'show'])
        ->name('invitations.show');
    Route::post('/invitations/{token}/accept', [InvitationController::class, 'accept'])
        ->name('invitations.accept');
});

// Organization-scoped routes
Route::middleware(['auth', 'verified', SetActiveOrganization::class])
    ->prefix('/{organization}')
    ->group(function () {
        Route::get('/dashboard', DashboardController::class)->name('dashboard');

        // Organization management
        Route::get('/settings', [OrganizationController::class, 'settings'])->name('organization.settings');
        Route::patch('/settings', [OrganizationController::class, 'update'])->name('organization.update');
        Route::get('/members', [OrganizationController::class, 'members'])->name('organization.members');

        // Invitations
        Route::post('/invitations', [InvitationController::class, 'store'])->name('invitations.store');
        Route::delete('/invitations/{invitation}', [InvitationController::class, 'destroy'])->name('invitations.destroy');

        // Clients and websites
        Route::get('/clients', [ClientController::class, 'index'])->name('clients.index');
        Route::post('/clients', [ClientController::class, 'store'])->name('clients.store');
        Route::patch('/clients/{client}', [ClientController::class, 'update'])->name('clients.update');
        Route::delete('/clients/{client}', [ClientController::class, 'destroy'])->name('clients.destroy');

        Route::get('/websites', [WebsiteController::class, 'index'])->name('websites.index');
        Route::post('/websites', [WebsiteController::class, 'store'])->name('websites.store');
        Route::patch('/websites/{website}', [WebsiteController::class, 'update'])->name('websites.update');
        Route::delete('/websites/{website}', [WebsiteController::class, 'destroy'])->name('websites.destroy');

        // Integrations
        Route::get('/integrations', [IntegrationController::class, 'index'])->name('integrations.index');
        Route::post('/integrations/google', [IntegrationController::class, 'connect'])->name('integrations.google.connect');
        Route::get('/integrations/google/callback', [IntegrationController::class, 'googleCallback'])->name('integrations.google.callback');
        Route::post('/integrations/{integration}/sync', [IntegrationController::class, 'sync'])->name('integrations.sync');
        Route::delete('/integrations/{integration}/inactive-record', [IntegrationController::class, 'destroyInactiveRecord'])->name('integrations.inactive.destroy');
        Route::delete('/integrations/{integration}', [IntegrationController::class, 'destroy'])->name('integrations.destroy');

        // Reports
        Route::get('/reports', ReportsController::class)->name('reports.index');
        Route::get('/reports/export', ReportExportController::class)->name('reports.export')->middleware('throttle:report-csv-export');
        Route::get('/reports/export/pdf', ReportPdfExportController::class)->name('reports.export.pdf')->middleware('throttle:report-pdf-export');

        // n8n automation bridge
        Route::post('/automations/n8n', [N8nConnectionController::class, 'store'])->name('automations.n8n.store');
        Route::post('/automations/n8n/test', [N8nConnectionController::class, 'testConnection'])->name('automations.n8n.test');
        Route::delete('/automations/n8n/deliveries', [N8nConnectionController::class, 'clearDeliveries'])->name('automations.n8n.deliveries.clear');
        Route::delete('/automations/n8n', [N8nConnectionController::class, 'destroy'])->name('automations.n8n.destroy');

        // SEO scaffold
        Route::get('/seo', SeoDashboardController::class)->name('seo.index');
        Route::post('/seo/insights/generate', [SeoInsightController::class, 'generate'])->name('seo.insights.generate');

        // SEO insight list and detail
        Route::get('/seo/insights', [SeoInsightController::class, 'index'])->name('seo.insights.index');
        // Bulk routes BEFORE {insight} wildcard to prevent literal string collision
        Route::post('/seo/insights/bulk-reviewed', [SeoInsightController::class, 'bulkReviewed'])->name('seo.insights.bulk-reviewed');
        Route::post('/seo/insights/bulk-dismissed', [SeoInsightController::class, 'bulkDismissed'])->name('seo.insights.bulk-dismissed');
        // Individual insight routes
        Route::get('/seo/insights/{insight}', [SeoInsightController::class, 'show'])->name('seo.insights.show');
        Route::post('/seo/insights/{insight}/reviewed', [SeoInsightController::class, 'markReviewed'])->name('seo.insights.reviewed');
        Route::post('/seo/insights/{insight}/approved', [SeoInsightController::class, 'markApproved'])->name('seo.insights.approved');
        Route::post('/seo/insights/{insight}/dismissed', [SeoInsightController::class, 'markDismissed'])->name('seo.insights.dismissed');
        Route::post('/seo/insights/{insight}/reopened', [SeoInsightController::class, 'reopen'])->name('seo.insights.reopened');
    });
