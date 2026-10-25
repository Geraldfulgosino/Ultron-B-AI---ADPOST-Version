<?php

declare(strict_types=1);

namespace Tests\Unit\Automation;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use PHPUnit\Framework\TestCase;

class N8nDeliveryStatusTest extends TestCase
{
    public function test_pending_is_not_terminal(): void
    {
        $this->assertFalse(N8nDeliveryStatus::Pending->isTerminal());
    }

    public function test_sent_is_terminal(): void
    {
        $this->assertTrue(N8nDeliveryStatus::Sent->isTerminal());
    }

    public function test_failed_is_terminal(): void
    {
        $this->assertTrue(N8nDeliveryStatus::Failed->isTerminal());
    }

    public function test_enum_values_match_database_strings(): void
    {
        $this->assertSame('pending', N8nDeliveryStatus::Pending->value);
        $this->assertSame('sent', N8nDeliveryStatus::Sent->value);
        $this->assertSame('failed', N8nDeliveryStatus::Failed->value);
    }
}
