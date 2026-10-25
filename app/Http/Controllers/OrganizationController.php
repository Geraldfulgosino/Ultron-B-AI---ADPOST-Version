<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Organizations\Actions\CreateOrganizationAction;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Organization\CreateOrganizationRequest;
use App\Http\Requests\Organization\UpdateOrganizationRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class OrganizationController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('organizations/Create');
    }

    public function store(CreateOrganizationRequest $request, CreateOrganizationAction $action): RedirectResponse
    {
        $organization = $action->execute(
            $request->user(),
            $request->validated('name'),
            $request->validated('timezone', 'UTC'),
            $request->validated('currency', 'USD'),
        );

        return redirect()->route('dashboard', ['organization' => $organization->slug])
            ->with('success', 'Organization created successfully.');
    }

    public function settings(Request $request, OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $this->authorize('update', $organization);

        return Inertia::render('organizations/Settings', [
            'organization' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'slug' => $organization->slug,
                'timezone' => $organization->timezone,
                'currency' => $organization->currency,
            ],
        ]);
    }

    public function update(UpdateOrganizationRequest $request, OrganizationContextService $context): RedirectResponse
    {
        $organization = $context->current();
        $this->authorize('update', $organization);

        $organization->update($request->validated());

        return back()->with('success', 'Organization updated.');
    }

    public function members(Request $request, OrganizationContextService $context): Response
    {
        $organization = $context->current();
        $this->authorize('viewMembers', $organization);

        $members = $organization->members()
            ->with('user', 'department')
            ->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'user_id' => $m->user_id,
                'name' => $m->user->name,
                'email' => $m->user->email,
                'role' => $m->role->value,
                'role_label' => $m->role->label(),
                'department' => $m->department?->name,
                'joined_at' => $m->created_at->toDateString(),
            ]);

        $invitations = $organization->invitations()
            ->where('status', 'pending')
            ->whereDate('expires_at', '>', now())
            ->with('invitedBy')
            ->get()
            ->map(fn ($i) => [
                'id' => $i->id,
                'email' => $i->email,
                'role' => $i->role->value,
                'role_label' => $i->role->label(),
                'invited_by' => $i->invitedBy->name,
                'expires_at' => $i->expires_at->toDateString(),
            ]);

        return Inertia::render('organizations/Members', [
            'members' => $members,
            'invitations' => $invitations,
            'roles' => MemberRole::assignable(),
            'canManage' => $context->memberCan('organization.manage_users'),
        ]);
    }
}
