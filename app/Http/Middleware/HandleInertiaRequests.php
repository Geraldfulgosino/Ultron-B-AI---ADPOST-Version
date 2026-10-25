<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /** @return array<string, mixed> */
    public function share(Request $request): array
    {
        $context = app(OrganizationContextService::class);

        return [
            ...parent::share($request),
            'auth' => [
                'user' => $request->user() ? [
                    'id' => $request->user()->id,
                    'name' => $request->user()->name,
                    'email' => $request->user()->email,
                    'email_verified_at' => $request->user()->email_verified_at,
                    'mfa_enabled' => $request->user()->mfa_enabled,
                ] : null,
            ],
            // Evaluated lazily at Inertia::render() time so that SetActiveOrganization
            // middleware has already run and populated the org context.
            'currentOrganization' => function () use ($context): ?array {
                $org = $context->current();
                $member = $context->currentMember();

                return $org ? [
                    'id' => $org->id,
                    'name' => $org->name,
                    'slug' => $org->slug,
                    'timezone' => $org->timezone,
                    'currency' => $org->currency,
                    'role' => $member?->role->value,
                ] : null;
            },
            'userOrganizations' => fn (): array => $request->user()
                ? $context->userOrganizations($request->user())
                : [],
            'flash' => [
                'success' => $request->session()->get('success'),
                'error' => $request->session()->get('error'),
            ],
        ];
    }
}
