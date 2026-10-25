<?php

declare(strict_types=1);

namespace App\Domains\Clients\Actions;

use App\Domains\Clients\Models\Website;

class UpdateWebsiteAction
{
    /**
     * @param  array{name?: string, domain?: string, client_id?: int, platform?: string|null, status?: string, timezone?: string, currency?: string, primary_conversion?: string|null}  $data
     */
    public function execute(Website $website, array $data): Website
    {
        $website->update($data);

        return $website->refresh();
    }
}
