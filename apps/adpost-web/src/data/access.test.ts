import { can, clientRestriction, effectiveRole, assignableRoles, type AccessFacts } from './access';
import type { BrandRole } from '@/domain/types';

const brand = { id: 'b1', agencyId: 'a1', name: 'B', slug: 'b', status: 'active', description: '', timezone: 'UTC', currency: 'USD', color: '#000000', createdAt: '' } as const;

function facts(role: BrandRole | null, opts: { agency?: string; clientId?: string | null } = {}): AccessFacts {
    return {
        brand,
        membership: role ? { id: 'm', brandId: 'b1', userId: 'u', role, clientId: opts.clientId ?? null, department: null, joinedAt: '' } : null,
        agencyMembership: opts.agency ? { id: 'am', agencyId: opts.agency, userId: 'u', role: 'agency_admin' } : null,
    };
}

describe('access rules (mirror of RLS helpers)', () => {
    it.each([
        ['owner', true, true, true],
        ['admin', true, true, true],
        ['manager', true, true, false],
        ['member', true, true, false],
        ['viewer', true, false, false],
        ['client', true, false, false],
    ] as const)('%s: read=%s write=%s admin=%s', (role, read, write, admin) => {
        const f = facts(role);
        expect(can(f, 'read')).toBe(read);
        expect(can(f, 'write')).toBe(write);
        expect(can(f, 'admin')).toBe(admin);
    });

    it('denies everything without membership', () => {
        const f = facts(null);
        expect(effectiveRole(f)).toBeNull();
        expect(can(f, 'read')).toBe(false);
    });

    it('agency staff act as admins only within their own agency', () => {
        expect(can(facts(null, { agency: 'a1' }), 'admin')).toBe(true);
        expect(can(facts(null, { agency: 'other' }), 'read')).toBe(false);
    });

    it('client role is not staff and is restricted to its client', () => {
        expect(can(facts('client', { clientId: 'c1' }), 'staff')).toBe(false);
        expect(clientRestriction(facts('client', { clientId: 'c1' }))).toBe('c1');
        expect(clientRestriction(facts('client'))).toBe('none');
        expect(clientRestriction(facts('member'))).toBeNull();
    });

    it('admins cannot grant owner; managers cannot grant anything', () => {
        expect(assignableRoles(facts('admin'))).not.toContain('owner');
        expect(assignableRoles(facts('owner'))).toContain('owner');
        expect(assignableRoles(facts('manager'))).toEqual([]);
    });
});
