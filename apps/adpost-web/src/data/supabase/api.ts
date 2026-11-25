/**
 * `BrandApi` over the Supabase repositories (Phase 17F, F6). The UI keeps using the same
 * contract as mock mode (src/data/contracts.ts).
 *
 * - Roles and capabilities are computed with the same pure rules as mock mode
 *   (src/data/access.ts, toBrandAccess) from rows RLS returns for this user. They decide what the
 *   UI offers; RLS decides what the database allows.
 * - Areas whose work happens server-side and is not connected yet (analytics, SEO insights,
 *   reports, automation, intelligence, studio, knowledge, AI settings, agent administration,
 *   approvals) check access first and then raise NotAvailableError. They never return mock data.
 */
import type * as T from '@/domain/types';
import type {
    AgencyView, AgenciesApi, BrandAccess, BrandApi, ChatApi, ClientCard, ClientsApi, ConversationSummary, IntegrationsApi, InvitationsApi, MembersApi,
    MemberView, UserMembershipView, UsersApi, UserView, WebsitesApi, WorkApi, WorkspaceApi, AgentsApi,
} from '@/data/contracts';
import { effectiveRole, isAgencyAdminRole, ROLE_LABELS, type AccessFacts, type Capability } from '@/data/access';
import { AccessDeniedError, NotAvailableError, ValidationError } from '@/data/errors';
import { AGENT_TEMPLATES, templateByKey } from '@/domain/agents';
import { toBrandAccess } from '@/data/local/workspace';
import { AGENCY_ROLE_LABEL } from '@/data/local/users';
import { TEAM_TITLES } from '@/data/local/chat';
import { clientBase } from '@/app/paths';
import { eq, inList, type DbPort } from './dbPort';
import { fail, MAX_PAGE_SIZE, resolveHome, type IntegrationConnection, type MyMemberships, type Page, type Repositories } from './repositories';

/** Server-side actions the browser triggers through Edge Functions. Absent = not connected yet. */
export interface ServerActions {
    /** agent-execute: runs the agents for a user message; replies are written to `messages`. */
    runAgents?(messageId: string): Promise<void>;
    /** user-invite: delivers an invitation email for a token the database just created. */
    deliverInvitation?(input: { kind: 'client' | 'agency'; invitationId: string; token: string }): Promise<void>;
    /** integration-sync / integration-google, for the Integrations page. */
    disconnectIntegration?(websiteId: string, provider: IntegrationConnection['provider']): Promise<void>;
    /** integration-google `callback`: state, PKCE and user checks happen server-side. */
    completeGoogle?(query: { state: string | null; code: string | null; error: string | null }): Promise<{ websiteId: string; provider: 'google_analytics' | 'google_search_console' }>;
}

export interface ApiContext {
    repos: Repositories;
    db: DbPort;
    user: T.User;
    server: ServerActions;
}

async function allPages<X>(load: (page: number) => Promise<Page<X>>): Promise<X[]> {
    const out: X[] = [];
    for (let page = 1; ; page++) {
        const p = await load(page);
        out.push(...p.items);
        if (out.length >= p.total || !p.items.length) return out;
    }
}

/** Legacy integration status for the `IntegrationsApi` shape (the v7 UI reads the full status elsewhere). */
const legacyStatus = (s: IntegrationConnection['status']): T.IntegrationStatus =>
    s === 'connected' || s === 'syncing' || s === 'sync_completed' ? 'connected'
        : s === 'not_connected' || s === 'pending_authorization' ? 'pending'
            : s === 'disabled' ? 'disconnected' : 'error';

export function supabaseApi(ctx: ApiContext): BrandApi {
    const { repos, db, user, server } = ctx;

    // ── Access (same rules as mock mode, from RLS-visible rows) ───────────────
    const facts = (brand: T.Brand, mine: MyMemberships, agencyStatus: T.AgencyStatus | undefined): AccessFacts => ({
        brand,
        membership: mine.brand.find((m) => m.brandId === brand.id) ?? null,
        agencyMembership: mine.agency.find((m) => m.agencyId === brand.agencyId) ?? null,
        platformAdmin: mine.platformAdmin,
        agencySuspended: agencyStatus === 'suspended',
    });

    async function access(brandId: T.ID): Promise<BrandAccess> {
        const brand = await repos.clients.byId(brandId);
        const [mine, agency] = await Promise.all([repos.memberships.mine(), repos.agencies.byId(brand.agencyId)]);
        const f = facts(brand, mine, agency.status);
        if (!effectiveRole(f)) throw new AccessDeniedError();
        return toBrandAccess(f);
    }

    async function require(brandId: T.ID, cap: Capability): Promise<BrandAccess> {
        const a = await access(brandId);
        if (!a.can[cap]) throw new AccessDeniedError();
        return a;
    }

    async function listAccess(): Promise<BrandAccess[]> {
        const [brands, mine, agencies] = await Promise.all([
            allPages((page) => repos.clients.list({ page, pageSize: MAX_PAGE_SIZE })),
            repos.memberships.mine(),
            allPages((page) => repos.agencies.list({ page, pageSize: MAX_PAGE_SIZE })),
        ]);
        const status = new Map(agencies.map((a) => [a.id, a.status]));
        return brands
            .map((b) => facts(b, mine, status.get(b.agencyId)))
            .filter((f) => effectiveRole(f))
            .map(toBrandAccess)
            .sort((a, b) => a.brand.name.localeCompare(b.brand.name));
    }

    /** Guarded placeholder for an area that runs server-side and is not connected yet. */
    function notConnected<A extends object>(feature: string, cap: Capability): A {
        return new Proxy({} as Record<PropertyKey, unknown>, {
            // Real members (added with Object.assign) win; `then` stays undefined so the area is not a thenable.
            get: (target, method) => method in target ? target[method] : method === 'then' ? undefined : async (first?: unknown) => {
                if (typeof first === 'string') await require(first, cap);
                throw new NotAvailableError(`${feature} (${String(method)})`);
            },
        }) as A;
    }

    // ── Workspace ─────────────────────────────────────────────────────────────
    const workspace: WorkspaceApi = {
        me: () => structuredClone(user),
        listBrands: listAccess,
        async brandBySlug(slug, agencySlug) {
            if (agencySlug) return access((await repos.clients.bySlug(agencySlug, slug)).id);
            const matches = (await listAccess()).filter((b) => b.brand.slug === slug);
            if (matches.length !== 1) throw new AccessDeniedError();
            return matches[0]!;
        },
        agencyUsage: async () => {
            throw new NotAvailableError('Plan usage');
        },
        async canCreateBrands() {
            return (await repos.memberships.mine()).agency.some((m) => isAgencyAdminRole(m.role));
        },
        async createBrand(input) {
            const adminOf = (await repos.memberships.mine()).agency.find((m) => isAgencyAdminRole(m.role));
            if (!adminOf) throw new AccessDeniedError('Only agency owners and admins can add clients.');
            return agencies.createClient(adminOf.agencyId, { name: input.name, description: input.description });
        },
        async updateBrand(brandId, input) {
            await require(brandId, 'admin');
            return repos.clients.update(brandId, input);
        },
    };

    // ── Agencies ──────────────────────────────────────────────────────────────
    async function agencyView(a: T.Agency, mine: MyMemberships, brands: BrandAccess[]): Promise<AgencyView | null> {
        const m = mine.agency.find((x) => x.agencyId === a.id) ?? null;
        const clients = brands.filter((b) => b.brand.agencyId === a.id);
        const isPlatform = mine.platformAdmin;
        if (!m && !clients.length && !isPlatform) return null;
        const workspace = isPlatform || !!m || clients.some((c) => c.can.staff);
        let counts: AgencyView['counts'] = null;
        if (workspace && (m || clients.length || isPlatform)) {
            const live = clients.filter((c) => c.brand.status !== 'archived');
            const sites = (await repos.websites.listByClients(live.map((c) => c.brand.id))).filter((w) => w.status !== 'archived');
            counts = {
                clients: live.length, activeClients: clients.filter((c) => c.brand.status === 'active').length, archivedClients: clients.length - live.length,
                websites: sites.length, demoWebsites: sites.filter((w) => w.isDemo).length,
            };
        }
        return {
            ...a,
            access: { isMember: !!m, canEdit: isPlatform || isAgencyAdminRole(m?.role), canChangeStatus: isPlatform, canAddClients: isAgencyAdminRole(m?.role) && a.status !== 'archived', workspace },
            counts,
        };
    }

    const agencies: AgenciesApi = {
        async isPlatformAdmin() {
            return (await repos.memberships.mine()).platformAdmin;
        },
        async list(filter = {}) {
            const [all, mine, brands] = await Promise.all([allPages((page) => repos.agencies.list({ ...filter, page, pageSize: MAX_PAGE_SIZE })), repos.memberships.mine(), listAccess()]);
            const views = await Promise.all(all.map((a) => agencyView(a, mine, brands)));
            return views.filter((v): v is AgencyView => !!v);
        },
        async bySlug(slug) {
            const [a, mine, brands] = await Promise.all([repos.agencies.bySlug(slug), repos.memberships.mine(), listAccess()]);
            const v = await agencyView(a, mine, brands);
            if (!v) throw new AccessDeniedError();
            return v;
        },
        async create(input) {
            const { data, error } = await db.rpc<string>('create_agency', {
                p_name: input.name.trim(), p_slug: input.slug?.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                p_description: input.description ?? '', p_timezone: input.timezone ?? 'UTC', p_currency: input.defaultCurrency ?? 'USD',
            });
            if (error) fail(error, 'slug');
            const a = await repos.agencies.byId(data!);
            return (await agencies.bySlug(a.slug));
        },
        async update(agencyId, patch) {
            const a = await repos.agencies.update(agencyId, patch);
            return agencies.bySlug(a.slug);
        },
        async clients(agencyId, filter = {}) {
            const agency = await repos.agencies.byId(agencyId);
            const view = await agencies.bySlug(agency.slug);
            if (!view.access.workspace) throw new AccessDeniedError('Client Users open their client portal, not the agency workspace.');
            const q = filter.query?.trim().toLowerCase();
            const list = (await listAccess())
                .filter((b) => b.brand.agencyId === agencyId)
                .filter((b) => (filter.status ?? 'all') === 'all' || b.brand.status === filter.status)
                .filter((b) => !q || b.brand.name.toLowerCase().includes(q) || b.brand.slug.includes(q) || (b.brand.displayName ?? '').toLowerCase().includes(q));
            return Promise.all(list.map(async (b): Promise<ClientCard> => {
                const sites = (await repos.websites.listByClient(b.brand.id)).filter((w) => w.status !== 'archived');
                const primary = sites.find((w) => w.isPrimary) ?? null;
                const staff = b.can.staff;
                const count = async (table: string, filters: ReturnType<typeof eq>[]) => {
                    const { count: n, error } = await db.select({ table, columns: ['id'], filters, range: { from: 0, to: 0 }, count: true });
                    if (error) fail(error);
                    return n ?? 0;
                };
                return {
                    client: b.brand, roleLabel: b.roleLabel, canAdmin: b.can.admin,
                    counts: {
                        websites: sites.length,
                        projects: staff ? await count('projects', [eq('brand_id', b.brand.id), { column: 'status', op: 'neq', value: 'completed' }]) : null,
                        openTasks: staff ? await count('tasks', [eq('brand_id', b.brand.id), { column: 'status', op: 'neq', value: 'done' }]) : null,
                        connectedIntegrations: staff ? (await repos.integrations.listByClient(b.brand.id)).filter((i) => legacyStatus(i.status) === 'connected').length : null,
                    },
                    primaryWebsite: primary ? { id: primary.id, name: primary.name, domain: primary.domain } : null,
                };
            }));
        },
        async createClient(agencyId, input) {
            // create_client checks the caller's authority and provisions the client's six agents.
            const slug = input.slug?.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const { data, error } = await db.rpc<string>('create_client', { p_agency_id: agencyId, p_name: input.name.trim(), p_slug: slug, p_description: input.description ?? '', p_industry: input.industry ?? null });
            if (error) fail(error, 'slug');
            const extra = { displayName: input.displayName, logoUrl: input.logoUrl, primaryContactName: input.primaryContactName, primaryContactEmail: input.primaryContactEmail };
            return Object.values(extra).some((v) => v !== undefined) ? repos.clients.update(data!, extra) : repos.clients.byId(data!);
        },
        async updateClient(brandId, patch) {
            await require(brandId, 'admin');
            return repos.clients.update(brandId, patch);
        },
        async overview(agencyId) {
            const agency = await repos.agencies.byId(agencyId);
            const view = await agencies.bySlug(agency.slug);
            if (!view.counts || !view.access.workspace) throw new AccessDeniedError('Only members of this agency can see its overview.');
            const clients = (await listAccess()).filter((b) => b.brand.agencyId === agencyId && b.brand.status !== 'archived');
            const ids = clients.map((c) => c.brand.id);
            const staffIds = clients.filter((c) => c.can.staff).map((c) => c.brand.id);
            const sites = (await repos.websites.listByClients(ids)).filter((w) => w.status !== 'archived');
            const count = async (table: string, extra: Array<ReturnType<typeof eq>>) => {
                if (!staffIds.length) return 0;
                const { count: n, error } = await db.select({ table, columns: ['id'], filters: [inList('brand_id', staffIds), ...extra], range: { from: 0, to: 0 }, count: true });
                if (error) fail(error);
                return n ?? 0;
            };
            const integrations = (await Promise.all(staffIds.map((id) => repos.integrations.listByClient(id)))).flat();
            const monthStart = new Date();
            monthStart.setUTCDate(1);
            monthStart.setUTCHours(0, 0, 0, 0);
            return {
                agency: view, clients: clients.length, websites: sites.length, demoWebsites: sites.filter((w) => w.isDemo).length,
                websitesWithoutUrl: sites.filter((w) => !w.websiteUrl).length,
                activeProjects: await count('projects', [eq('status', 'active')]),
                openTasks: await count('tasks', [{ column: 'status', op: 'neq', value: 'done' }]),
                aiRunsThisMonth: await count('agent_executions', [{ column: 'started_at', op: 'gte', value: monthStart.toISOString() }]),
                integrations: {
                    connected: integrations.filter((i) => legacyStatus(i.status) === 'connected').length,
                    pending: integrations.filter((i) => legacyStatus(i.status) === 'pending').length,
                    error: integrations.filter((i) => legacyStatus(i.status) === 'error').length,
                },
            };
        },
        async platformOverview() {
            const { data, error } = await db.rpc<Record<string, number>>('platform_overview', {});
            if (error) fail(error);
            const d = data ?? {};
            const count = async (table: string, filters: Array<ReturnType<typeof eq>>) => {
                const { count: n, error: e } = await db.select({ table, columns: ['id'], filters, range: { from: 0, to: 0 }, count: true });
                if (e) fail(e);
                return n ?? 0;
            };
            return {
                agencies: Number(d.agencies ?? 0), suspendedAgencies: await count('agencies', [eq('status', 'suspended')]), clients: Number(d.clients ?? 0),
                websites: Number(d.websites ?? 0), demoWebsites: Number(d.demo_websites ?? 0),
                // Every profile minus the active ones (Super Admins read all profiles).
                suspendedUsers: (await count('profiles', [])) - Number(d.active_users ?? 0),
                pendingInvitations: await count('invitations', [eq('status', 'pending')]), enabledAgents: await count('agent_instances', [eq('active', true)]),
                activeUsers: Number(d.active_users ?? 0),
                integrations: { connected: Number(d.connected_integrations ?? 0), error: Number(d.integration_errors ?? 0) },
                aiRequestsThisMonth: await count('ai_usage_events', [{ column: 'created_at', op: 'gte', value: monthStartIso() }]),
            };
        },
    };

    // ── Users and roles (migration 0009 RPCs) ─────────────────────────────────
    const rpcVoid = async (fn: string, args: Record<string, unknown>) => {
        const { error } = await db.rpc(fn, args);
        if (error) fail(error);
    };

    async function adminAgencyIds(mine: MyMemberships): Promise<Set<T.ID>> {
        if (mine.platformAdmin) return new Set((await allPages((page) => repos.agencies.list({ page, pageSize: MAX_PAGE_SIZE }))).map((a) => a.id));
        const visible = new Map((await allPages((page) => repos.agencies.list({ page, pageSize: MAX_PAGE_SIZE }))).map((a) => [a.id, a]));
        return new Set(mine.agency.filter((m) => isAgencyAdminRole(m.role) && visible.get(m.agencyId)?.status !== 'suspended').map((m) => m.agencyId));
    }

    async function userViews(userIds: T.ID[], inAgencies: Set<T.ID>): Promise<UserView[]> {
        if (!userIds.length) return [];
        const [profiles, agencyRows, brandRows, admins, agencyList, brands] = await Promise.all([
            repos.profiles.byIds(userIds),
            db.select<{ id: string; agency_id: string; user_id: string; role: T.AgencyRole }>({ table: 'agency_memberships', columns: ['id', 'agency_id', 'user_id', 'role'], filters: [inList('user_id', userIds)] }),
            db.select<{ id: string; brand_id: string; user_id: string; role: T.BrandRole; permissions: T.ClientPermission[] }>({ table: 'brand_memberships', columns: ['id', 'brand_id', 'user_id', 'role', 'permissions'], filters: [inList('user_id', userIds)] }),
            db.select<{ user_id: string }>({ table: 'platform_admins', columns: ['user_id'], filters: [inList('user_id', userIds)] }),
            allPages((page) => repos.agencies.list({ page, pageSize: MAX_PAGE_SIZE })),
            allPages((page) => repos.clients.list({ page, pageSize: MAX_PAGE_SIZE })),
        ]);
        for (const r of [agencyRows, brandRows, admins]) if (r.error) fail(r.error);
        const agencyName = new Map(agencyList.map((a) => [a.id, a.name]));
        const brandById = new Map(brands.map((b) => [b.id, b]));
        const superAdmins = new Set(admins.rows.map((r) => r.user_id));
        return profiles.map((p): UserView => {
            const memberships: UserMembershipView[] = [];
            for (const m of agencyRows.rows) {
                if (m.user_id !== p.id || !inAgencies.has(m.agency_id)) continue;
                memberships.push({ kind: 'agency', agencyId: m.agency_id, agencyName: agencyName.get(m.agency_id) ?? '', brandId: null, brandName: null, membershipId: m.id, role: m.role, roleLabel: AGENCY_ROLE_LABEL[m.role], permissions: [] });
            }
            for (const m of brandRows.rows) {
                const b = brandById.get(m.brand_id);
                if (m.user_id !== p.id || !b || !inAgencies.has(b.agencyId)) continue;
                memberships.push({
                    kind: 'client', agencyId: b.agencyId, agencyName: agencyName.get(b.agencyId) ?? '', brandId: b.id, brandName: b.name, membershipId: m.id, role: m.role,
                    roleLabel: m.role === 'client' ? 'Client User' : `Staff · ${ROLE_LABELS[m.role]}`, permissions: m.permissions ?? [],
                });
            }
            return { id: p.id, name: p.name, email: p.email, status: p.deactivatedAt ? 'suspended' : 'active', isSuperAdmin: superAdmins.has(p.id), memberships };
        });
    }

    const users: UsersApi = {
        async list(filter) {
            const mine = await repos.memberships.mine();
            const scope = await adminAgencyIds(mine);
            if (!scope.size) throw new AccessDeniedError();
            if (filter.agencyId && !scope.has(filter.agencyId)) throw new AccessDeniedError();
            const inAgencies = filter.agencyId ? new Set([filter.agencyId]) : scope;
            let ids: T.ID[];
            if (mine.platformAdmin && !filter.agencyId) {
                ids = (await allPages((page) => repos.profiles.list({ page, pageSize: MAX_PAGE_SIZE }))).map((u) => u.id);
            } else {
                const brandIds = (await allPages((page) => repos.clients.list({ page, pageSize: MAX_PAGE_SIZE }))).filter((b) => inAgencies.has(b.agencyId)).map((b) => b.id);
                const [am, bm] = await Promise.all([
                    db.select<{ user_id: string }>({ table: 'agency_memberships', columns: ['user_id'], filters: [inList('agency_id', [...inAgencies])] }),
                    brandIds.length ? db.select<{ user_id: string }>({ table: 'brand_memberships', columns: ['user_id'], filters: [inList('brand_id', brandIds)] }) : Promise.resolve({ rows: [], count: null, error: null }),
                ]);
                if (am.error) fail(am.error);
                if (bm.error) fail(bm.error);
                ids = [...new Set([...am.rows, ...bm.rows].map((r) => r.user_id))];
            }
            const q = filter.query?.trim().toLowerCase();
            const views = (await userViews(ids, inAgencies))
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
            return { users: views.slice((page - 1) * pageSize, page * pageSize), total: views.length };
        },
        async setSuspended(userId, suspended) {
            await rpcVoid('set_user_suspended', { p_user_id: userId, p_suspended: suspended });
            const mine = await repos.memberships.mine();
            return (await userViews([userId], await adminAgencyIds(mine)))[0]!;
        },
        grantSuperAdmin: (userId) => rpcVoid('grant_super_admin', { p_user_id: userId }),
        revokeSuperAdmin: (userId) => rpcVoid('revoke_super_admin', { p_user_id: userId }),
        assignAgencyRole: (agencyId, userId, role) => rpcVoid('assign_agency_role', { p_agency_id: agencyId, p_user_id: userId, p_role: role }),
        revokeAgencyRole: (agencyId, userId) => rpcVoid('revoke_agency_role', { p_agency_id: agencyId, p_user_id: userId }),
        async inviteAgencyUser(agencyId, input) {
            const created = await repos.invitations.createForAgency(agencyId, input.email, input.role);
            if (!server.deliverInvitation) throw new NotAvailableError('Invitation email delivery (user-invite Edge Function)');
            await server.deliverInvitation({ kind: 'agency', invitationId: created.id, token: created.token });
            const invitation = (await repos.invitations.listForAgency(agencyId)).find((i) => i.id === created.id)!;
            return { invitation };
        },
        agencyInvitations: (agencyId) => repos.invitations.listForAgency(agencyId),
        revokeAgencyInvitation: (invitationId) => repos.invitations.revokeForAgency(invitationId),
        acceptAgencyInvitation: (token) => repos.memberships.acceptAgencyInvitation(token),
        async setClientPermissions(brandId, membershipId, permissions) {
            await require(brandId, 'admin');
            const m = (await repos.memberships.forClient(brandId)).find((x) => x.id === membershipId);
            if (!m) throw new AccessDeniedError();
            if (m.role !== 'client') throw new ValidationError({ permissions: 'Permissions apply to client users only.' });
            await repos.memberships.setClientPermissions(membershipId, permissions);
        },
        async audit(filter = {}) {
            const mine = await repos.memberships.mine();
            const scope = await adminAgencyIds(mine);
            if (!scope.size || (filter.agencyId && !scope.has(filter.agencyId))) throw new AccessDeniedError();
            const rows = await repos.audit.list(filter);
            const people = new Map((await repos.profiles.byIds([...new Set(rows.flatMap((r) => [r.actor_id, r.target_type === 'user' ? r.target_id : null]).filter((x): x is string => !!x))])).map((p) => [p.id, p.name]));
            const agencyName = new Map((await allPages((page) => repos.agencies.list({ page, pageSize: MAX_PAGE_SIZE }))).map((a) => [a.id, a.name]));
            return rows.map((e) => ({
                id: e.id, actorName: (e.actor_id && people.get(e.actor_id)) || 'System', action: e.action, targetType: e.target_type,
                targetName: e.target_type === 'user' && e.target_id ? people.get(e.target_id) ?? null : null, agencyName: e.agency_id ? agencyName.get(e.agency_id) ?? null : null, createdAt: e.created_at,
            }));
        },
        home: () => resolveHome(repos),
    };

    // ── Client workspace data ─────────────────────────────────────────────────
    const clients: ClientsApi = {
        list: async (brandId) => (await require(brandId, 'read'), repos.innerClients.list(brandId)),
        get: async (brandId, id) => (await require(brandId, 'read'), repos.innerClients.get(brandId, id)),
        create: async (brandId, input) => (await require(brandId, 'write'), repos.innerClients.create(brandId, input)),
        update: async (brandId, id, input) => (await require(brandId, 'write'), repos.innerClients.update(brandId, id, input)),
        remove: async (brandId, id) => (await require(brandId, 'admin'), repos.innerClients.remove(brandId, id)),
    };

    /** A website id is only accepted together with the client it belongs to. */
    const websiteOf = async (brandId: T.ID, id: T.ID) => {
        const w = await repos.websites.byId(id);
        if (w.brandId !== brandId) throw new AccessDeniedError();
        return w;
    };

    const websites: WebsitesApi = {
        async list(brandId, filter = {}) {
            await require(brandId, 'read');
            const list = await repos.websites.listByClient(brandId, { includeArchived: filter.includeArchived });
            return filter.clientId ? list.filter((w) => w.clientId === filter.clientId) : list;
        },
        get: async (brandId, id) => (await require(brandId, 'read'), websiteOf(brandId, id)),
        create: async (brandId, input) => (await require(brandId, 'write'), repos.websites.create(brandId, input)),
        async update(brandId, id, input) {
            await require(brandId, 'write');
            await websiteOf(brandId, id);
            return repos.websites.update(id, input);
        },
        async remove(brandId, id) {
            await require(brandId, 'admin');
            await websiteOf(brandId, id);
            await repos.websites.remove(id);
        },
    };

    const members: MembersApi = {
        async list(brandId) {
            await require(brandId, 'staff');
            const rows = await repos.memberships.forClient(brandId);
            const [people, inner] = await Promise.all([repos.profiles.byIds(rows.map((m) => m.userId)), repos.innerClients.list(brandId)]);
            const person = new Map(people.map((p) => [p.id, p]));
            const innerName = new Map(inner.map((c) => [c.id, c.name]));
            return rows.map((m): MemberView => ({ ...m, name: person.get(m.userId)?.name ?? 'Unknown user', email: person.get(m.userId)?.email ?? '', clientName: m.clientId ? innerName.get(m.clientId) ?? null : null }));
        },
        async updateRole(brandId, membershipId, role, clientId) {
            const a = await require(brandId, 'admin');
            if (!a.assignableRoles.includes(role)) throw new AccessDeniedError('You cannot grant this role.');
            if (!(await repos.memberships.forClient(brandId)).some((m) => m.id === membershipId)) throw new AccessDeniedError();
            await repos.memberships.updateClientMembership(membershipId, { role, clientId: role === 'client' ? clientId ?? null : null });
            return (await members.list(brandId)).find((m) => m.id === membershipId)!;
        },
        async remove(brandId, membershipId) {
            await require(brandId, 'admin');
            if (!(await repos.memberships.forClient(brandId)).some((m) => m.id === membershipId)) throw new AccessDeniedError();
            await repos.memberships.removeClientMembership(membershipId);
        },
    };

    const invitations: InvitationsApi = {
        list: async (brandId) => (await require(brandId, 'admin'), repos.invitations.list(brandId)),
        async send(brandId, input) {
            await require(brandId, 'admin');
            const created = await repos.invitations.create(brandId, input);
            if (!server.deliverInvitation) throw new NotAvailableError('Invitation email delivery (user-invite Edge Function)');
            await server.deliverInvitation({ kind: 'client', invitationId: created.id, token: created.token });
            return { invitation: (await repos.invitations.list(brandId)).find((i) => i.id === created.id)! };
        },
        cancel: async (brandId, id) => (await require(brandId, 'admin'), repos.invitations.cancel(brandId, id)),
        preview: (token) => repos.memberships.previewInvitation(token),
        accept: (token) => repos.memberships.acceptInvitation(token),
    };

    const integrations: IntegrationsApi = {
        async list(brandId) {
            await require(brandId, 'read');
            const [rows, sites] = await Promise.all([repos.integrations.listByClient(brandId), repos.websites.listByClient(brandId, { includeArchived: true })]);
            const siteName = new Map(sites.map((w) => [w.id, w.name]));
            // Only the legacy contract fields: never `credentialConfigured`, configs or secrets.
            return rows.map((i) => ({
                id: i.id, brandId: i.brandId, clientId: i.clientId, websiteId: i.websiteId, provider: i.provider as T.IntegrationProvider, status: legacyStatus(i.status),
                externalAccountName: i.externalAccountName, externalPropertyName: i.externalPropertyName, lastSyncedAt: i.lastSyncedAt, lastErrorMessage: i.lastErrorMessage,
                createdAt: i.createdAt, websiteName: siteName.get(i.websiteId) ?? '',
            }));
        },
        async connect(brandId) {
            await require(brandId, 'admin');
            throw new NotAvailableError('Connecting an integration from this page (use the website’s Integrations panel: Google sign-in runs server-side)');
        },
        async sync(brandId) {
            await require(brandId, 'write');
            throw new NotAvailableError('Manual sync (integration-sync Edge Function)');
        },
        async disconnect(brandId, id) {
            await require(brandId, 'admin');
            const row = (await repos.integrations.listByClient(brandId)).find((i) => i.id === id);
            if (!row) throw new AccessDeniedError();
            if (!server.disconnectIntegration) throw new NotAvailableError('Disconnecting (integration-sync Edge Function)');
            await server.disconnectIntegration(row.websiteId, row.provider);
            const after = (await repos.integrations.listByClient(brandId)).find((i) => i.id === id) ?? row;
            return (await integrations.list(brandId)).find((i) => i.id === after.id)!;
        },
        async remove(brandId, id) {
            await require(brandId, 'admin');
            const { count, error } = await db.delete('integrations', [eq('brand_id', brandId), eq('id', id)]);
            if (error) fail(error);
            if (count !== 1) throw new AccessDeniedError();
        },
        async completeGoogleAuthorization(query) {
            if (!server.completeGoogle) throw new NotAvailableError('Google sign-in (integration-google Edge Function)');
            const r = await server.completeGoogle(query);
            // The website must be one this user can see; its client gives the return URL.
            const site = await repos.websites.byId(r.websiteId);
            const brand = await repos.clients.byId(site.brandId);
            return { websiteId: site.id, provider: r.provider, returnPath: `${clientBase(brand)}/websites/${site.id}` };
        },
    };

    // ── Agents (read) and chat ────────────────────────────────────────────────
    const agents: AgentsApi = Object.assign(notConnected<AgentsApi>('Agent administration', 'admin'), {
        templates: () => structuredClone(AGENT_TEMPLATES),
        /** Staff: all agents. Client Users with ai_chat: client-facing ones only (RLS returns no others). */
        async list(brandId: T.ID) {
            const a = await chatAccess(brandId);
            const order = AGENT_TEMPLATES.map((t) => t.key);
            const list = (await repos.agents.list(brandId)).filter((x) => a.can.staff || x.clientFacing);
            return list.sort((x, y) => order.indexOf(x.templateKey) - order.indexOf(y.templateKey));
        },
        get: async (brandId: T.ID, id: T.ID) => (await require(brandId, 'staff'), repos.agents.get(brandId, id)),
    });

    /** Staff, or a Client User holding ai_chat (who may only use client-shared conversations). */
    async function chatAccess(brandId: T.ID) {
        const a = await access(brandId);
        if (a.can.staff) return a;
        if (a.role === 'client' && a.clientPermissions.includes('ai_chat')) return a;
        throw new AccessDeniedError();
    }

    const conversationOf = async (brandId: T.ID, id: T.ID) => {
        const c = await repos.conversations.byId(id);
        if (c.brandId !== brandId) throw new AccessDeniedError();
        return c;
    };

    async function scopedWebsite(brandId: T.ID, websiteId: T.ID | null | undefined) {
        if (!websiteId) return null;
        return (await websiteOf(brandId, websiteId)).id;
    }

    async function sendAndRun(brandId: T.ID, conversationId: T.ID, body: string) {
        const message = await repos.messages.send({ brandId, conversationId, body });
        if (server.runAgents) await server.runAgents(message.id);
        return { message, replies: await repos.messages.replies(message.id) };
    }

    const chat: ChatApi = {
        async list(brandId, filter = {}) {
            await chatAccess(brandId);
            const all = await allPages((page) => repos.conversations.listByClient(brandId, { includeArchived: filter.includeArchived, page, pageSize: MAX_PAGE_SIZE }));
            const list = filter.kind ? all.filter((c) => c.kind === filter.kind) : all;
            return Promise.all(list.map(async (c): Promise<ConversationSummary> => {
                const { last, count } = await repos.messages.latest(c.id);
                return { ...c, lastMessage: last, messageCount: count };
            }));
        },
        get: async (brandId, id) => (await chatAccess(brandId), conversationOf(brandId, id)),
        async createDirect(brandId, agentInstanceId, title, opts = {}) {
            const a = await chatAccess(brandId);
            const agent = await repos.agents.get(brandId, agentInstanceId);
            if (!a.can.staff && !agent.clientFacing) throw new AccessDeniedError();
            const visibility = a.role === 'client' ? 'client_shared' : opts.visibility ?? 'agency_internal';
            return repos.conversations.create({
                brandId, kind: 'direct', title: title?.trim() || `Chat with ${agent.displayName}`, agentInstanceIds: [agent.id], visibility,
                websiteId: await scopedWebsite(brandId, opts.websiteId),
            });
        },
        async createGroup(brandId, { team, title, websiteId, visibility = 'agency_internal' }) {
            await require(brandId, 'write');
            if (!(team in TEAM_TITLES)) throw new ValidationError({ team: 'Unknown team.' });
            const teamAgents = (await repos.agents.list(brandId)).filter((x) => x.active && (team === 'all' || templateByKey(x.templateKey).team === team));
            if (!teamAgents.length) throw new ValidationError({ team: 'This team has no agents in this client.' });
            return repos.conversations.create({
                brandId, kind: 'group', title: title?.trim() || TEAM_TITLES[team], agentInstanceIds: teamAgents.map((x) => x.id), teamKey: team, visibility,
                websiteId: await scopedWebsite(brandId, websiteId),
            });
        },
        async setVisibility(brandId, id, visibility) {
            await require(brandId, 'staff');
            await conversationOf(brandId, id);
            const { rows, error } = await db.update('conversations', { visibility }, [eq('id', id)], ['id']);
            if (error) fail(error);
            if (rows.length !== 1) throw new AccessDeniedError();
            return conversationOf(brandId, id);
        },
        async messages(brandId, conversationId) {
            await chatAccess(brandId);
            await conversationOf(brandId, conversationId);
            const out: T.Message[] = [];
            let before: string | undefined;
            for (;;) {
                const page = await repos.messages.list(conversationId, { before, limit: MAX_PAGE_SIZE });
                out.unshift(...page.items);
                if (!page.hasMore || !page.items.length) return out;
                before = page.items[0]!.createdAt;
            }
        },
        async send(brandId, conversationId, input) {
            await chatAccess(brandId);
            await conversationOf(brandId, conversationId);
            if (input.attachments?.length) throw new NotAvailableError('Chat attachments');
            return sendAndRun(brandId, conversationId, input.body);
        },
        async retry(brandId, conversationId, failedMessageId) {
            await chatAccess(brandId);
            await conversationOf(brandId, conversationId);
            const failed = (await chat.messages(brandId, conversationId)).find((m) => m.id === failedMessageId);
            if (!failed?.replyToId) throw new ValidationError({ message: 'Only failed agent replies can be retried.' });
            if (!server.runAgents) throw new NotAvailableError('Agent runs (agent-execute Edge Function)');
            await server.runAgents(failed.replyToId);
            const all = await chat.messages(brandId, conversationId);
            return { message: all.find((m) => m.id === failed.replyToId)!, replies: await repos.messages.replies(failed.replyToId) };
        },
        async rename(brandId, id, title) {
            await chatAccess(brandId);
            await conversationOf(brandId, id);
            return repos.conversations.update(id, { title });
        },
        async archive(brandId, id, archived) {
            await chatAccess(brandId);
            await conversationOf(brandId, id);
            return repos.conversations.update(id, { archived });
        },
        async search(brandId, query) {
            await chatAccess(brandId);
            const term = query.trim();
            if (term.length < 2) return [];
            const hits = await repos.messages.search(brandId, term);
            const titles = new Map<string, string>();
            for (const id of new Set(hits.map((m) => m.conversationId))) titles.set(id, (await repos.conversations.byId(id)).title);
            return hits.map((m) => ({ conversationId: m.conversationId, conversationTitle: titles.get(m.conversationId) ?? '', message: m }));
        },
        async dismissProposal(brandId) {
            await chatAccess(brandId);
            throw new NotAvailableError('Dismissing agent proposals');
        },
        async summarize(brandId) {
            await chatAccess(brandId);
            throw new NotAvailableError('Conversation summaries');
        },
    };

    // ── Work ──────────────────────────────────────────────────────────────────
    const projectOf = async (brandId: T.ID, id: T.ID) => {
        const p = await repos.projects.byId(id);
        if (p.brandId !== brandId) throw new AccessDeniedError();
        return p;
    };
    const taskOf = async (brandId: T.ID, id: T.ID) => {
        const t = await repos.tasks.byId(id);
        if (t.brandId !== brandId) throw new AccessDeniedError();
        return t;
    };

    const work: WorkApi = {
        async projects(brandId) {
            const a = await access(brandId);
            if (!a.can.staff && a.role !== 'client') throw new AccessDeniedError();
            const [projects, tasks] = await Promise.all([
                allPages((page) => repos.projects.listByClient(brandId, { page, pageSize: MAX_PAGE_SIZE })),
                allPages((page) => repos.tasks.listByClient(brandId, { page, pageSize: MAX_PAGE_SIZE })),
            ]);
            return projects.map((p) => {
                const taskCounts: Record<T.TaskStatus, number> = { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
                for (const t of tasks) if (t.projectId === p.id) taskCounts[t.status]++;
                return { ...p, taskCounts };
            });
        },
        createProject: async (brandId, input) => (await require(brandId, 'write'), repos.projects.create(brandId, input)),
        async updateProject(brandId, id, input) {
            await require(brandId, 'write');
            await projectOf(brandId, id);
            return repos.projects.update(id, input);
        },
        async removeProject(brandId, id) {
            await require(brandId, 'admin');
            await projectOf(brandId, id);
            await repos.projects.remove(id);
        },
        async tasks(brandId, filters = {}) {
            const a = await access(brandId);
            if (!a.can.staff && a.role !== 'client') throw new AccessDeniedError();
            const all = await allPages((page) => repos.tasks.listByClient(brandId, { projectId: filters.projectId, status: filters.status, page, pageSize: MAX_PAGE_SIZE }));
            return all.filter((t) =>
                (!filters.userId || (t.assignee?.type === 'user' && t.assignee.userId === filters.userId))
                && (!filters.agentInstanceId || (t.assignee?.type === 'agent' && t.assignee.agentInstanceId === filters.agentInstanceId)));
        },
        async createTask(brandId, input) {
            await require(brandId, 'write');
            await projectOf(brandId, input.projectId);
            return repos.tasks.create(brandId, input);
        },
        async updateTask(brandId, id, input) {
            await require(brandId, 'write');
            await taskOf(brandId, id);
            if (input.projectId) await projectOf(brandId, input.projectId);
            return repos.tasks.update(id, input);
        },
        async removeTask(brandId, id) {
            await require(brandId, 'write');
            await taskOf(brandId, id);
            await repos.tasks.remove(id);
        },
        async comments(brandId, taskId) {
            await taskOf(brandId, taskId);
            const list = await repos.comments.list(brandId, taskId);
            const names = new Map((await repos.profiles.byIds(list.map((c) => c.authorId))).map((p) => [p.id, p.name]));
            return list.map((c) => ({ ...c, authorName: names.get(c.authorId) ?? 'Team member' }));
        },
        async addComment(brandId, taskId, body) {
            await taskOf(brandId, taskId);
            return repos.comments.add(brandId, taskId, body);
        },
        approvals: (brandId) => notConnected<WorkApi>('Approvals', 'staff').approvals(brandId),
        requestApproval: (brandId, input) => notConnected<WorkApi>('Approvals', 'write').requestApproval(brandId, input),
        decideApproval: (brandId, id, d, n) => notConnected<WorkApi>('Approvals', 'admin').decideApproval(brandId, id, d, n),
        cancelApproval: (brandId, id) => notConnected<WorkApi>('Approvals', 'write').cancelApproval(brandId, id),
        applyProposal: (brandId, m, p) => notConnected<WorkApi>('Agent proposals', 'write').applyProposal(brandId, m, p),
    };

    return {
        workspace, agencies, users, clients, websites, members, invitations, integrations, agents, chat, work,
        analytics: notConnected('Analytics (GA4/Search Console sync)', 'read'),
        insights: notConnected('SEO insights', 'read'),
        reports: notConnected('Reports', 'read'),
        automation: notConnected('Automation', 'admin'),
        intelligence: notConnected('SEO intelligence', 'staff'),
        studio: notConnected('Web Studio', 'staff'),
        knowledge: notConnected('Knowledge base', 'staff'),
        ai: notConnected('AI provider settings', 'staff'),
        // The VCA demo dataset exists only in the local mock adapter; staging never receives it.
        demo: Object.assign(notConnected<BrandApi['demo']>('Demo dataset', 'read'), { status: async () => ({ available: false, rows: 0, endDate: null }) }),
    };
}

function monthStartIso() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Client URL for a BrandAccess (re-exported for the boot path). */
export const brandHome = (a: BrandAccess) => `${clientBase(a.brand)}/dashboard`;
