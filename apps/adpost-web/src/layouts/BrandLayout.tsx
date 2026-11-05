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

/** Redirects to /login (preserving the target) when signed out. */
export function RequireAuth() {
    const { session } = useBackend();
    const location = useLocation();
    if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return <Outlet />;
}

/** Nav items the user's capabilities allow. UX only: the data layer enforces access. */
export function visibleNav(access: BrandAccess): NavGroup[] {
    return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || access.can[i.requires]) })).filter((g) => g.items.length > 0);
}

/** Page-level gate for direct URL access. The data layer still enforces the real rule. */
export function RequireCapability({ cap, children }: { cap: Capability; children: React.ReactNode }) {
    const access = useBrand();
    return access.can[cap] ? <>{children}</> : <ForbiddenPage />;
}

export function BrandLayout() {
    const { brandSlug = '', agencySlug = '' } = useParams();
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const brand = useQuery((api) => api.workspace.brandBySlug(brandSlug, agencySlug), [brandSlug, agencySlug]);
    const brands = useQuery((api) => api.workspace.listBrands(), []);

    if (brand.error instanceof AccessDeniedError) return <ForbiddenPage />;
    if (brand.error) return <div className="p-8"><ErrorState error={brand.error} onRetry={brand.reload} /></div>;
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
                <Suspense fallback={<LoadingState />}>
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
