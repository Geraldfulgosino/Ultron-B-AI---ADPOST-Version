import type { BrandMembership, BrandRole, ID, Invitation } from '@/domain/types';
import type { InvitationsApi, MemberView, MembersApi } from '../contracts';
import { assignableRoles } from '../access';
import { AccessDeniedError, assertValid, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import type { Scope } from './scope';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_DAYS = 7;

export function localMembers(scope: Scope): MembersApi {
    const { db } = scope;

    const view = (m: BrandMembership): MemberView => {
        const user = db.find('users', m.userId);
        const client = m.clientId ? db.find('clients', m.clientId) : undefined;
        return { ...structuredClone(m), name: user?.name ?? 'Unknown', email: user?.email ?? '', clientName: client?.name ?? null };
    };

    const ownerCount = (brandId: ID) => db.all('brandMemberships').filter((m) => m.brandId === brandId && m.role === 'owner').length;

    /** Admins may not touch owners; only owners/agency may. */
    const guardTarget = (brandId: ID, target: BrandMembership, newRole?: BrandRole) => {
        const f = scope.require(brandId, 'admin');
        const allowed = assignableRoles(f);
        if (target.role === 'owner' && !allowed.includes('owner')) throw new AccessDeniedError('Only owners can change another owner.');
        if (newRole && !allowed.includes(newRole)) throw new AccessDeniedError(`You cannot assign the ${newRole} role.`);
        return f;
    };

    return {
        async list(brandId) {
            scope.require(brandId, 'staff');
            return db
                .all('brandMemberships')
                .filter((m) => m.brandId === brandId)
                .map(view)
                .sort((a, b) => a.name.localeCompare(b.name));
        },

        async updateRole(brandId, membershipId, role, clientId = null) {
            const target = scope.owned('brandMemberships', brandId, membershipId, 'Member');
            guardTarget(brandId, target, role);
            if (target.role === 'owner' && role !== 'owner' && ownerCount(brandId) <= 1) {
                throw new ValidationError({ role: 'A brand must keep at least one owner.' });
            }
            assertValid({
                clientId:
                    role === 'client' &&
                    !db.all('clients').some((c) => c.id === clientId && c.brandId === brandId) &&
                    'Client users must be linked to a client of this brand.',
            });
            db.patch('brandMemberships', membershipId, { role, clientId: role === 'client' ? clientId : null });
            scope.audit(brandId, 'member.role_changed', 'membership', membershipId);
            return view(db.find('brandMemberships', membershipId)!);
        },

        async remove(brandId, membershipId) {
            const target = scope.owned('brandMemberships', brandId, membershipId, 'Member');
            guardTarget(brandId, target);
            if (target.role === 'owner' && ownerCount(brandId) <= 1) {
                throw new ValidationError({ role: 'A brand must keep at least one owner.' });
            }
            db.delete('brandMemberships', (m) => m.id === membershipId);
            scope.audit(brandId, 'member.removed', 'membership', membershipId);
        },
    };
}

export function localInvitations(scope: Scope): InvitationsApi {
    const { db } = scope;

    const expireStale = (inv: Invitation) => {
        if (inv.status === 'pending' && new Date(inv.expiresAt) < db.now()) db.patch('invitations', inv.id, { status: 'expired' });
    };

    return {
        async list(brandId) {
            scope.require(brandId, 'admin');
            db.all('invitations').filter((i) => i.brandId === brandId).forEach(expireStale);
            return structuredClone(
                db.all('invitations').filter((i) => i.brandId === brandId && i.status === 'pending'),
            ).map(({ token: _token, ...rest }) => rest);
        },

        async send(brandId, input) {
            const f = scope.require(brandId, 'admin');
            const email = input.email.trim().toLowerCase();
            const existingUser = db.all('users').find((u) => u.email.toLowerCase() === email);
            assertValid({
                email: !EMAIL.test(email)
                    ? 'Enter a valid email address.'
                    : (existingUser && db.all('brandMemberships').some((m) => m.brandId === brandId && m.userId === existingUser.id) && 'This person is already a member.') ||
                      (db.all('invitations').some((i) => i.brandId === brandId && i.email === email && i.status === 'pending') && 'An invitation is already pending for this email.'),
                role: !assignableRoles(f).includes(input.role) && `You cannot invite someone as ${input.role}.`,
                clientId:
                    input.role === 'client' &&
                    !db.all('clients').some((c) => c.id === input.clientId && c.brandId === brandId) &&
                    'Client invitations must be linked to a client of this brand.',
            });
            const expires = new Date(db.now());
            expires.setUTCDate(expires.getUTCDate() + INVITE_TTL_DAYS);
            const inv: Invitation = {
                id: newId('inv'),
                brandId,
                email,
                role: input.role,
                clientId: input.role === 'client' ? (input.clientId ?? null) : null,
                invitedBy: scope.userId,
                status: 'pending',
                token: newId('tok'),
                expiresAt: expires.toISOString(),
                createdAt: db.nowIso(),
            };
            db.insert('invitations', inv);
            scope.audit(brandId, 'invitation.sent', 'invitation', inv.id);
            // Local adapter returns the accept link so the flow can be exercised without email.
            // The Supabase adapter emails it from an Edge Function and returns nothing secret.
            return { invitation: (({ token: _t, ...rest }) => rest)(structuredClone(inv)), devAcceptPath: `/invitations/${inv.token}` };
        },

        async cancel(brandId, id) {
            scope.require(brandId, 'admin');
            const inv = scope.owned('invitations', brandId, id, 'Invitation');
            if (inv.status !== 'pending') throw new ValidationError({ status: 'Only pending invitations can be cancelled.' });
            db.patch('invitations', id, { status: 'cancelled' });
            scope.audit(brandId, 'invitation.cancelled', 'invitation', id);
        },

        async preview(token) {
            const inv = db.all('invitations').find((i) => i.token === token);
            if (!inv) throw new NotFoundError('Invitation');
            expireStale(inv);
            const brand = db.find('brands', inv.brandId)!;
            return { brandName: brand.name, brandSlug: brand.slug, role: inv.role, email: inv.email, status: inv.status, expiresAt: inv.expiresAt };
        },

        async accept(token) {
            const inv = db.all('invitations').find((i) => i.token === token);
            if (!inv) throw new NotFoundError('Invitation');
            expireStale(inv);
            if (inv.status !== 'pending') throw new ValidationError({ status: `This invitation is ${inv.status}.` });
            const me = db.find('users', scope.userId);
            if (!me || me.email.toLowerCase() !== inv.email) {
                throw new AccessDeniedError('This invitation was sent to a different email address.');
            }
            if (!db.all('brandMemberships').some((m) => m.brandId === inv.brandId && m.userId === me.id)) {
                db.insert('brandMemberships', {
                    id: newId('bm'),
                    brandId: inv.brandId,
                    userId: me.id,
                    role: inv.role,
                    clientId: inv.clientId,
                    department: null,
                    joinedAt: db.nowIso(),
                });
            }
            db.patch('invitations', inv.id, { status: 'accepted' });
            scope.audit(inv.brandId, 'invitation.accepted', 'invitation', inv.id);
            return { brandSlug: db.find('brands', inv.brandId)!.slug };
        },
    };
}
