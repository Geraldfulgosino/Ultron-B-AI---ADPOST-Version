import React, { Suspense } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { BrandProvider, useBackend, useBrand, useQuery } from '@/app/backend';
import type { Capability } from '@/data/access';
import { NAV_GROUPS, type NavGroup } from '@/app/navigation';
import type { BrandAccess } from '@/data/contracts';
import { AccessDeniedError } from '@/data/errors';
import { AppShell } from './AppShell';
import { ErrorState, LoadingState } from '@/components/ui';
import { ForbiddenPage } from '@/pages/StatusPages';
import { clientBase } from '@/app/paths';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { loginPath } from '@/app/redirects';

/**
 * Redirects to /login (preserving the target) when signed out. The session is restored before
 * the app mounts, so this never redirects a user whose session is still valid; when the session
 * ends later (expiry, another tab, suspension) the login page says so.
 */
export function RequireAuth() {
    const { session } = useBackend();
    const location = useLocation();
    if (!session) return <Navigate to={loginPath(location)} replace />;
    return <Outlet />;
}

/** Nav items the user's capabilities allow. UX only: the data layer enforces access. */
export function visibleNav(access: BrandAccess): NavGroup[] {
    const clientUser = access.role === 'client';
    const show = (i: NavGroup['items'][number]) =>
        !i.requires || access.can[i.requires] || (clientUser && (i.client === true || (i.client === 'ai_chat' && access.clientPermissions.includes('ai_chat'))));
    return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(show) })).filter((g) => g.items.length > 0);
}

/** Staff, or a Client User with the given permission (or any Client User for `true`). UX gate only. */
export function RequireStaffOrClient({ client, children }: { client: true | 'ai_chat'; children: React.ReactNode }) {
    const access = useBrand();
    const ok = access.can.staff || (access.role === 'client' && (client === true || access.clientPermissions.includes(client)));
    return ok ? <>{children}</> : <ForbiddenPage embedded />;
}

/** Page-level gate for direct URL access. The data layer still enforces the real rule. */
export function RequireCapability({ cap, children }: { cap: Capability; children: React.ReactNode }) {
    const access = useBrand();
    return access.can[cap] ? <>{children}</> : <ForbiddenPage embedded />;
}

export function BrandLayout() {
    const { brandSlug = '', agencySlug = '' } = useParams();
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const brand = useQuery((api) => api.workspace.brandBySlug(brandSlug, agencySlug), [brandSlug, agencySlug]);
    const brands = useQuery((api) => api.workspace.listBrands(), []);

    if (brand.error instanceof AccessDeniedError) return <ForbiddenPage />;
    if (brand.error) return <main id="main" className="p-8"><ErrorState error={brand.error} onRetry={brand.reload} /></main>;
    if (brand.loading || !brand.data) return <LoadingState />;

    const access = brand.data;
    return (
        <BrandProvider value={access}>
            <AppShell
                brand={access.brand}
                roleLabel={access.roleLabel}
                brands={(brands.data ?? [access]).map((b) => b.brand)}
                navGroups={visibleNav(access)}
                user={session!.user}
                onSignOut={async () => {
                    await signOut();
                    navigate('/login', { replace: true });
                }}
                onSwitchBrand={(slug) => navigate(`${clientBase({ agencySlug: access.brand.agencySlug, slug })}/dashboard`)}
                selector={<WorkspaceSelector />}
            >
                {/* Keyed by client: switching clients remounts the page, so no filter or metric state carries over. */}
                <Suspense key={access.brand.id} fallback={<LoadingState />}>
                    <Outlet />
                </Suspense>
            </AppShell>
        </BrandProvider>
    );
}

/** Legacy /b/:slug/* links: redirect to the canonical /a/:agency/c/:slug/* when the slug is unambiguous. */
export function LegacyBrandRedirect() {
    const { brandSlug = '', '*': rest = '' } = useParams();
    const location = useLocation();
    const brand = useQuery((api) => api.workspace.brandBySlug(brandSlug), [brandSlug]);
    if (brand.error) return <ForbiddenPage />;
    if (brand.loading || !brand.data) return <LoadingState />;
    return <Navigate to={`${clientBase(brand.data.brand)}/${rest}${location.search}`} replace />;
}
