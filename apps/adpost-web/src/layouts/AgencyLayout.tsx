import { createContext, Suspense, useContext } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { LogOut, Zap } from 'lucide-react';
import { useBackend, useQuery } from '@/app/backend';
import { agencyBase } from '@/app/paths';
import type { AgencyView } from '@/data/contracts';
import { AccessDeniedError } from '@/data/errors';
import { ErrorState, LoadingState } from '@/components/ui';
import { ForbiddenPage } from '@/pages/StatusPages';
import { ThemeToggle } from '@/theme/ThemeToggle';
import { cn } from '@/lib/utils';

const AgencyContext = createContext<{ agency: AgencyView; reload: () => void } | null>(null);

export function useAgency() {
    const ctx = useContext(AgencyContext);
    if (!ctx) throw new Error('useAgency must be used inside an agency route');
    return ctx;
}

/** Agency workspace: overview, clients and settings. Authorization is enforced by the data layer. */
export function AgencyLayout() {
    const { agencySlug = '' } = useParams();
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const agency = useQuery((api) => api.agencies.bySlug(agencySlug), [agencySlug]);
    const agencies = useQuery((api) => api.agencies.list({ status: 'all' }), []);

    if (agency.error instanceof AccessDeniedError) return <ForbiddenPage />;
    if (agency.error) return <div className="p-8"><ErrorState error={agency.error} onRetry={agency.reload} /></div>;
    if (agency.loading || !agency.data) return <LoadingState />;
    const a = agency.data;
    const base = agencyBase(a.slug);
    const tabs = [
        { to: base, label: 'Overview', end: true },
        { to: `${base}/clients`, label: 'Clients', end: false },
        { to: `${base}/settings`, label: 'Settings', end: false },
    ];
    const switchable = (agencies.data ?? []).filter((x) => x.counts || x.access.canChangeStatus);

    return (
        <AgencyContext.Provider value={{ agency: a, reload: agency.reload }}>
            <div className="min-h-screen bg-canvas">
                <header className="border-b border-line bg-surface">
                    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <Link to="/agencies" className="flex items-center gap-2 text-sm font-bold text-fg">
                                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600"><Zap className="h-4 w-4 text-white" aria-hidden="true" /></span>
                                ULTRON-B AI
                            </Link>
                            <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
                                <Link to="/agencies" className="hover:text-fg">Agencies</Link> <span aria-hidden="true">/</span> <span className="text-fg">{a.name}</span>
                            </nav>
                        </div>
                        <div className="flex items-center gap-3">
                            {switchable.length > 1 && (
                                <label className="flex items-center gap-2 text-xs text-fg-muted">
                                    Agency
                                    <select aria-label="Agency" className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-fg" value={a.slug} onChange={(e) => navigate(agencyBase(e.target.value))}>
                                        {switchable.map((x) => <option key={x.id} value={x.slug}>{x.name}</option>)}
                                    </select>
                                </label>
                            )}
                            <ThemeToggle />
                            <button type="button" className="flex items-center gap-1 text-sm text-fg-soft hover:text-fg" onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}>
                                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                            </button>
                        </div>
                    </div>
                    <nav aria-label="Agency" className="mx-auto flex max-w-6xl gap-1 px-4">
                        {tabs.map((t) => (
                            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn('rounded-t-md px-3 py-2 text-sm font-medium', isActive ? 'border-b-2 border-indigo-600 text-fg' : 'text-fg-muted hover:text-fg')}>
                                {t.label}
                            </NavLink>
                        ))}
                    </nav>
                </header>
                <main id="main" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 px-4 py-6 focus:outline-none">
                    <p className="sr-only">Signed in as {session?.user.email}</p>
                    <Suspense fallback={<LoadingState />}>
                        <Outlet />
                    </Suspense>
                </main>
            </div>
        </AgencyContext.Provider>
    );
}
