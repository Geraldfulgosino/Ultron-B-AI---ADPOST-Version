/**
 * Super Admin platform administration (/platform). Directory-level totals and administration;
 * every number is a count of stored records (demo records labelled), never live analytics.
 */
import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { LogOut, Shield } from 'lucide-react';
import { useBackend, useQuery } from '@/app/backend';
import { Alert, Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState, StatCard, Table, TBody, Td, Th, THead } from '@/components/ui';
import { ForbiddenPage } from '@/pages/StatusPages';
import { ThemeToggle } from '@/theme/ThemeToggle';
import { UsersManager } from '@/pages/users/UsersManager';
import { AgencyDirectory } from '@/pages/agencies/AgencyPages';
import { cn, formatDateTime, formatNumber } from '@/lib/utils';

const TABS = [
    { to: '/platform', label: 'Overview', end: true },
    { to: '/platform/agencies', label: 'Agencies', end: false },
    { to: '/platform/users', label: 'Users', end: false },
    { to: '/platform/audit', label: 'Audit log', end: false },
];

export function PlatformLayout() {
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const isSuper = useQuery((api) => api.agencies.isPlatformAdmin(), []);
    if (isSuper.loading) return <LoadingState />;
    if (!isSuper.data) return <ForbiddenPage />;
    return (
        <div className="min-h-screen bg-canvas">
            <header className="border-b border-line bg-surface">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600"><Shield className="h-4 w-4 text-white" aria-hidden="true" /></span>
                        <div>
                            <p className="text-sm font-bold text-fg">ULTRON-B AI · Platform</p>
                            <p className="text-xs text-fg-muted">Super Admin · {session?.user.email}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link to="/me" className="text-sm text-fg-soft hover:text-fg">My profile</Link>
                        <ThemeToggle />
                        <button type="button" className="flex items-center gap-1 text-sm text-fg-soft hover:text-fg" onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}>
                            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                        </button>
                    </div>
                </div>
                <nav aria-label="Platform" className="mx-auto flex max-w-6xl gap-1 px-4">
                    {TABS.map((t) => (
                        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn('rounded-t-md px-3 py-2 text-sm font-medium', isActive ? 'border-b-2 border-indigo-600 text-fg' : 'text-fg-muted hover:text-fg')}>{t.label}</NavLink>
                    ))}
                </nav>
            </header>
            <main id="main" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 px-4 py-6 focus:outline-none">
                <Suspense fallback={<LoadingState />}><Outlet /></Suspense>
            </main>
        </div>
    );
}

export function PlatformOverviewPage() {
    const o = useQuery((api) => api.agencies.platformOverview(), []);
    const audit = useQuery((api) => api.users.audit(), []);
    return (
        <>
            <h1 className="text-lg font-semibold text-fg">Platform overview</h1>
            {o.loading ? <LoadingState /> : o.error ? <ErrorState error={o.error} /> : o.data && (
                <section aria-label="Platform metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Agencies" value={formatNumber(o.data.agencies)} hint={o.data.suspendedAgencies ? `${o.data.suspendedAgencies} suspended` : undefined} />
                    <StatCard label="Managed clients" value={formatNumber(o.data.clients)} />
                    <StatCard label="Websites" value={formatNumber(o.data.websites)} hint={o.data.demoWebsites ? `${o.data.demoWebsites} demo records (not live websites)` : undefined} />
                    <StatCard label="Active users" value={formatNumber(o.data.activeUsers)} hint={o.data.suspendedUsers ? `${o.data.suspendedUsers} suspended` : undefined} />
                    <StatCard label="Pending invitations" value={formatNumber(o.data.pendingInvitations)} />
                    <StatCard label="Enabled AI agents" value={formatNumber(o.data.enabledAgents)} />
                    <StatCard label="AI requests (month)" value={formatNumber(o.data.aiRequestsThisMonth)} hint="Simulated in local mode" />
                    <StatCard label="Integrations" value={o.data.integrations.connected ? `${o.data.integrations.connected} connected` : 'None connected'} hint={o.data.integrations.error ? `${o.data.integrations.error} with errors` : undefined} />
                </section>
            )}
            <Alert tone="info">Super Admin access is platform-wide but audited, and it never opens other users’ private conversations or reveals AI provider credentials.</Alert>
            <Card>
                <CardHeader className="flex items-center justify-between"><CardTitle>Recent administrative actions</CardTitle><Link className="text-sm text-accent hover:text-accent-strong" to="/platform/audit">Full audit log</Link></CardHeader>
                <CardContent>
                    {audit.data?.length ? (
                        <ul className="divide-y divide-line text-sm">{audit.data.slice(0, 6).map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{e.actorName} · <code>{e.action}</code>{e.targetName ? ` · ${e.targetName}` : ''}{e.agencyName ? ` · ${e.agencyName}` : ''}</span><span className="text-xs text-fg-muted">{formatDateTime(e.createdAt)}</span></li>)}</ul>
                    ) : <p className="text-sm text-fg-muted">No administrative actions yet.</p>}
                </CardContent>
            </Card>
        </>
    );
}

export function PlatformAgenciesPage() {
    return <AgencyDirectory />;
}

export function PlatformUsersPage() {
    return (
        <>
            <h1 className="text-lg font-semibold text-fg">Users</h1>
            <p className="text-sm text-fg-muted">Every user on the platform. Open an agency’s Users page to invite client users or agency admins for that agency.</p>
            <UsersManager agencyId={null} />
        </>
    );
}

export function PlatformAuditPage() {
    const audit = useQuery((api) => api.users.audit(), []);
    return (
        <>
            <h1 className="text-lg font-semibold text-fg">Audit log</h1>
            {audit.loading ? <LoadingState /> : audit.error ? <ErrorState error={audit.error} /> : (
                <Card>
                    <Table aria-label="Platform audit log">
                        <THead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Target</Th><Th>Agency</Th></tr></THead>
                        <TBody>
                            {audit.data!.map((e) => <tr key={e.id}><Td className="text-xs">{formatDateTime(e.createdAt)}</Td><Td>{e.actorName}</Td><Td><code className="text-xs">{e.action}</code></Td><Td>{e.targetName ?? e.targetType}</Td><Td>{e.agencyName ?? '—'}</Td></tr>)}
                            {!audit.data!.length && <tr><Td>No events yet.</Td></tr>}
                        </TBody>
                    </Table>
                </Card>
            )}
        </>
    );
}
