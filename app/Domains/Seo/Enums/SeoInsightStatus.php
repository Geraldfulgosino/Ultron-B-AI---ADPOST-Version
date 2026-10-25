<?php

declare(strict_types=1);

namespace App\Domains\Seo\Enums;

enum SeoInsightStatus: string
{
    case Pending = 'pending';
    case Reviewed = 'reviewed';
    case Approved = 'approved';
    case Dismissed = 'dismissed';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Pending',
            self::Reviewed => 'Reviewed',
            self::Approved => 'Approved',
            self::Dismissed => 'Dismissed',
        };
    }
}
