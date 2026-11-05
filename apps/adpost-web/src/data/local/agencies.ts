/**
 * Local adapter for agencies and their clients. Rules mirror migration 0008:
 *  - platform admins create agencies and change agency status, but see no client data by that role;
 *  - agency owners/admins edit their agency profile and add clients (with six agents each);
 *  - client admins edit and archive/restore their client; client slugs are unique per agency.
 * Counts come from stored records only; nothing is estimated.
 */
import type { Agency, Brand, ID, LifecycleStatus } from '@/domain/types';
import type { AgenciesApi, AgencyClientInput, AgencyInput, AgencyView, ClientCard } from '../contracts';
import { can, isAgencyAdminRole, ROLE_LABELS, effectiveRole } from '../access';
import { AccessDeniedError, assertValid } from '../errors';
import { newId, slugify } from '@/lib/utils';
import { AGENT_TEMPLATES } from '@/domain/agents';
import { buildAgentInstance } from './agents';
import { assertCanAddBrand } from './entitlements';
import { brandRow } from './fixtures';
import type { LocalDatabase } from './db';
import type { Scope } from './scope';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HTTPS = /^https:\/\/\S{1,2000}$/;
const CURRENCY = /^[A-Z]{3}$/;
const STATUSES: LifecycleStatus[] = ['active', 'inactive', 'archived'];

export const isPlatformAdmin = (db: LocalDatabase, userId: ID) => db.all('platformAdmins').some((p) => p.userId === userId);

const bad = (cond: boolean, msg: string) => (cond ? msg : false);
const opt = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

/** Shared by AgenciesApi.createClient and the legacy workspace.createBrand. */
export function createClientRecord(scope: Scope, agencyId: ID, input: AgencyClientInput): Brand {
    const { db } = scope;
    const agency = db.find('agencies', agencyId);
    const m = db.all('agencyMemberships').find((x) => x.agencyId === agencyId && x.userId === scope.userId);
    if (!agency || !isAgencyAdminRole(m?.role)) throw new AccessDeniedError('Only agency administrators can add clients.');
    if (agency.status === 'archived') throw new AccessDeniedError('This agency is archived. Restore it before adding clients.');
    assertCanAddBrand(db, agencyId);
    const name = input.name?.trim() ?? '';
    const slug = (input.slug?.trim() || slugify(name)).toLowerCase();
    validateClient(input);
    assertValid({
        name: !name && 'Client name is required.',
        slug: !SLUG.test(slug) || slug.length > 64
            ? 'Use lowercase letters, digits and single hyphens.'
            : bad(db.all('brands').some((b) => b.agencyId === agencyId && b.slug === slug), 'A client with this slug already exists in this agency.'),
    });
    const at = db.nowIso();
    const brand = brandRow({
        id: newId('brd'), agencyId, agencySlug: agency.slug, name, slug, status: input.status ?? 'active',
        description: input.description?.trim() ?? '', displayName: opt(input.displayName) ?? null, industry: opt(input.industry) ?? null,
        logoUrl: opt(input.logoUrl) ?? null, primaryContactName: opt(input.primaryContactName) ?? null, primaryContactEmail: opt(input.primaryContactEmail) ?? null,
        timezone: agency.timezone, currency: agency.defaultCurrency,
    }, at);
    if (brand.status === 'archived') brand.archivedAt = at;
    db.insert('brands', brand);
    // Every client gets its own independent set of the six specialist agents (same templates).
    for (const t of AGENT_TEMPLATES) {
        const { agent, version } = buildAgentInstance(brand.id, brand.name, t.key, scope.userId, at);
        db.insert('instructionVersions', version);
        db.insert('agentInstances', agent);
    }
    scope.audit(brand.id, 'client.created', 'brand', brand.id);
    return brand;
}

function validateClient(input: Partial<AgencyClientInput>) {
    assertValid({
        name: input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120) && 'A client name of 1–120 characters is required.',
        displayName: bad(!!input.displayName && input.displayName.length > 120, 'At most 120 characters.'),
        industry: bad(!!input.industry && input.industry.length > 120, 'At most 120 characters.'),
        logoUrl: bad(!!input.logoUrl && !HTTPS.test(input.logoUrl.trim()), 'Use an https:// image URL.'),
        primaryContactEmail: bad(!!input.primaryContactEmail && !EMAIL.test(input.primaryContactEmail.trim()), 'Enter a valid email address.'),
        status: bad(input.status !== undefined && !STATUSES.includes(input.status), 'Choose a status.'),
    });
}

export function localAgencies(scope: Scope): AgenciesApi {
    const { db } = scope;
    const platform = () => isPlatformAdmin(db, scope.userId);
    const membership = (agencyId: ID) => db.all('agencyMemberships').find((m) => m.agencyId === agencyId && m.userId === scope.userId) ?? null;

    /** Clients of the agency the caller may read (same rule as brands_select). */
    const readableClients = (agencyId: ID) => db.all('brands').filter((b) => {
        if (b.agencyId !== agencyId) return false;
        try { scope.facts(b.id); return true; } catch { return false; }
    });

    const view = (a: Agency): AgencyView | null => {
        const m = membership(a.id);
        const clients = readableClients(a.id);
        const isPlatform = platform();
        if (!m && !clients.length && !isPlatform) return null;
        const ids = new Set(clients.map((c) => c.id));
        const websites = db.all('websites').filter((w) => ids.has(w.brandId) && w.status !== 'archived');
        return {
            ...structuredClone(a),
            access: { isMember: !!m, canEdit: isPlatform || isAgencyAdminRole(m?.role), canChangeStatus: isPlatform, canAddClients: isAgencyAdminRole(m?.role) && a.status !== 'archived' },
            counts: m || clients.length ? {
                clients: clients.filter((c) => c.status !== 'archived').length,
                activeClients: clients.filter((c) => c.status === 'active').length,
                archivedClients: clients.filter((c) => c.status === 'archived').length,
                websites: websites.length,
            } : null,
        };
    };
    const find = (agencyId: ID) => {
        const a = db.find('agencies', agencyId);
        const v = a && view(a);
        if (!v) throw new AccessDeniedError();
        return v;
    };

    const validateAgency = (input: Partial<AgencyInput>) => assertValid({
        name: input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120) && 'An agency name of 1–120 characters is required.',
        description: bad((input.description?.length ?? 0) > 2000, 'At most 2,000 characters.'),
        logoUrl: bad(!!input.logoUrl && !HTTPS.test(input.logoUrl.trim()), 'Use an https:// image URL.'),
        defaultCurrency: bad(input.defaultCurrency !== undefined && !CURRENCY.test(input.defaultCurrency), 'Use a 3-letter currency code such as USD.'),
        contactEmail: bad(!!input.contactEmail && !EMAIL.test(input.contactEmail.trim()), 'Enter a valid email address.'),
        timezone: bad(input.timezone !== undefined && !input.timezone.trim(), 'Choose a timezone.'),
    });

    return {
        async isPlatformAdmin() {
            return platform();
        },

        async list(filter = {}) {
            const q = filter.query?.trim().toLowerCase();
            const status = filter.status ?? 'all';
            return db.all('agencies').map(view).filter((v): v is AgencyView => !!v)
                .filter((v) => status === 'all' || v.status === status)
                .filter((v) => !q || v.name.toLowerCase().includes(q) || v.slug.includes(q))
                .sort((a, b) => a.name.localeCompare(b.name));
        },

        async bySlug(slug) {
            const a = db.all('agencies').find((x) => x.slug === slug);
            const v = a && view(a);
            if (!v) throw new AccessDeniedError();
            return v;
        },

        async create(input) {
            if (!platform()) throw new AccessDeniedError('Only platform administrators can create agencies.');
            validateAgency(input);
            const name = input.name?.trim() ?? '';
            const slug = (input.slug?.trim() || slugify(name)).toLowerCase();
            assertValid({
                name: !name && 'Agency name is required.',
                slug: !SLUG.test(slug) || slug.length > 64 ? 'Use lowercase letters, digits and single hyphens.' : bad(db.all('agencies').some((a) => a.slug === slug), 'An agency with this slug already exists.'),
            });
            const at = db.nowIso();
            const agency: Agency = {
                id: newId('agy'), name, slug, planKey: 'internal', description: input.description?.trim() ?? '', logoUrl: opt(input.logoUrl) ?? null,
                status: 'active', timezone: input.timezone ?? 'UTC', defaultCurrency: input.defaultCurrency ?? 'USD', contactEmail: opt(input.contactEmail) ?? null,
                createdAt: at, updatedAt: at, archivedAt: null,
            };
            db.insert('agencies', agency);
            db.insert('agencyMemberships', { id: newId('agm'), agencyId: agency.id, userId: scope.userId, role: 'agency_owner' });
            return find(agency.id);
        },

        async update(agencyId, patch) {
            const current = find(agencyId);
            if (!current.access.canEdit) throw new AccessDeniedError('Only agency administrators can edit this agency.');
            if (patch.status !== undefined && patch.status !== current.status && !current.access.canChangeStatus) {
                throw new AccessDeniedError('Only platform administrators can archive, deactivate or restore an agency.');
            }
            validateAgency(patch);
            assertValid({ status: bad(patch.status !== undefined && !STATUSES.includes(patch.status), 'Choose a status.') });
            const next: Partial<Agency> = { updatedAt: db.nowIso() };
            if (patch.name !== undefined) next.name = patch.name.trim();
            if (patch.description !== undefined) next.description = patch.description.trim();
            if (patch.logoUrl !== undefined) next.logoUrl = opt(patch.logoUrl) ?? null;
            if (patch.timezone !== undefined) next.timezone = patch.timezone;
            if (patch.defaultCurrency !== undefined) next.defaultCurrency = patch.defaultCurrency;
            if (patch.contactEmail !== undefined) next.contactEmail = opt(patch.contactEmail) ?? null;
            if (patch.status !== undefined) {
                next.status = patch.status;
                next.archivedAt = patch.status === 'archived' ? current.archivedAt ?? db.nowIso() : null;
            }
            db.patch('agencies', agencyId, next);
            return find(agencyId);
        },

        async clients(agencyId, filter = {}) {
            find(agencyId);
            const q = filter.query?.trim().toLowerCase();
            const status = filter.status ?? 'all';
            return readableClients(agencyId)
                .filter((b) => (status === 'all' ? true : b.status === status))
                .filter((b) => !q || b.name.toLowerCase().includes(q) || b.slug.includes(q) || (b.displayName ?? '').toLowerCase().includes(q))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((b): ClientCard => {
                    const f = scope.facts(b.id);
                    const staff = can(f, 'staff');
                    const sites = scope.rows('websites', b.id, { capability: 'read', clientKey: (w) => w.clientId ?? '' }).filter((w) => w.status !== 'archived');
                    const primary = sites.find((w) => w.isPrimary) ?? null;
                    return {
                        client: structuredClone(b),
                        roleLabel: ROLE_LABELS[effectiveRole(f)!],
                        canAdmin: can(f, 'admin'),
                        counts: {
                            websites: sites.length,
                            projects: staff ? db.all('projects').filter((p) => p.brandId === b.id && p.status !== 'completed').length : null,
                            openTasks: staff ? db.all('tasks').filter((t) => t.brandId === b.id && t.status !== 'done').length : null,
                            connectedIntegrations: staff ? db.all('integrations').filter((i) => i.brandId === b.id && i.status === 'connected').length : null,
                        },
                        primaryWebsite: primary ? { id: primary.id, name: primary.name, domain: primary.domain } : null,
                    };
                });
        },

        async createClient(agencyId, input) {
            return structuredClone(createClientRecord(scope, agencyId, input));
        },

        async updateClient(brandId, patch) {
            scope.require(brandId, 'admin');
            validateClient(patch);
            const current = db.find('brands', brandId)!;
            const next: Partial<Brand> = {};
            if (patch.name !== undefined) next.name = patch.name.trim();
            if (patch.description !== undefined) next.description = patch.description.trim();
            for (const k of ['displayName', 'industry', 'logoUrl', 'primaryContactName', 'primaryContactEmail'] as const) {
                if (patch[k] !== undefined) next[k] = opt(patch[k]) ?? null;
            }
            if (patch.status !== undefined) {
                next.status = patch.status;
                next.archivedAt = patch.status === 'archived' ? current.archivedAt ?? db.nowIso() : null;
            }
            const updated = db.patch('brands', brandId, next);
            scope.audit(brandId, patch.status === 'archived' ? 'client.archived' : current.status === 'archived' && patch.status ? 'client.restored' : 'client.updated', 'brand', brandId);
            return structuredClone(updated);
        },

        async overview(agencyId) {
            const agency = find(agencyId);
            if (!agency.counts) throw new AccessDeniedError('Only members of this agency can see its overview.');
            const clients = readableClients(agencyId).filter((c) => c.status !== 'archived');
            const ids = new Set(clients.filter((c) => { try { return can(scope.facts(c.id), 'staff'); } catch { return false; } }).map((c) => c.id));
            const sites = db.all('websites').filter((w) => clients.some((c) => c.id === w.brandId) && w.status !== 'archived');
            const monthStart = db.nowIso().slice(0, 7);
            const integrations = db.all('integrations').filter((i) => ids.has(i.brandId));
            return {
                agency,
                clients: clients.length,
                websites: sites.length,
                websitesWithoutUrl: sites.filter((w) => !w.websiteUrl).length,
                activeProjects: db.all('projects').filter((p) => ids.has(p.brandId) && p.status === 'active').length,
                openTasks: db.all('tasks').filter((t) => ids.has(t.brandId) && t.status !== 'done').length,
                aiRunsThisMonth: db.all('executions').filter((e) => ids.has(e.brandId) && e.startedAt.startsWith(monthStart) && e.status !== 'limited').length,
                integrations: {
                    connected: integrations.filter((i) => i.status === 'connected').length,
                    pending: integrations.filter((i) => i.status === 'pending').length,
                    error: integrations.filter((i) => i.status === 'error').length,
                },
            };
        },

        async platformOverview() {
            if (!platform()) throw new AccessDeniedError('Platform administrators only.');
            const month = db.nowIso().slice(0, 7);
            return {
                agencies: db.all('agencies').filter((a) => a.status !== 'archived').length,
                clients: db.all('brands').filter((b) => b.status !== 'archived').length,
                websites: db.all('websites').filter((w) => w.status !== 'archived').length,
                activeUsers: db.all('users').length,
                integrations: { connected: db.all('integrations').filter((i) => i.status === 'connected').length, error: db.all('integrations').filter((i) => i.status === 'error').length },
                aiRequestsThisMonth: db.all('aiUsage').filter((u) => u.createdAt.startsWith(month) && u.executionStatus !== 'limited').length,
            };
        },
    };
}

