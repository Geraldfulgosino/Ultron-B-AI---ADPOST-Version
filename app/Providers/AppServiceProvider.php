<?php

declare(strict_types=1);

namespace App\Providers;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Policies\N8nConnectionPolicy;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Clients\Policies\ClientPolicy;
use App\Domains\Clients\Policies\WebsitePolicy;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Integrations\Policies\IntegrationPolicy;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Organizations\Policies\OrganizationPolicy;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Models\SeoInsight;
use App\Domains\Seo\Policies\SeoInsightPolicy;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(OrganizationContextService::class);
    }

    public function boot(): void
    {
        // Register policies
        Gate::policy(N8nConnection::class, N8nConnectionPolicy::class);
        Gate::policy(Organization::class, OrganizationPolicy::class);
        Gate::policy(Client::class, ClientPolicy::class);
        Gate::policy(Website::class, WebsitePolicy::class);
        Gate::policy(Integration::class, IntegrationPolicy::class);
        Gate::policy(SeoInsight::class, SeoInsightPolicy::class);

        // Default password rules
        Password::defaults(fn () => Password::min(8)
            ->letters()
            ->mixedCase()
            ->numbers()
        );

        // Report export rate limiters — keyed by authenticated user ID (falls back to IP).
        // Tests may override these in setUp() with a smaller limit for fast throttle assertions.
        RateLimiter::for('report-csv-export', fn (Request $request): Limit =>
            Limit::perMinute(20)->by($request->user()?->id ?: $request->ip())
        );

        RateLimiter::for('report-pdf-export', fn (Request $request): Limit =>
            Limit::perMinute(10)->by($request->user()?->id ?: $request->ip())
        );
    }
}
