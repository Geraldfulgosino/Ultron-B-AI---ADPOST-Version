<?php

declare(strict_types=1);

namespace Tests\Unit\Automation;

use App\Domains\Organizations\Enums\MemberRole;
use PHPUnit\Framework\TestCase;

class MemberRoleAutomationPermissionsTest extends TestCase
{
    // ── automation.configure ───────────────────────────────────────────────

    public function test_owner_can_configure_automation(): void
    {
        $this->assertTrue(MemberRole::Owner->can('automation.configure'));
    }

    public function test_admin_can_configure_automation(): void
    {
        $this->assertTrue(MemberRole::Admin->can('automation.configure'));
    }

    public function test_member_cannot_configure_automation(): void
    {
        $this->assertFalse(MemberRole::Member->can('automation.configure'));
    }

    public function test_viewer_cannot_configure_automation(): void
    {
        $this->assertFalse(MemberRole::Viewer->can('automation.configure'));
    }

    public function test_client_cannot_configure_automation(): void
    {
        $this->assertFalse(MemberRole::Client->can('automation.configure'));
    }

    // ── automation.view ────────────────────────────────────────────────────

    public function test_owner_can_view_automation(): void
    {
        $this->assertTrue(MemberRole::Owner->can('automation.view'));
    }

    public function test_admin_can_view_automation(): void
    {
        $this->assertTrue(MemberRole::Admin->can('automation.view'));
    }

    public function test_member_can_view_automation(): void
    {
        $this->assertTrue(MemberRole::Member->can('automation.view'));
    }

    public function test_viewer_can_view_automation(): void
    {
        $this->assertTrue(MemberRole::Viewer->can('automation.view'));
    }

    public function test_client_cannot_view_automation(): void
    {
        $this->assertFalse(MemberRole::Client->can('automation.view'));
    }
}
