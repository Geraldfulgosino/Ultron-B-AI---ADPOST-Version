<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Clients\Actions\CreateWebsiteAction;
use App\Domains\Clients\Actions\DeleteWebsiteAction;
use App\Domains\Clients\Actions\UpdateWebsiteAction;
use App\Domains\Clients\Models\Client;
use App\Domains\Clients\Models\Website;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Website\StoreWebsiteRequest;
use App\Http\Requests\Website\UpdateWebsiteRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class WebsiteController extends Controller
{
    public function index(OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();
        $scopedClientId = $context->currentClientId();

        return Inertia::render('websites/Index', [
            'websites' => Website::query()
                ->where('organization_id', $organization->id)
                ->when($allowedWebsiteIds !== null, fn ($q) => $q->whereIn('id', $allowedWebsiteIds))
                ->with('client')
                ->latest()
                ->get()
                ->map(fn (Website $website) => [
                    'id' => $website->id,
                    'client_id' => $website->client_id,
                    'client_name' => $website->client->name,
                    'name' => $website->name,
                    'domain' => $website->domain,
                    'platform' => $website->platform,
                    'status' => $website->status->value,
                    'status_label' => $website->status->label(),
                    'timezone' => $website->timezone,
                    'currency' => $website->currency,
                    'primary_conversion' => $website->primary_conversion,
                    'ga4_property_id' => $website->ga4_property_id,
                    'gsc_site_url' => $website->gsc_site_url,
                ]),
            'clients' => $organization->clients()
                ->where('status', 'active')
                ->when($scopedClientId !== null, fn ($q) => $q->where('id', $scopedClientId))
                ->orderBy('name')
                ->get()
                ->map(fn (Client $client) => [
                    'id' => $client->id,
                    'name' => $client->name,
                    'timezone' => $client->timezone,
                    'currency' => $client->currency,
                ]),
            'canCreate' => $context->memberCan('website.create'),
            'canManage' => $context->memberCan('website.manage'),
            'defaults' => [
                'timezone' => $organization->timezone,
                'currency' => $organization->currency,
            ],
        ]);
    }

    public function store(StoreWebsiteRequest $request, OrganizationContextService $context, CreateWebsiteAction $action): RedirectResponse
    {
        $action->execute($context->current(), $request->user(), $request->validated());

        return back()->with('success', 'Website created.');
    }

    public function update(UpdateWebsiteRequest $request, string $organization, Website $website, UpdateWebsiteAction $action): RedirectResponse
    {
        $this->authorize('update', $website);

        $action->execute($website, $request->validated());

        return back()->with('success', 'Website updated.');
    }

    public function destroy(string $organization, Website $website, DeleteWebsiteAction $action): RedirectResponse
    {
        $this->authorize('delete', $website);

        $action->execute($website);

        return back()->with('success', 'Website archived.');
    }
}
