<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Clients\Actions\CreateClientAction;
use App\Domains\Clients\Actions\DeleteClientAction;
use App\Domains\Clients\Actions\UpdateClientAction;
use App\Domains\Clients\Models\Client;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Client\StoreClientRequest;
use App\Http\Requests\Client\UpdateClientRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class ClientController extends Controller
{
    public function index(OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $scopedClientId = $context->currentClientId();

        return Inertia::render('clients/Index', [
            'clients' => $organization->clients()
                ->when($scopedClientId !== null, fn ($q) => $q->where('id', $scopedClientId))
                ->withCount('websites')
                ->latest()
                ->get()
                ->map(fn (Client $client) => [
                    'id' => $client->id,
                    'name' => $client->name,
                    'slug' => $client->slug,
                    'status' => $client->status,
                    'timezone' => $client->timezone,
                    'currency' => $client->currency,
                    'business_goals' => $client->business_goals,
                    'websites_count' => $client->websites_count,
                ]),
            'canCreate' => $context->memberCan('client.create'),
            'canManage' => $context->memberCan('client.manage'),
            'defaults' => [
                'timezone' => $organization->timezone,
                'currency' => $organization->currency,
            ],
        ]);
    }

    public function store(StoreClientRequest $request, OrganizationContextService $context, CreateClientAction $action): RedirectResponse
    {
        $action->execute($context->current(), $request->user(), $request->validated());

        return back()->with('success', 'Client created.');
    }

    public function update(UpdateClientRequest $request, string $organization, Client $client, UpdateClientAction $action): RedirectResponse
    {
        $this->authorize('update', $client);

        $action->execute($client, $request->validated());

        return back()->with('success', 'Client updated.');
    }

    public function destroy(string $organization, Client $client, DeleteClientAction $action): RedirectResponse
    {
        $this->authorize('delete', $client);

        $action->execute($client);

        return back()->with('success', 'Client archived.');
    }
}
