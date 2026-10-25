<?php

declare(strict_types=1);

namespace App\Domains\Invitations\Notifications;

use App\Domains\Invitations\Models\OrganizationInvitation;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class InvitationNotification extends Notification
{
    public function __construct(private readonly OrganizationInvitation $invitation) {}

    /** @return list<string> */
    public function via(mixed $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(mixed $notifiable): MailMessage
    {
        $acceptUrl = route('invitations.accept', ['token' => $this->invitation->token]);

        return (new MailMessage)
            ->subject("You've been invited to join {$this->invitation->organization->name} on ULTRON-B AI")
            ->greeting('Hello!')
            ->line("You've been invited to join **{$this->invitation->organization->name}** as a **{$this->invitation->role->label()}**.")
            ->action('Accept Invitation', $acceptUrl)
            ->line('This invitation expires in 7 days.')
            ->line('If you did not expect this invitation, no action is required.');
    }
}
