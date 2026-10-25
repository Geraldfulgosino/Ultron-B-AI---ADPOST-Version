<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Enums;

enum IntegrationStatus: string
{
    case Pending = 'pending';
    case Connected = 'connected';
    case Disconnected = 'disconnected';
    case Error = 'error';
    case TokenExpired = 'token_expired';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Pending',
            self::Connected => 'Connected',
            self::Disconnected => 'Disconnected',
            self::Error => 'Error',
            self::TokenExpired => 'Token Expired',
        };
    }

    public function isHealthy(): bool
    {
        return $this === self::Connected;
    }
}
