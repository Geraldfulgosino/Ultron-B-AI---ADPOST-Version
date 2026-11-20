/**
 * Local adapter for user, role and invitation management. Rules mirror migration 0009
 * (change both together):
 *  - Super Admins manage every user, grant/revoke Super Admin (never the last one), suspend
 *    accounts (never themselves), assign agency roles and invite agency administrators.
 *  - Admins (agency owners/admins) see the users of agencies they administer and manage Client
 *    User permissions; they cannot create Admins or Super Admins.
 *  - Every action is recorded in the platform audit log.
 */
import type { AgencyRole, ClientPermission, ID } from '@/domain/types';
import { CLIENT_PERMISSIONS } from '@/domain/types';
import type { AgencyInvitationView, PlatformAuditView, UserMembershipView, UsersApi, UserView } from '../contracts';
import { can, isAgencyAdminRole, ROLE_LABELS } from '../access';
import { AccessDeniedError, assertValid, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import { clientBase } from '@/app/paths';
import type { LocalDatabase, Tables } from './db';
import type { Scope } from './scope';
import { isPlatformAdmin } from './agencies';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const AGENCY_ROLE_LABEL: Record<AgencyRole, string> = { agency_owner: 'Admin (owner)', agency_admin: 'Admin', agency_manager: 'Agency staff' };
const INVITE_TTL_DAYS = 7;

export function platformAudit(db: LocalDatabase, actorId: ID | null, action: string, targetType: string, targetId: ID | null, agencyId: ID | null = null, details: Record<string, string> = {}) {
    db.insert('platformAudit', { id: newId('pae'), actorId, action, targetType, targetId, agencyId, brandId: null, details, createdAt: db.nowIso() });
}

export function localUsers(scope: Scope): UsersApi {
    const { db } = scope;
    const superAdmin = () => isPlatformAdmin(db, scope.userId) && !db.find('users', scope.userId)?.deactivatedAt;
    const requireSuper = (msg = 'Only Super Admins can do this.') => { if (!superAdmin()) throw new AccessDeniedError(msg); };
    /** Agencies the caller administers (Super Admin: all). Suspended agencies only for Super Admins. */
    const adminAgencies = (): Set<ID> => {
        if (superAdmin()) return new Set(db.all('agencies').map((a) => a.id));
        if (db.find('users', scope.userId)?.deactivatedAt) return new Set();
        return new Set(db.all('agencyMemberships')
            .filter((m) => m.userId === scope.userId && isAgencyAdminRole(m.role) && db.find('agencies', m.agencyId)?.status !== 'suspended')
            .map((m) => m.agencyId));
    };

    const view = (userId: ID, agencies: Set<ID>): UserView => {
        const u = db.find('users', userId)!;
        const memberships: UserMembershipView[] = [];
        for (const m of db.all('agencyMemberships')) {
            if (m.userId !== userId || !agencies.has(m.agencyId)) continue;
            memberships.push({ kind: 'agency', agencyId: m.agencyId, agencyName: db.find('agencies', m.agencyId)?.name ?? '', brandId: null, brandName: null, membershipId: m.id, role: m.role, roleLabel: AGENCY_ROLE_LABEL[m.role], permissions: [] });
        }
        for (const m of db.all('brandMemberships')) {
            const b = db.find('brands', m.brandId);
            if (m.userId !== userId || !b || !agencies.has(b.agencyId)) continue;
            memberships.push({
                kind: 'client', agencyId: b.agencyId, agencyName: db.find('agencies', b.agencyId)?.name ?? '', brandId: b.id, brandName: b.name, membershipId: m.id,
                role: m.role, roleLabel: m.role === 'client' ? 'Client User' : `Staff · ${ROLE_LABELS[m.role]}`, permissions: m.permissions ?? [],
            });
        }
        return { id: u.id, name: u.name, email: u.email, status: u.deactivatedAt ? 'suspended' : 'active', isSuperAdmin: isPlatformAdmin(db, u.id), memberships };
    };

    const audit = (action: string, targetType: string, targetId: ID | null, agencyId: ID | null = null, details: Record<string, string> = {}) =>
        platformAudit(db, scope.userId, action, targetType, targetId, agencyId, details);

    const invitationView = (i: Tables['agencyInvitations']): AgencyInvitationView => ({
        id: i.id, agencyId: i.agencyId, email: i.email, role: i.role, status: i.status === 'pending' && i.expiresAt < db.nowIso() ? 'expired' : i.status, expiresAt: i.expiresAt, createdAt: i.createdAt,
    });

    return {
        async list(filter) {
            const agencies = adminAgencies();
            if (!agencies.size) throw new AccessDeniedError();
            if (filter.agencyId && !agencies.has(filter.agencyId)) throw new AccessDeniedError();
            const scopeAgencies = filter.agencyId ? new Set([filter.agencyId]) : agencies;
            const q = filter.query?.trim().toLowerCase();
            let users = db.all('users').map((u) => view(u.id, scopeAgencies));
            // Admins see only users who belong to their agencies; Super Admins see everyone (or one agency's users).
            if (!superAdmin() || filter.agencyId) users = users.filter((u) => u.memberships.length > 0 || (superAdmin() && !filter.agencyId));
            users = users
                .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
                .filter((u) => !filter.status || u.status === filter.status)
                .filter((u) => {
                    switch (filter.role) {
                        case undefined: return true;
                        case 'super_admin': return u.isSuperAdmin;
                        case 'admin': return u.memberships.some((m) => m.kind === 'agency' && (m.role === 'agency_owner' || m.role === 'agency_admin'));
                        case 'client_user': return u.memberships.some((m) => m.role === 'client');
                        case 'staff': return u.memberships.some((m) => m.role !== 'client' && m.role !== 'agency_owner' && m.role !== 'agency_admin');
                    }
                })
                .sort((a, b) => a.name.localeCompare(b.name));
            const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 25));
            const page = Math.max(1, filter.page ?? 1);
            return { users: users.slice((page - 1) * pageSize, page * pageSize), total: users.length };
        },

        async setSuspended(userId, suspended) {
            requireSuper('Only Super Admins suspend accounts.');
            if (userId === scope.userId) throw new ValidationError({ user: 'You cannot suspend yourself.' });
            if (!db.find('users', userId)) throw new NotFoundError('User');
            if (suspended && isPlatformAdmin(db, userId)) throw new ValidationError({ user: 'Revoke Super Admin before suspending this account.' });
            db.patch('users', userId, { deactivatedAt: suspended ? db.find('users', userId)!.deactivatedAt ?? db.nowIso() : null });
            audit(suspended ? 'user.suspended' : 'user.reactivated', 'user', userId);
            return view(userId, adminAgencies());
        },

        async grantSuperAdmin(userId) {
            requireSuper('Only Super Admins can grant Super Admin.');
            const u = db.find('users', userId);
            if (!u || u.deactivatedAt) throw new NotFoundError('User');
            if (!isPlatformAdmin(db, userId)) db.insert('platformAdmins', { id: newId('pla'), userId, createdAt: db.nowIso() });
            audit('super_admin.granted', 'user', userId);
        },

        async revokeSuperAdmin(userId) {
            requireSuper('Only Super Admins can revoke Super Admin.');
            if (isPlatformAdmin(db, userId) && db.all('platformAdmins').length <= 1) throw new ValidationError({ user: 'You cannot remove the last Super Admin.' });
            db.delete('platformAdmins', (p) => p.userId === userId);
            audit('super_admin.revoked', 'user', userId);
        },

        async assignAgencyRole(agencyId, userId, role) {
            requireSuper('Only Super Admins assign agency roles.');
            if (!db.find('agencies', agencyId)) throw new NotFoundError('Agency');
            if (!db.find('users', userId)) throw new NotFoundError('User');
            assertValid({ role: !['agency_owner', 'agency_admin', 'agency_manager'].includes(role) && 'Choose an agency role.' });
            const existing = db.all('agencyMemberships').find((m) => m.agencyId === agencyId && m.userId === userId);
            if (existing) db.patch('agencyMemberships', existing.id, { role });
            else db.insert('agencyMemberships', { id: newId('agm'), agencyId, userId, role });
            audit('agency_role.assigned', 'user', userId, agencyId, { role });
        },

        async revokeAgencyRole(agencyId, userId) {
            requireSuper('Only Super Admins revoke agency roles.');
            db.delete('agencyMemberships', (m) => m.agencyId === agencyId && m.userId === userId);
            audit('agency_role.revoked', 'user', userId, agencyId);
        },

        async inviteAgencyUser(agencyId, input) {
            requireSuper('Only Super Admins invite agency administrators.');
            const agency = db.find('agencies', agencyId);
            if (!agency) throw new NotFoundError('Agency');
            const email = input.email.trim().toLowerCase();
            assertValid({
                email: !EMAIL.test(email) && 'Enter a valid email address.',
                role: !['agency_admin', 'agency_manager'].includes(input.role) && 'Choose Admin or Agency staff.',
            });
            const existing = db.all('users').find((u) => u.email.toLowerCase() === email);
            if (existing && db.all('agencyMemberships').some((m) => m.agencyId === agencyId && m.userId === existing.id)) {
                throw new ValidationError({ email: 'This person already belongs to the agency.' });
            }
            // Idempotent: an open invitation for the same email is revoked and replaced.
            for (const i of db.all('agencyInvitations')) if (i.agencyId === agencyId && i.email === email && (i.status === 'pending' || i.status === 'sent')) db.patch('agencyInvitations', i.id, { status: 'revoked' });
            const expires = new Date(db.now());
            expires.setUTCDate(expires.getUTCDate() + INVITE_TTL_DAYS);
            const row = { id: newId('ain'), agencyId, email, role: input.role, token: newId('atk'), invitedBy: scope.userId, status: 'pending' as const, expiresAt: expires.toISOString(), acceptedAt: null, createdAt: db.nowIso() };
            db.insert('agencyInvitations', row);
            audit('agency_invitation.created', 'invitation', row.id, agencyId, { role: input.role });
            // Local mode sends no email: the status stays "pending" and a dev accept link is returned.
            return { invitation: invitationView(row), devAcceptPath: `/agency-invitations/${row.token}` };
        },

        async agencyInvitations(agencyId) {
            if (!adminAgencies().has(agencyId)) throw new AccessDeniedError();
            return db.all('agencyInvitations').filter((i) => i.agencyId === agencyId).map(invitationView).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },

        async revokeAgencyInvitation(invitationId) {
            requireSuper('Only Super Admins revoke agency invitations.');
            const i = db.find('agencyInvitations', invitationId);
            if (!i) throw new NotFoundError('Invitation');
            if (i.status === 'pending' || i.status === 'sent' || i.status === 'failed') db.patch('agencyInvitations', invitationId, { status: 'revoked' });
            audit('agency_invitation.revoked', 'invitation', invitationId, i.agencyId);
        },

        async acceptAgencyInvitation(token) {
            const inv = db.all('agencyInvitations').find((i) => i.token === token);
            if (!inv) throw new NotFoundError('Invitation');
            if (inv.status !== 'pending' && inv.status !== 'sent') throw new ValidationError({ status: `This invitation is ${inv.status}.` });
            if (inv.expiresAt < db.nowIso()) throw new ValidationError({ status: 'This invitation has expired.' });
            const me = db.find('users', scope.userId);
            if (!me || me.deactivatedAt || me.email.toLowerCase() !== inv.email) throw new AccessDeniedError('This invitation was sent to a different email address.');
            if (!db.all('agencyMemberships').some((m) => m.agencyId === inv.agencyId && m.userId === me.id)) {
                db.insert('agencyMemberships', { id: newId('agm'), agencyId: inv.agencyId, userId: me.id, role: inv.role });
            }
            db.patch('agencyInvitations', inv.id, { status: 'accepted', acceptedAt: db.nowIso() });
            platformAudit(db, me.id, 'agency_invitation.accepted', 'invitation', inv.id, inv.agencyId);
            return { agencySlug: db.find('agencies', inv.agencyId)!.slug };
        },

        async setClientPermissions(brandId, membershipId, permissions) {
            scope.require(brandId, 'admin');
            const m = db.find('brandMemberships', membershipId);
            if (!m || m.brandId !== brandId) throw new NotFoundError('Member');
            if (m.role !== 'client') throw new ValidationError({ permissions: 'Permissions apply to client users only.' });
            const clean = [...new Set(permissions)] as ClientPermission[];
            assertValid({ permissions: clean.some((p) => !CLIENT_PERMISSIONS.includes(p)) && 'Unknown permission.' });
            db.patch('brandMemberships', membershipId, { permissions: clean });
            scope.audit(brandId, 'member.permissions_updated', 'membership', membershipId);
            audit('client_permissions.updated', 'membership', membershipId, db.find('brands', brandId)!.agencyId, { permissions: clean.join(',') });
        },

        async audit(filter = {}) {
            const agencies = adminAgencies();
            if (!agencies.size) throw new AccessDeniedError();
            const sa = superAdmin();
            if (filter.agencyId && !agencies.has(filter.agencyId)) throw new AccessDeniedError();
            const name = (id: ID | null) => (id ? db.find('users', id)?.name ?? null : null);
            return db.all('platformAudit')
                .filter((e) => (filter.agencyId ? e.agencyId === filter.agencyId : sa || (e.agencyId !== null && agencies.has(e.agencyId))))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 200)
                .map((e): PlatformAuditView => ({
                    id: e.id, actorName: name(e.actorId) ?? 'System', action: e.action, targetType: e.targetType,
                    targetName: e.targetType === 'user' ? name(e.targetId) : null, agencyName: e.agencyId ? db.find('agencies', e.agencyId)?.name ?? null : null, createdAt: e.createdAt,
                }));
        },

        async home() {
            if (db.find('users', scope.userId)?.deactivatedAt) return { path: '/access-pending', reason: 'none' };
            if (superAdmin()) return { path: '/platform', reason: 'super_admin' };
            const admin = [...adminAgencies()];
            if (admin.length === 1) return { path: `/a/${db.find('agencies', admin[0]!)!.slug}`, reason: 'admin' };
            if (admin.length > 1) return { path: '/agencies', reason: 'admin' };
            const readable = db.all('brands').filter((b) => b.status !== 'archived' && (() => { try { return can(scope.facts(b.id), 'read'); } catch { return false; } })());
            const clientOnly = readable.length > 0 && readable.every((b) => db.all('brandMemberships').some((m) => m.brandId === b.id && m.userId === scope.userId && m.role === 'client'));
            if (readable.length === 1) return { path: `${clientBase(readable[0]!)}/dashboard`, reason: clientOnly ? 'client_user' : 'member' };
            if (!readable.length) return { path: '/access-pending', reason: 'none' };
            // Client Users with several clients choose one; they never land on agency pages.
            return clientOnly ? { path: '/brands', reason: 'client_user' } : { path: '/agencies', reason: 'member' };
        },
    };
}
