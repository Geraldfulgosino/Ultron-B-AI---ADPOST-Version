<?php

declare(strict_types=1);

namespace App\Domains\Invitations\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Invitations\Notifications\InvitationNotification;
use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Models\Organization;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;

class SendInvitationAction
{
    public function execute(
        Organization $organization,
        User $invitedBy,
        string $email,
        MemberRole $role,
        ?int $clientId = null,
    ): OrganizationInvitation {
        if ($organization->members()->whereHas('user', fn ($q) => $q->where('email', $email))->exists()) {
            throw ValidationException::withMessages([
                'email' => ['This user is already a member of the organization.'],
            ]);
        }

        $existing = OrganizationInvitation::where('organization_id', $organization->id)
            ->where('email', $email)
            ->where('status', 'pending')
            ->whereDate('expires_at', '>', now())
            ->first();

        if ($existing) {
            throw ValidationException::withMessages([
                'email' => ['An active invitation has already been sent to this address.'],
            ]);
        }

        $invitation = OrganizationInvitation::create([
            'organization_id' => $organization->id,
            'invited_by' => $invitedBy->id,
            'email' => $email,
            'role' => $role,
            'client_id' => $clientId,
        ]);

        Notification::route('mail', $email)->notify(new InvitationNotification($invitation));

        return $invitation;
    }
}
