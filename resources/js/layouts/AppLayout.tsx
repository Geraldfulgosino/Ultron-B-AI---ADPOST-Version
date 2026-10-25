import React from 'react';
import { Link, usePage } from '@inertiajs/react';
import type { User, Organization } from '@/types/models';

interface SharedProps {
    auth: {
        user: User;
    };
    currentOrganization?: Organization & { role: string };
    userOrganizations?: Array<{ id: number; name: string; slug: string; role: string }>;
    flash?: {
        success?: string;
        error?: string;
    };
}

interface AppLayoutProps {
    children: React.ReactNode;
    title?: string;
}

// Safe wrapper — Ziggy throws if a route isn't registered yet (e.g. during incremental feature builds).
function safeRoute(name: string, params: Record<string, string | number>): string {
    try {
        return route(name, params);
    } catch {
        return '#';
    }
}

export default function AppLayout({ children, title }: AppLayoutProps) {
    const page = usePage();
    const { auth, currentOrganization, flash } =
        page.props as unknown as SharedProps;
    const currentUrl = page.url;

    const urlSlug = currentUrl.split('/').filter(Boolean)[0] ?? '';
    const isOrgUrl = urlSlug !== '' && urlSlug !== 'organizations' && urlSlug !== 'invitations' && urlSlug !== 'health';
    const slug = currentOrganization?.slug ?? (isOrgUrl ? urlSlug : '');

    const isClientRole = currentOrganization?.role === 'client';

    const navItems = slug
        ? [
            { label: 'Dashboard',    href: safeRoute('dashboard',             { organization: slug }), clientVisible: true  },
            { label: 'Clients',      href: safeRoute('clients.index',         { organization: slug }), clientVisible: true  },
            { label: 'Websites',     href: safeRoute('websites.index',        { organization: slug }), clientVisible: true  },
            { label: 'Integrations', href: safeRoute('integrations.index',    { organization: slug }), clientVisible: true  },
            { label: 'SEO',          href: safeRoute('seo.index',             { organization: slug }), clientVisible: true  },
            { label: 'SEO Insights', href: safeRoute('seo.insights.index',    { organization: slug }), clientVisible: true  },
            { label: 'Reports',      href: safeRoute('reports.index',         { organization: slug }), clientVisible: true  },
            { label: 'Members',      href: safeRoute('organization.members',  { organization: slug }), clientVisible: false },
            { label: 'Settings',     href: safeRoute('organization.settings', { organization: slug }), clientVisible: false },
          ].filter((item) => !isClientRole || item.clientVisible)
        : [];

    // Most-specific match: among all nav items whose href is a prefix of the
    // current URL, pick the longest one. Prevents /{slug}/seo from matching
    // both "SEO" and "SEO Insights" when visiting /{slug}/seo/insights.
    const activeHref =
        navItems
            .filter(
                (item) =>
                    item.href !== '#' &&
                    (currentUrl === item.href || currentUrl.startsWith(item.href + '/')),
            )
            .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-slate-900 text-white flex flex-col">
                {/* Logo */}
                <div className="px-6 py-5 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <span className="font-bold text-sm">ULTRON-B AI</span>
                    </div>
                </div>

                {/* Org header */}
                {currentOrganization && (
                    <div className="px-4 py-3 border-b border-slate-800">
                        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Organization</p>
                        <p className="text-sm font-medium text-white truncate">{currentOrganization.name}</p>
                        <p className="text-xs text-slate-400 capitalize">{currentOrganization.role}</p>
                    </div>
                )}

                {/* Navigation */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = item.href === activeHref;
                        return (
                            <Link
                                key={item.label}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    isActive
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                                }`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                {/* User footer */}
                <div className="px-4 py-4 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{auth?.user?.name}</p>
                            <p className="text-xs text-slate-400 truncate">{auth?.user?.email}</p>
                        </div>
                        <Link
                            href={route('logout')}
                            method="post"
                            as="button"
                            className="ml-2 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                            Sign out
                        </Link>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="bg-white border-b border-gray-200 px-8 py-4">
                    <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
                </header>

                {flash?.success && (
                    <div className="mx-8 mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                        {flash.success}
                    </div>
                )}
                {flash?.error && (
                    <div className="mx-8 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                        {flash.error}
                    </div>
                )}

                <main className="flex-1 p-8">{children}</main>
            </div>
        </div>
    );
}
