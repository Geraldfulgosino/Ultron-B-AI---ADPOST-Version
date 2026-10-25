<?php

declare(strict_types=1);

namespace App\Domains\Integrations\Contracts;

use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Models\Organization;

interface IntegrationProvider
{
    /** @param array<string, mixed> $authorization */
    public function connect(Organization $organization, array $authorization): Integration;

    public function test(Integration $integration): bool;

    public function refresh(Integration $integration): Integration;

    public function disconnect(Integration $integration): void;
}
