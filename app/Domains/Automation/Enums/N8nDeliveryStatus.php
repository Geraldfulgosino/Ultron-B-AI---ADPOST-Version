<?php

declare(strict_types=1);

namespace App\Domains\Automation\Enums;

enum N8nDeliveryStatus: string
{
    case Pending = 'pending';
    case Sent    = 'sent';
    case Failed  = 'failed';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Pending',
            self::Sent    => 'Sent',
            self::Failed  => 'Failed',
        };
    }

    public function isTerminal(): bool
    {
        return $this !== self::Pending;
    }
}
