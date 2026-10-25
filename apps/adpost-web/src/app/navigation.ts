import type { LucideIcon } from 'lucide-react';
import {
    LayoutDashboard,
    Building2,
    Globe,
    Users,
    Plug,
    LineChart,
    Lightbulb,
    FileBarChart,
    Bot,
    MessageSquare,
    UsersRound,
    Activity,
    KanbanSquare,
    ShieldCheck,
    BookOpen,
    Workflow,
    Settings,
    Palette,
    Radar,
} from 'lucide-react';

/** Minimum capability needed to see a nav item. Mirrors access.ts capabilities. */
export type NavCapability = 'read' | 'write' | 'admin' | 'staff';

export interface NavItem {
    label: string;
    path: string; // relative to /b/:brandSlug
    icon: LucideIcon;
    /** `staff` = any non-client role. Clients only see items without this flag. */
    requires?: NavCapability;
}

export interface NavGroup {
    label: string;
    items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
    {
        label: 'Overview',
        items: [{ label: 'Dashboard', path: 'dashboard', icon: LayoutDashboard }],
    },
    {
        label: 'Management',
        items: [
            { label: 'Clients', path: 'clients', icon: Building2 },
            { label: 'Websites', path: 'websites', icon: Globe },
            { label: 'Integrations', path: 'integrations', icon: Plug },
            { label: 'Members', path: 'members', icon: Users, requires: 'admin' },
        ],
    },
    {
        label: 'SEO',
        items: [
            { label: 'SEO Overview', path: 'seo', icon: LineChart },
            { label: 'SEO Insights', path: 'seo/insights', icon: Lightbulb },
            { label: 'SEO Intelligence', path: 'seo/intelligence', icon: Radar },
            { label: 'Reports', path: 'reports', icon: FileBarChart },
        ],
    },
    {
        label: 'AI Workforce',
        items: [
            { label: 'Agents', path: 'agents', icon: Bot, requires: 'staff' },
            { label: 'Agent Chat', path: 'chat', icon: MessageSquare, requires: 'staff' },
            { label: 'Team Chat', path: 'team', icon: UsersRound, requires: 'staff' },
            { label: 'Executions', path: 'executions', icon: Activity, requires: 'staff' },
        ],
    },
    {
        label: 'Work',
        items: [
            { label: 'Projects & Tasks', path: 'projects', icon: KanbanSquare, requires: 'staff' },
            { label: 'Approvals', path: 'approvals', icon: ShieldCheck, requires: 'staff' },
            { label: 'Web Studio', path: 'studio', icon: Palette, requires: 'staff' },
        ],
    },
    {
        label: 'Brand',
        items: [
            { label: 'Knowledge', path: 'knowledge', icon: BookOpen, requires: 'staff' },
            { label: 'Automation', path: 'automation', icon: Workflow, requires: 'admin' },
            { label: 'Settings', path: 'settings', icon: Settings, requires: 'admin' },
        ],
    },
];

/**
 * Longest-prefix match, ported from legacy AppLayout: /seo/insights must not
 * highlight both "SEO Overview" and "SEO Insights".
 */
export function activeNavPath(relativePath: string, items: NavItem[]): string | null {
    const clean = relativePath.replace(/^\/+|\/+$/g, '');
    return (
        items
            .filter((i) => clean === i.path || clean.startsWith(i.path + '/'))
            .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null
    );
}
