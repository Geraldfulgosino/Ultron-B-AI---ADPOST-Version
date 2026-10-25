<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Invitations\Actions\AcceptInvitationAction;
use App\Domains\Invitations\Actions\SendInvitationAction;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Invitation\SendInvitationRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class InvitationController extends Controller
{
    public function store(
        SendInvitationRequest $request,
        OrganizationContextService $context,
        SendInvitationAction $action,
    ): RedirectResponse {
        $organization = $context->current();
        $this->authorize('inviteMembers', $organization);

        $validated = $request->validated();
        $action->execute(
            $organization,
            $request->user(),
            $validated['email'],
            MemberRole::from($validated['role']),
            isset($validated['client_id']) ? (int) $validated['client_id'] : null,
        );

        return back()->with('success', 'Invitation sent.');
    }

    public function show(Request $request, string $token): Response|RedirectResponse
    {
        $invitation = OrganizationInvitation::where('token', $token)->firstOrFail();

        if (! $invitation->isPending()) {
            return redirect()->route('login')->with('status', 'This invitation has expired or has already been used.');
        }

        return Inertia::render('invitations/Accept', [
            'invitation' => [
                'token' => $invitation->token,
                'organization_name' => $invitation->organization->name,
                'role_label' => $invitation->role->label(),
                'email' => $invitation->email,
                'expires_at' => $invitation->expires_at->toDateString(),
            ],
        ]);
    }

    public function accept(
        Request $request,
        string $token,
        AcceptInvitationAction $action,
    ): RedirectResponse {
        $invitation = OrganizationInvitation::where('token', $token)->firstOrFail();
        $action->execute($invitation, $request->user());

        return redirect()
            ->route('dashboard', ['organization' => $invitation->organization->slug])
            ->with('success', "Welcome to {$invitation->organization->name}!");
    }

    public function destroy(Request $request, OrganizationContextService $context): RedirectResponse
    {
        $organization = $context->current();
        $this->authorize('inviteMembers', $organization);

        $invitation = OrganizationInvitation::where('organization_id', $organization->id)
            ->findOrFail($request->route('invitation'));

        $invitation->update(['status' => 'declined']);

        return back()->with('success', 'Invitation cancelled.');
    }
}
