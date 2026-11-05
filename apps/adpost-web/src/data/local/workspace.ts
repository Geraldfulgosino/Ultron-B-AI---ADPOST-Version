import type { Brand } from '@/domain/types';
import type { BrandAccess, BrandInput, WorkspaceApi } from '../contracts';
import { assignableRoles, can, clientRestriction, effectiveRole, isAgencyAdminRole, ROLE_LABELS, type AccessFacts } from '../access';
import { createClientRecord } from './agencies';
import { AccessDeniedError, assertValid } from '../errors';
import type { Scope } from './scope';
import { agencyUsage } from './entitlements';

export function toBrandAccess(f: AccessFacts): BrandAccess {
    const role = effectiveRole(f)!;
    const restriction = clientRestriction(f);
    return {
        brand: structuredClone(f.brand),
        role,
        roleLabel: ROLE_LABELS[role],
        can: { read: can(f, 'read'), write: can(f, 'write'), admin: can(f, 'admin'), staff: can(f, 'staff') },
        clientId: restriction === null || restriction === 'none' ? null : restriction,
        assignableRoles: assignableRoles(f),
    };
}

const HEX = /^#[0-9a-f]{6}$/i;

export function localWorkspace(scope: Scope): WorkspaceApi {
    const { db } = scope;

    const accessible = (): BrandAccess[] => {
        const out: BrandAccess[] = [];
        for (const brand of db.all('brands')) {
            try {
                out.push(toBrandAccess(scope.facts(brand.id)));
            } catch {
                // not accessible: skip
            }
        }
        return out.sort((a, b) => a.brand.name.localeCompare(b.brand.name));
    };

    return {
        me() {
            const user = db.find('users', scope.userId);
            if (!user) throw new AccessDeniedError();
            return structuredClone(user);
        },

        async listBrands() {
            return accessible();
        },

        async brandBySlug(slug, agencySlug) {
            const matches = accessible().filter((b) => b.brand.slug === slug && (!agencySlug || b.brand.agencySlug === agencySlug));
            if (matches.length !== 1) throw new AccessDeniedError();
            return matches[0]!;
        },

        async agencyUsage() {
            const m = db.all('agencyMemberships').find((a) => a.userId === scope.userId && isAgencyAdminRole(a.role));
            if (!m) throw new AccessDeniedError('Only agency staff (owners and admins) can view plan usage.');
            return agencyUsage(db, m.agencyId);
        },

        async canCreateBrands() {
            return db.all('agencyMemberships').some((a) => a.userId === scope.userId && isAgencyAdminRole(a.role));
        },

        async createBrand(input: BrandInput) {
            // Clients are added to the caller's agency (owners/admins only); same path as AgenciesApi.createClient.
            const m = db.all('agencyMemberships').find((x) => x.userId === scope.userId && isAgencyAdminRole(x.role));
            if (!m) throw new AccessDeniedError('Only agency administrators can create clients.');
            assertValid({ color: input.color && !HEX.test(input.color) && 'Color must be a hex value like #4f46e5.' });
            const brand = createClientRecord(scope, m.agencyId, { name: input.name, description: input.description });
            const patch: Partial<Brand> = {};
            if (input.timezone) patch.timezone = input.timezone;
            if (input.currency) patch.currency = input.currency;
            if (input.color) patch.color = input.color;
            return structuredClone(Object.keys(patch).length ? db.patch('brands', brand.id, patch) : brand);
        },

        async updateBrand(brandId, input) {
            scope.require(brandId, 'admin');
            const patch: Partial<Brand> = {};
            if (input.name !== undefined) {
                const name = input.name.trim();
                assertValid({ name: !name && 'Brand name is required.' });
                patch.name = name; // slug is stable once created
            }
            if (input.description !== undefined) patch.description = input.description.trim();
            if (input.timezone !== undefined) patch.timezone = input.timezone;
            if (input.currency !== undefined) patch.currency = input.currency;
            if (input.color !== undefined) {
                assertValid({ color: !HEX.test(input.color) && 'Color must be a hex value like #4f46e5.' });
                patch.color = input.color;
            }
            if (input.status !== undefined) patch.status = input.status;
            const updated = db.patch('brands', brandId, patch);
            scope.audit(brandId, 'brand.updated', 'brand', brandId);
            return structuredClone(updated);
        },
    };
}
