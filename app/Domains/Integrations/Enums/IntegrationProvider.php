<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Enums;

enum IntegrationProvider: string
{
    case GoogleAnalytics = 'google_analytics';
    case GoogleSearchConsole = 'google_search_console';

    public function label(): string
    {
        return match ($this) {
            self::GoogleAnalytics => 'Google Analytics',
            self::GoogleSearchConsole => 'Google Search Console',
        };
    }

    public function oauthProvider(): string
    {
        return 'google';
    }
}
