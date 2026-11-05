/**
 * Authorization rules. These mirror the Supabase RLS helper functions in
 * supabase/migrations/0002_rls.sql (app.can_read_brand, app.can_write_brand,
 * app.can_admin_brand). Change both together.
 */
import type { AgencyMembership, Brand, BrandMembership, BrandRole, ID } from '@/domain/types';

export type Capability = 'read' | 'write' | 'admin' | 'staff';

export interface AccessFacts {
    brand: Brand;
    membership: BrandMembership | null;
    agencyMembership: AgencyMembership | null;
}

export type EffectiveRole = BrandRole | 'agency' | 'agency_manager';

/**
 * Effective role. Agency owners/admins act as owners on every client of their agency;
 * agency managers read and write every client but do not administer (migration 0008).
 */
export function effectiveRole(f: AccessFacts): EffectiveRole | null {
    if (f.agencyMembership && f.agencyMembership.agencyId === f.brand.agencyId) {
        return f.agencyMembership.role === 'agency_manager' ? 'agency_manager' : 'agency';
    }
    return f.membership?.role ?? null;
}

/** Agency owners/admins (not managers): mirrors app.is_agency_admin_for_agency. */
export const isAgencyAdminRole = (role: AgencyMembership['role'] | undefined | null) => role === 'agency_owner' || role === 'agency_admin';

const WRITE_ROLES: ReadonlyArray<EffectiveRole> = ['agency', 'agency_manager', 'owner', 'admin', 'manager', 'member'];
const ADMIN_ROLES: ReadonlyArray<EffectiveRole> = ['agency', 'owner', 'admin'];

export function can(f: AccessFacts, capability: Capability): boolean {
    const role = effectiveRole(f);
    if (role === null) return false;
    switch (capability) {
        case 'read':
            return true;
        case 'staff':
            return role !== 'client';
        case 'write':
            return WRITE_ROLES.includes(role);
        case 'admin':
            return ADMIN_ROLES.includes(role);
    }
}

/** For `client` users, the only client whose rows they may see. null = unrestricted. */
export function clientRestriction(f: AccessFacts): ID | null | 'none' {
    const role = effectiveRole(f);
    if (role !== 'client') return null;
    return f.membership?.clientId ?? 'none';
}

export const ROLE_LABELS: Record<EffectiveRole, string> = {
    agency: 'Agency admin',
    agency_manager: 'Agency manager',
    owner: 'Owner',
    admin: 'Admin',
    manager: 'Manager',
    member: 'Member',
    viewer: 'Viewer',
    client: 'Client',
};

/** Roles a given actor may grant. Admins cannot mint owners; only owners/agency can. */
export function assignableRoles(f: AccessFacts): BrandRole[] {
    const role = effectiveRole(f);
    if (role === 'agency' || role === 'owner') return ['owner', 'admin', 'manager', 'member', 'viewer', 'client'];
    if (role === 'admin') return ['admin', 'manager', 'member', 'viewer', 'client'];
    return [];
}
