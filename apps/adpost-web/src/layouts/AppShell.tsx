import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Menu, X, Zap, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { activeNavPath, type NavGroup } from '@/app/navigation';

export interface ShellBrand {
    slug: string;
    name: string;
}

interface AppShellProps {
    brand: ShellBrand;
    roleLabel: string;
    brands: ShellBrand[];
    navGroups: NavGroup[];
    user: { name: string; email: string };
    onSignOut: () => void;
    onSwitchBrand: (slug: string) => void;
    children: React.ReactNode;
}

export function AppShell({ brand, roleLabel, brands, navGroups, user, onSignOut, onSwitchBrand, children }: AppShellProps) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();
    const base = `/b/${brand.slug}`;
    const relative = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : '';
    const active = activeNavPath(relative, navGroups.flatMap((g) => g.items));

    const sidebar = (
        <div className="flex h-full flex-col bg-slate-900 text-white">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                        <Zap className="w-5 h-5 text-white" aria-hidden="true" />
                    </div>
                    <span className="font-bold text-sm">ULTRON-B AI</span>
                </div>
                <button type="button" className="lg:hidden text-slate-400 hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                    <X className="h-5 w-5" />
                </button>
            </div>

            <div className="px-4 py-3 border-b border-slate-800">
                <label htmlFor="brand-switcher" className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">
                    Brand
                </label>
                {brands.length > 1 ? (
                    <select
                        id="brand-switcher"
                        value={brand.slug}
                        onChange={(e) => onSwitchBrand(e.target.value)}
                        className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        {brands.map((b) => (
                            <option key={b.slug} value={b.slug}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                ) : (
                    <p id="brand-switcher" className="text-sm font-medium text-white truncate">
                        {brand.name}
                    </p>
                )}
                <p className="mt-1 text-xs text-slate-400">{roleLabel}</p>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Main">
                {navGroups.map((group) => (
                    <div key={group.label}>
                        <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.label}</p>
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const isActive = item.path === active;
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.path}
                                        to={`${base}/${item.path}`}
                                        onClick={() => setMobileOpen(false)}
                                        aria-current={isActive ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                                            isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800',
                                        )}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            <div className="px-4 py-4 border-t border-slate-800">
                <div className="flex items-center justify-between">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{user.name}</p>
                        <p className="text-xs text-slate-400 truncate">{user.email}</p>
                    </div>
                    <button type="button" onClick={onSignOut} className="ml-2 text-slate-400 hover:text-white transition-colors" aria-label="Sign out">
                        <LogOut className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50 lg:flex">
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-700 focus:shadow">
                Skip to content
            </a>
            <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen">{sidebar}</aside>

            {mobileOpen && (
                <div className="fixed inset-0 z-40 lg:hidden">
                    <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
                    <aside className="relative h-full w-64">{sidebar}</aside>
                </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col">
                <div className="lg:hidden flex items-center gap-3 bg-white border-b border-gray-200 px-4 py-3">
                    <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="text-gray-600">
                        <Menu className="h-5 w-5" />
                    </button>
                    <span className="text-sm font-semibold text-gray-900 truncate">{brand.name}</span>
                </div>
                {children}
            </div>
        </div>
    );
}

/** Page header + padded main region used by every brand page. */
export function Page({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <>
            <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
                    {description && <p className="text-sm text-gray-500">{description}</p>}
                </div>
                {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            </header>
            <main id="main" tabIndex={-1} className="flex-1 p-4 sm:p-8 space-y-6 focus:outline-none">{children}</main>
        </>
    );
}
