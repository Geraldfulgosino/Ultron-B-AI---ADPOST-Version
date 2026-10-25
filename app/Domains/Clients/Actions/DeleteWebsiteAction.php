<?php

declare(strict_types=1);

namespace App\Domains\Clients\Actions;

use App\Domains\Clients\Models\Website;

class DeleteWebsiteAction
{
    public function execute(Website $website): void
    {
        $website->delete();
    }
}
