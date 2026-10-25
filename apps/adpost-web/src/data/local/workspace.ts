import type { Brand, ID } from '@/domain/types';
import type { BrandAccess, BrandInput, WorkspaceApi } from '../contracts';
import { assignableRoles, can, clientRestriction, effectiveRole, ROLE_LABELS, type AccessFacts } from '../access';
import { AccessDeniedError, assertValid } from '../errors';
import { newId, slugify } from '@/lib/utils';
import type { Scope } from './scope';

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

    const agencyFor = (): ID => {
        const m = db.all('agencyMemberships').find((a) => a.userId === scope.userId);
        if (!m) throw new AccessDeniedError('Only agency staff can create brands.');
        return m.agencyId;
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

        async brandBySlug(slug) {
            const found = accessible().find((b) => b.brand.slug === slug);
            if (!found) throw new AccessDeniedError();
            return found;
        },

        async createBrand(input: BrandInput) {
            const agencyId = agencyFor();
            const name = input.name?.trim() ?? '';
            const slug = slugify(name);
            assertValid({
                name: !name && 'Brand name is required.',
                slug: name && db.all('brands').some((b) => b.slug === slug) && 'A brand with this name already exists.',
                color: input.color && !HEX.test(input.color) && 'Color must be a hex value like #4f46e5.',
            });
            const brand: Brand = {
                id: newId('brd'),
                agencyId,
                name,
                slug,
                status: 'active',
                description: input.description?.trim() ?? '',
                timezone: input.timezone ?? 'UTC',
                currency: input.currency ?? 'USD',
                color: input.color ?? '#4f46e5',
                createdAt: db.nowIso(),
            };
            db.insert('brands', brand);
            scope.audit(brand.id, 'brand.created', 'brand', brand.id);
            return structuredClone(brand);
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
