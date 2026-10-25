<?php

declare(strict_types=1);

namespace App\Domains\Organizations\Enums;

enum MemberRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Member = 'member';
    case Viewer = 'viewer';
    case Client = 'client';

    public function label(): string
    {
        return match ($this) {
            self::Owner  => 'Owner',
            self::Admin  => 'Admin',
            self::Member => 'Member',
            self::Viewer => 'Viewer',
            self::Client => 'Client',
        };
    }

    public function can(string $permission): bool
    {
        return match ($this) {
            self::Owner  => true,
            self::Admin  => in_array($permission, self::adminPermissions(), strict: true),
            self::Member => in_array($permission, self::memberPermissions(), strict: true),
            self::Viewer => in_array($permission, self::viewerPermissions(), strict: true),
            self::Client => in_array($permission, self::clientPermissions(), strict: true),
        };
    }

    /** @return list<string> */
    private static function adminPermissions(): array
    {
        return [
            ...self::memberPermissions(),
            'organization.update',
            'organization.manage_users',
            'member.invite',
            'member.remove',
            'member.change_role',
            'department.manage',
            'client.manage',
            'website.manage',
            'integration.connect',
            'integration.disconnect',
            'analytics.sync',
            'seo.insights.generate',
            'approval.decide',
            'report.export',
            'automation.configure',
        ];
    }

    /** @return list<string> */
    private static function memberPermissions(): array
    {
        return [
            ...self::viewerPermissions(),
            'client.create',
            'website.create',
            'integration.view',
            'agent.run',
            'report.create',
            'automation.view',
        ];
    }

    /** @return list<string> */
    private static function viewerPermissions(): array
    {
        return [
            'organization.view',
            'client.view',
            'website.view',
            'report.view',
            'automation.view',
        ];
    }

    /** @return list<string> */
    private static function clientPermissions(): array
    {
        return [
            'client.view',
            'website.view',
            'report.view',
            'integration.view',
        ];
    }

    /** @return list<array{value: string, label: string}> */
    public static function assignable(): array
    {
        return array_map(
            fn (self $role) => ['value' => $role->value, 'label' => $role->label()],
            [self::Admin, self::Member, self::Viewer, self::Client]
        );
    }
}
