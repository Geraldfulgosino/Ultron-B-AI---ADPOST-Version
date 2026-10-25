<?php

declare(strict_types=1);

namespace Tests\Feature\Invitations;

use App\Domains\Identity\Models\User;
use App\Domains\Invitations\Models\OrganizationInvitation;
use App\Domains\Organizations\Models\OrganizationMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class InvitationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_invite_user(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->post(route('invitations.store', ['organization' => $org->slug]), [
                'email' => 'newmember@example.com',
                'role' => 'member',
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('organization_invitations', [
            'organization_id' => $org->id,
            'email' => 'newmember@example.com',
            'status' => 'pending',
        ]);
    }

    public function test_viewer_cannot_invite(): void
    {
        [$org, $viewer] = $this->createOrgWithUser('viewer');

        $this->actingAs($viewer)
            ->post(route('invitations.store', ['organization' => $org->slug]), [
                'email' => 'someone@example.com',
                'role' => 'member',
            ])
            ->assertForbidden();
    }

    public function test_cannot_invite_owner_role(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');

        $this->actingAs($admin)
            ->post(route('invitations.store', ['organization' => $org->slug]), [
                'email' => 'hacker@example.com',
                'role' => 'owner',
            ])
            ->assertSessionHasErrors('role');
    }

    public function test_cannot_invite_existing_member(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');
        $existingMember = User::factory()->create(['email' => 'existing@example.com']);
        OrganizationMember::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $existingMember->id,
        ]);

        $this->actingAs($admin)
            ->post(route('invitations.store', ['organization' => $org->slug]), [
                'email' => 'existing@example.com',
                'role' => 'member',
            ])
            ->assertSessionHasErrors('email');
    }

    public function test_invitation_show_page_is_accessible(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');
        $invitation = OrganizationInvitation::factory()->create([
            'organization_id' => $org->id,
            'invited_by' => $admin->id,
            'email' => 'invitee@example.com',
            'status' => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        $user = User::factory()->create(['email' => 'invitee@example.com']);

        $this->actingAs($user)
            ->get(route('invitations.show', ['token' => $invitation->token]))
            ->assertOk();
    }

    public function test_user_can_accept_invitation(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');
        $invitation = OrganizationInvitation::factory()->create([
            'organization_id' => $org->id,
            'invited_by' => $admin->id,
            'email' => 'newmember@example.com',
            'status' => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        $invitee = User::factory()->create(['email' => 'newmember@example.com']);

        $this->actingAs($invitee)
            ->post(route('invitations.accept', ['token' => $invitation->token]))
            ->assertRedirect(route('dashboard', ['organization' => $org->slug]));

        $this->assertDatabaseHas('organization_members', [
            'organization_id' => $org->id,
            'user_id' => $invitee->id,
        ]);

        $this->assertDatabaseHas('organization_invitations', [
            'id' => $invitation->id,
            'status' => 'accepted',
        ]);
    }

    public function test_user_cannot_accept_invitation_with_wrong_email(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');
        $invitation = OrganizationInvitation::factory()->create([
            'organization_id' => $org->id,
            'invited_by' => $admin->id,
            'email' => 'correct@example.com',
            'status' => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        $wrongUser = User::factory()->create(['email' => 'wrong@example.com']);

        $this->actingAs($wrongUser)
            ->post(route('invitations.accept', ['token' => $invitation->token]))
            ->assertSessionHasErrors('token');
    }

    public function test_admin_can_cancel_invitation(): void
    {
        Notification::fake();
        [$org, $admin] = $this->createOrgWithUser('admin');
        $invitation = OrganizationInvitation::factory()->create([
            'organization_id' => $org->id,
            'invited_by' => $admin->id,
            'email' => 'cancel@example.com',
            'status' => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        $this->actingAs($admin)
            ->delete(route('invitations.destroy', [
                'organization' => $org->slug,
                'invitation' => $invitation->id,
            ]))
            ->assertRedirect();

        $this->assertDatabaseHas('organization_invitations', [
            'id' => $invitation->id,
            'status' => 'declined',
        ]);
    }

    public function test_user_from_other_org_cannot_cancel_invitation(): void
    {
        Notification::fake();
        [$org1, $admin1] = $this->createOrgWithUser('admin');
        [$org2, $admin2] = $this->createOrgWithUser('admin');

        $invitation = OrganizationInvitation::factory()->create([
            'organization_id' => $org1->id,
            'invited_by' => $admin1->id,
            'email' => 'someone@example.com',
            'status' => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        // admin2 from org2 tries to cancel org1's invitation via org2's route.
        // Receives 404 because the invitation doesn't exist in org2's scope (intentionally opaque).
        $this->actingAs($admin2)
            ->delete(route('invitations.destroy', [
                'organization' => $org2->slug,
                'invitation' => $invitation->id,
            ]))
            ->assertNotFound();
    }

    public function test_admin_can_invite_client_user_with_client_id(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = \App\Domains\Clients\Models\Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
        ]);

        $this->actingAs($admin)
            ->post(route('invitations.store', ['organization' => $organization->slug]), [
                'email' => 'portal@example.com',
                'role' => 'client',
                'client_id' => $client->id,
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('organization_invitations', [
            'organization_id' => $organization->id,
            'email' => 'portal@example.com',
            'role' => 'client',
            'client_id' => $client->id,
        ]);
    }

    public function test_accepting_client_invitation_creates_member_with_client_id(): void
    {
        [$organization, $admin] = $this->createOrgWithUser('admin');
        $client = \App\Domains\Clients\Models\Client::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->id,
        ]);
        $invitation = OrganizationInvitation::factory()->create([
            'organization_id' => $organization->id,
            'invited_by' => $admin->id,
            'email' => 'portal@example.com',
            'role' => 'client',
            'client_id' => $client->id,
            'status' => 'pending',
        ]);

        $portalUser = User::factory()->create(['email' => 'portal@example.com']);

        $this->actingAs($portalUser)
            ->post(route('invitations.accept', ['token' => $invitation->token]))
            ->assertRedirect();

        $this->assertDatabaseHas('organization_members', [
            'organization_id' => $organization->id,
            'user_id' => $portalUser->id,
            'role' => 'client',
            'client_id' => $client->id,
        ]);
    }
}
