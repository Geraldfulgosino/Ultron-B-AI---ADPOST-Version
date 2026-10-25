<?php

declare(strict_types=1);

namespace App\Domains\Invitations\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Invitations\Enums\InvitationStatus;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcceptInvitationAction
{
    public function execute(OrganizationInvitation $invitation, User $user): OrganizationMember
    {
        if (! $invitation->isPending()) {
            throw ValidationException::withMessages([
                'token' => ['This invitation has expired or has already been used.'],
            ]);
        }

        if (strtolower($user->email) !== strtolower($invitation->email)) {
            throw ValidationException::withMessages([
                'token' => ['This invitation was sent to a different email address.'],
            ]);
        }

        return DB::transaction(function () use ($invitation, $user): OrganizationMember {
            $member = OrganizationMember::firstOrCreate(
                [
                    'organization_id' => $invitation->organization_id,
                    'user_id' => $user->id,
                ],
                [
                    'role' => $invitation->role,
                    'client_id' => $invitation->client_id,
                ]
            );

            $invitation->update([
                'status' => InvitationStatus::Accepted,
                'accepted_at' => now(),
            ]);

            return $member;
        });
    }
}
