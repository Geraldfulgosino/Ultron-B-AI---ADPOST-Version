<?php

declare(strict_types=1);

namespace App\Domains\Clients\Actions;

use App\Domains\Clients\Models\Client;

class DeleteClientAction
{
    public function execute(Client $client): void
    {
        $client->delete();
    }
}
