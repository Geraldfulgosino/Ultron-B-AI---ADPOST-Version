<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Domains\Organizations\Enums\MemberRole;
use PHPUnit\Framework\TestCase;

class MemberRoleClientTest extends TestCase
{
    public function test_client_role_can_view_client(): void
    {
        $this->assertTrue(MemberRole::Client->can('client.view'));
    }

    public function test_client_role_can_view_website(): void
    {
        $this->assertTrue(MemberRole::Client->can('website.view'));
    }

    public function test_client_role_can_view_reports(): void
    {
        $this->assertTrue(MemberRole::Client->can('report.view'));
    }

    public function test_client_role_can_view_integrations(): void
    {
        $this->assertTrue(MemberRole::Client->can('integration.view'));
    }

    public function test_client_role_cannot_create_client(): void
    {
        $this->assertFalse(MemberRole::Client->can('client.create'));
    }

    public function test_client_role_cannot_manage_client(): void
    {
        $this->assertFalse(MemberRole::Client->can('client.manage'));
    }

    public function test_client_role_cannot_generate_insights(): void
    {
        $this->assertFalse(MemberRole::Client->can('seo.insights.generate'));
    }

    public function test_client_role_cannot_decide_approval(): void
    {
        $this->assertFalse(MemberRole::Client->can('approval.decide'));
    }

    public function test_client_role_cannot_connect_integration(): void
    {
        $this->assertFalse(MemberRole::Client->can('integration.connect'));
    }

    public function test_client_role_cannot_manage_organization(): void
    {
        $this->assertFalse(MemberRole::Client->can('organization.update'));
    }

    public function test_client_role_label(): void
    {
        $this->assertSame('Client', MemberRole::Client->label());
    }
}
