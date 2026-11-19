/**
 * Supabase repositories (Phase 17F): agencies, clients, websites, memberships, profiles,
 * integration connections, conversations, messages, projects and tasks.
 *
 * - Rows map to the existing domain types (src/domain/types.ts); no second data model.
 * - Every query runs as the signed-in user through `DbPort`; RLS decides visibility. A record
 *   RLS hides is reported as AccessDeniedError (the same answer for "missing" and "not yours",
 *   so ids of other tenants cannot be probed).
 * - Failures map to the app's error classes. A transport failure is a ServiceError: never an
 *   empty list and never mock data.
 * - Writes send only the columns the migrations grant to `authenticated`. Integrations are
 *   read-only here (their writes go through the integration Edge Functions).
 */
import type * as T from '@/domain/types';
import type { PlanKey } from '@/domain/plans';
import type { AgencyClientInput, AgencyInput, WebsiteInput } from '@/data/contracts';
import { AccessDeniedError, assertValid, ServiceError, ValidationError } from '@/data/errors';
import { isAgencyAdminRole } from '@/data/access';
import { clientBase } from '@/app/paths';
import { normalizeWebsiteUrl } from '@/domain/websites';
import { slugify } from '@/lib/utils';
import type {
    IntegrationErrorCategory,
    IntegrationProvider as ConnectionProvider,
    IntegrationStatus as ConnectionStatus,
} from '../../../../../supabase/functions/_shared/integrations/types.ts';
import { contains, eq, inList, lt, type DbError, type DbPort, type Filter } from './dbPort';

// ── Paging and errors ──────────────────────────────────────────────────────

export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface PageRequest {
    /** 1-based. */
    page?: number;
    pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function pageRange({ page = 1, pageSize = DEFAULT_PAGE_SIZE }: PageRequest = {}) {
    const size = Math.min(Math.max(Math.trunc(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const p = Math.max(Math.trunc(page) || 1, 1);
    return { page: p, pageSize: size, from: (p - 1) * size, to: p * size - 1 };
}

/** Maps a database error to the app's error classes. Raw messages are never surfaced. */
export function toAppError(error: DbError, field = 'form'): Error {
    switch (error.code) {
        case '42501': // RLS or privilege
            return new AccessDeniedError();
        case '23505':
            return new ValidationError({ [field]: 'This value is already in use.' });
        case '23502':
        case '23503':
        case '23514':
        case '22001':
        case '22P02':
        case 'P0001':
            return new ValidationError({ [field]: 'Some values are not valid.' });
        default:
            if (error.status === 401 || error.status === 403) return new AccessDeniedError();
            return new ServiceError();
    }
}

const fail = (error: DbError, field?: string): never => {
    throw toAppError(error, field);
};

// ── Rows and mappers ───────────────────────────────────────────────────────

const AGENCY_COLS = ['id', 'name', 'slug', 'plan_key', 'description', 'logo_url', 'status', 'timezone', 'default_currency', 'contact_email', 'created_at', 'updated_at', 'archived_at'] as const;
interface AgencyRow {
    id: string; name: string; slug: string; plan_key: string; description: string; logo_url: string | null; status: T.AgencyStatus;
    timezone: string; default_currency: string; contact_email: string | null; created_at: string; updated_at: string; archived_at: string | null;
}
const toAgency = (r: AgencyRow): T.Agency => ({
    id: r.id, name: r.name, slug: r.slug, planKey: r.plan_key as PlanKey, description: r.description, logoUrl: r.logo_url, status: r.status,
    timezone: r.timezone, defaultCurrency: r.default_currency.trim(), contactEmail: r.contact_email,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), archivedAt: isoOrNull(r.archived_at),
});

const BRAND_COLS = ['id', 'agency_id', 'name', 'slug', 'status', 'description', 'display_name', 'industry', 'logo_url', 'primary_contact_name', 'primary_contact_email', 'timezone', 'currency', 'color', 'created_at', 'archived_at'] as const;
interface BrandRow {
    id: string; agency_id: string; name: string; slug: string; status: T.LifecycleStatus; description: string; display_name: string | null; industry: string | null;
    logo_url: string | null; primary_contact_name: string | null; primary_contact_email: string | null; timezone: string; currency: string; color: string;
    created_at: string; archived_at: string | null;
}
const toBrand = (r: BrandRow, agencySlug: string): T.Brand => ({
    id: r.id, agencyId: r.agency_id, agencySlug, name: r.name, slug: r.slug, status: r.status, description: r.description, displayName: r.display_name,
    industry: r.industry, logoUrl: r.logo_url, primaryContactName: r.primary_contact_name, primaryContactEmail: r.primary_contact_email,
    timezone: r.timezone, currency: r.currency.trim(), color: r.color, createdAt: iso(r.created_at), archivedAt: isoOrNull(r.archived_at),
});

const WEBSITE_COLS = ['id', 'brand_id', 'client_id', 'name', 'domain', 'website_url', 'environment', 'platform', 'status', 'is_primary', 'description', 'primary_conversion', 'ga4_property_id', 'gsc_site_url', 'created_at', 'archived_at', 'is_demo'] as const;
interface WebsiteRow {
    id: string; brand_id: string; client_id: string | null; name: string; domain: string | null; website_url: string | null; environment: T.WebsiteEnvironment;
    platform: T.WebsitePlatform; status: T.LifecycleStatus; is_primary: boolean; description: string; primary_conversion: string | null;
    ga4_property_id: string | null; gsc_site_url: string | null; created_at: string; archived_at: string | null; is_demo: boolean;
}
const toWebsite = (r: WebsiteRow): T.Website => ({
    id: r.id, brandId: r.brand_id, clientId: r.client_id, name: r.name, domain: r.domain, websiteUrl: r.website_url, environment: r.environment, platform: r.platform,
    status: r.status, isPrimary: r.is_primary, description: r.description, primaryConversion: r.primary_conversion, ga4PropertyId: r.ga4_property_id,
    gscSiteUrl: r.gsc_site_url, createdAt: iso(r.created_at), archivedAt: isoOrNull(r.archived_at), isDemo: r.is_demo,
});

const AGENCY_MEMBERSHIP_COLS = ['id', 'agency_id', 'user_id', 'role', 'job_function'] as const;
interface AgencyMembershipRow { id: string; agency_id: string; user_id: string; role: T.AgencyRole; job_function: T.JobFunction | null }
const toAgencyMembership = (r: AgencyMembershipRow): T.AgencyMembership => ({ id: r.id, agencyId: r.agency_id, userId: r.user_id, role: r.role, jobFunction: r.job_function });

const BRAND_MEMBERSHIP_COLS = ['id', 'brand_id', 'user_id', 'role', 'client_id', 'department', 'job_function', 'permissions', 'joined_at'] as const;
interface BrandMembershipRow {
    id: string; brand_id: string; user_id: string; role: T.BrandRole; client_id: string | null; department: string | null;
    job_function: T.JobFunction | null; permissions: T.ClientPermission[]; joined_at: string;
}
const toBrandMembership = (r: BrandMembershipRow): T.BrandMembership => ({
    id: r.id, brandId: r.brand_id, userId: r.user_id, role: r.role, clientId: r.client_id, department: r.department, jobFunction: r.job_function,
    permissions: r.permissions ?? [], joinedAt: iso(r.joined_at),
});

const PROFILE_COLS = ['id', 'name', 'email', 'deactivated_at'] as const;
interface ProfileRow { id: string; name: string; email: string; deactivated_at: string | null }
const toUser = (r: ProfileRow): T.User => ({ id: r.id, name: r.name, email: r.email, deactivatedAt: isoOrNull(r.deactivated_at) });

/** A website's connection to an external service, as stored in `integrations` (v7, migration 0010). Credentials are never selected. */
export interface IntegrationConnection extends Omit<T.Integration, 'provider' | 'status'> {
    provider: ConnectionProvider;
    status: ConnectionStatus;
    label: string;
    authMethod: 'none' | 'application_password' | 'oauth2';
    /** Whether a credential is stored server-side; the credential itself never reaches the browser. */
    credentialConfigured: boolean;
    externalPropertyId: string | null;
    lastSuccessAt: T.ISODate | null;
    lastFailureAt: T.ISODate | null;
    errorCategory: IntegrationErrorCategory | null;
    enabled: boolean;
    syncIntervalMinutes: number;
    updatedAt: T.ISODate;
}
const INTEGRATION_COLS = [
    'id', 'brand_id', 'client_id', 'website_id', 'provider', 'status', 'label', 'auth_method', 'credential_configured', 'external_account_name',
    'external_property_id', 'external_property_name', 'last_synced_at', 'last_success_at', 'last_failure_at', 'last_error_message', 'error_category',
    'enabled', 'sync_interval_minutes', 'created_at', 'updated_at',
] as const;
interface IntegrationRow {
    id: string; brand_id: string; client_id: string | null; website_id: string; provider: ConnectionProvider; status: ConnectionStatus; label: string;
    auth_method: IntegrationConnection['authMethod']; credential_configured: boolean; external_account_name: string | null; external_property_id: string | null;
    external_property_name: string | null; last_synced_at: string | null; last_success_at: string | null; last_failure_at: string | null;
    last_error_message: string | null; error_category: IntegrationErrorCategory | null; enabled: boolean; sync_interval_minutes: number; created_at: string; updated_at: string;
}
const toConnection = (r: IntegrationRow): IntegrationConnection => ({
    id: r.id, brandId: r.brand_id, clientId: r.client_id, websiteId: r.website_id, provider: r.provider, status: r.status, label: r.label, authMethod: r.auth_method,
    credentialConfigured: r.credential_configured, externalAccountName: r.external_account_name, externalPropertyId: r.external_property_id,
    externalPropertyName: r.external_property_name, lastSyncedAt: isoOrNull(r.last_synced_at), lastSuccessAt: isoOrNull(r.last_success_at),
    lastFailureAt: isoOrNull(r.last_failure_at), lastErrorMessage: r.last_error_message, errorCategory: r.error_category, enabled: r.enabled,
    syncIntervalMinutes: r.sync_interval_minutes, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

const CONVERSATION_COLS = ['id', 'brand_id', 'kind', 'title', 'agent_instance_ids', 'team_key', 'website_id', 'visibility', 'created_by', 'archived', 'summary', 'created_at', 'updated_at'] as const;
interface ConversationRow {
    id: string; brand_id: string; kind: T.ConversationKind; title: string; agent_instance_ids: string[]; team_key: T.TeamKey | null; website_id: string | null;
    visibility: T.ConversationVisibility; created_by: string; archived: boolean; summary: string | null; created_at: string; updated_at: string;
}
const toConversation = (r: ConversationRow): T.Conversation => ({
    id: r.id, brandId: r.brand_id, kind: r.kind, title: r.title, agentInstanceIds: r.agent_instance_ids ?? [], teamKey: r.team_key, websiteId: r.website_id,
    visibility: r.visibility, createdBy: r.created_by, archived: r.archived, summary: r.summary, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

const MESSAGE_COLS = ['id', 'brand_id', 'conversation_id', 'author_type', 'author_user_id', 'author_agent_id', 'body', 'mentions', 'attachments', 'status', 'execution_id', 'mode', 'proposals', 'reply_to_id', 'created_at'] as const;
interface MessageRow {
    id: string; brand_id: string; conversation_id: string; author_type: T.Actor['type']; author_user_id: string | null; author_agent_id: string | null; body: string;
    mentions: string[]; attachments: T.Attachment[]; status: T.Message['status']; execution_id: string | null; mode: T.ExecutionMode | null; proposals: T.Proposal[];
    reply_to_id: string | null; created_at: string;
}
const actor = (type: T.Actor['type'], userId: string | null, agentId: string | null): T.Actor =>
    type === 'user' && userId ? { type: 'user', userId } : type === 'agent' && agentId ? { type: 'agent', agentInstanceId: agentId } : { type: 'system' };
const toMessage = (r: MessageRow): T.Message => ({
    id: r.id, brandId: r.brand_id, conversationId: r.conversation_id, author: actor(r.author_type, r.author_user_id, r.author_agent_id), body: r.body,
    mentions: r.mentions ?? [], attachments: r.attachments ?? [], status: r.status, executionId: r.execution_id, mode: r.mode, proposals: r.proposals ?? [],
    replyToId: r.reply_to_id, createdAt: iso(r.created_at),
});

const PROJECT_COLS = ['id', 'brand_id', 'name', 'description', 'status', 'website_id', 'client_visible', 'created_at'] as const;
interface ProjectRow { id: string; brand_id: string; name: string; description: string; status: T.Project['status']; website_id: string | null; client_visible: boolean; created_at: string }
const toProject = (r: ProjectRow): T.Project => ({
    id: r.id, brandId: r.brand_id, name: r.name, description: r.description, status: r.status, websiteId: r.website_id, clientVisible: r.client_visible, createdAt: iso(r.created_at),
});

const TASK_COLS = ['id', 'brand_id', 'project_id', 'title', 'description', 'status', 'priority', 'assignee_user_id', 'assignee_agent_id', 'created_by_type', 'created_by_id', 'source_message_id', 'due_date', 'created_at', 'updated_at'] as const;
interface TaskRow {
    id: string; brand_id: string; project_id: string; title: string; description: string; status: T.TaskStatus; priority: T.TaskPriority;
    assignee_user_id: string | null; assignee_agent_id: string | null; created_by_type: T.Actor['type']; created_by_id: string | null;
    source_message_id: string | null; due_date: string | null; created_at: string; updated_at: string;
}
const toTask = (r: TaskRow): T.Task => ({
    id: r.id, brandId: r.brand_id, projectId: r.project_id, title: r.title, description: r.description, status: r.status, priority: r.priority,
    assignee: r.assignee_user_id ? { type: 'user', userId: r.assignee_user_id } : r.assignee_agent_id ? { type: 'agent', agentInstanceId: r.assignee_agent_id } : null,
    createdBy: actor(r.created_by_type, r.created_by_id, r.created_by_id), sourceMessageId: r.source_message_id, dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

/** PostgREST returns ISO strings; the Postgres test port may return Date objects. */
function iso(v: string | Date): string {
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}
const isoOrNull = (v: string | Date | null) => (v === null || v === undefined ? null : iso(v));

/** Drops undefined keys so an update only touches the fields the caller passed. */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const trimOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

// ── Repositories ───────────────────────────────────────────────────────────

export interface Repositories {
    agencies: ReturnType<typeof agencyRepo>;
    clients: ReturnType<typeof clientRepo>;
    websites: ReturnType<typeof websiteRepo>;
    memberships: ReturnType<typeof membershipRepo>;
    profiles: ReturnType<typeof profileRepo>;
    integrations: ReturnType<typeof integrationRepo>;
    conversations: ReturnType<typeof conversationRepo>;
    messages: ReturnType<typeof messageRepo>;
    projects: ReturnType<typeof projectRepo>;
    tasks: ReturnType<typeof taskRepo>;
}

/** Repositories bound to one signed-in user (`userId` from the auth adapter, never from the browser URL). */
export function createRepositories(db: DbPort, userId: string): Repositories {
    const agencies = agencyRepo(db);
    const clients = clientRepo(db, agencies);
    return {
        agencies,
        clients,
        websites: websiteRepo(db, clients),
        memberships: membershipRepo(db, userId),
        profiles: profileRepo(db),
        integrations: integrationRepo(db, clients),
        conversations: conversationRepo(db, userId, clients),
        messages: messageRepo(db, userId),
        projects: projectRepo(db, clients),
        tasks: taskRepo(db, userId, clients),
    };
}

async function selectAll<R>(db: DbPort, table: string, columns: readonly string[], filters: Filter[], order?: Array<{ column: string; ascending?: boolean }>) {
    const { rows, error } = await db.select<R>({ table, columns, filters, order });
    if (error) fail(error);
    return rows;
}

async function selectPage<R>(db: DbPort, table: string, columns: readonly string[], filters: Filter[], order: Array<{ column: string; ascending?: boolean }>, req: PageRequest) {
    const r = pageRange(req);
    const { rows, count, error } = await db.select<R>({ table, columns, filters, order, range: { from: r.from, to: r.to }, count: true });
    if (error) fail(error);
    return { rows, total: count ?? rows.length, page: r.page, pageSize: r.pageSize };
}

/** One row RLS lets the caller see, or AccessDeniedError (hidden and missing look the same). */
async function selectOne<R>(db: DbPort, table: string, columns: readonly string[], filters: Filter[]): Promise<R> {
    const rows = await selectAll<R>(db, table, columns, filters);
    if (rows.length !== 1) throw new AccessDeniedError();
    return rows[0]!;
}

/**
 * Inserts with a client-generated id, then reads the row back with a normal select.
 * `insert … returning` cannot be used: several read policies (brands, conversations) look the
 * row up by id through a helper function, which does not see a row inserted by the same
 * statement, so Postgres (and PostgREST) refuse the RETURNING part with 42501.
 */
async function insertOne<R>(db: DbPort, table: string, row: Record<string, unknown>, columns: readonly string[], field?: string): Promise<R> {
    const id = newUuid();
    const { error } = await db.insert(table, { id, ...row }, []);
    if (error) fail(error, field);
    return selectOne<R>(db, table, columns, [eq('id', id)]);
}

const newUuid = () => globalThis.crypto.randomUUID();

/** An update RLS does not allow touches 0 rows: reported as AccessDeniedError, never as success. */
async function updateOne<R>(db: DbPort, table: string, id: string, patch: Record<string, unknown>, columns: readonly string[], field?: string): Promise<R> {
    const { rows, error } = await db.update<R>(table, patch, [eq('id', id)], columns);
    if (error) fail(error, field);
    if (rows.length !== 1) throw new AccessDeniedError();
    return rows[0]!;
}

function agencyRepo(db: DbPort) {
    return {
        async list(filter: { status?: T.AgencyStatus | 'all'; query?: string } & PageRequest = {}): Promise<Page<T.Agency>> {
            const filters: Filter[] = [];
            if (filter.status && filter.status !== 'all') filters.push(eq('status', filter.status));
            if (filter.query?.trim()) filters.push(contains('name', filter.query.trim()));
            const p = await selectPage<AgencyRow>(db, 'agencies', AGENCY_COLS, filters, [{ column: 'name' }], filter);
            return { ...p, items: p.rows.map(toAgency) };
        },
        async byId(id: string): Promise<T.Agency> {
            return toAgency(await selectOne<AgencyRow>(db, 'agencies', AGENCY_COLS, [eq('id', id)]));
        },
        async bySlug(slug: string): Promise<T.Agency> {
            return toAgency(await selectOne<AgencyRow>(db, 'agencies', AGENCY_COLS, [eq('slug', slug)]));
        },
        /** Slugs of the given agencies (for client URLs). Agencies RLS hides are simply absent. */
        async slugs(ids: string[]): Promise<Map<string, string>> {
            if (!ids.length) return new Map();
            const rows = await selectAll<{ id: string; slug: string }>(db, 'agencies', ['id', 'slug'], [inList('id', [...new Set(ids)])]);
            return new Map(rows.map((r) => [r.id, r.slug]));
        },
        /** Profile fields: agency owners/admins and Super Admins. Status: Super Admins only (trigger). */
        async update(id: string, patch: Partial<Omit<AgencyInput, 'slug'>> & { status?: T.AgencyStatus }): Promise<T.Agency> {
            const row = defined({
                name: patch.name?.trim(), description: patch.description, logo_url: trimOrNull(patch.logoUrl), timezone: patch.timezone,
                default_currency: patch.defaultCurrency, contact_email: trimOrNull(patch.contactEmail), status: patch.status,
            });
            return toAgency(await updateOne<AgencyRow>(db, 'agencies', id, row, AGENCY_COLS));
        },
    };
}

function clientRepo(db: DbPort, agencies: ReturnType<typeof agencyRepo>) {
    const withSlugs = async (rows: BrandRow[]) => {
        const slugs = await agencies.slugs(rows.map((r) => r.agency_id));
        // A client always belongs to an agency its reader can see (agencies_select covers client readers).
        return rows.map((r) => toBrand(r, slugs.get(r.agency_id) ?? ''));
    };
    return {
        /** Clients the caller can read, optionally of one agency. */
        async list(filter: { agencyId?: string; status?: T.LifecycleStatus | 'all'; query?: string } & PageRequest = {}): Promise<Page<T.Brand>> {
            const filters: Filter[] = [];
            if (filter.agencyId) {
                await agencies.byId(filter.agencyId); // denied, not empty, for an agency the caller cannot see
                filters.push(eq('agency_id', filter.agencyId));
            }
            if (filter.status && filter.status !== 'all') filters.push(eq('status', filter.status));
            if (filter.query?.trim()) filters.push(contains('name', filter.query.trim()));
            const p = await selectPage<BrandRow>(db, 'brands', BRAND_COLS, filters, [{ column: 'name' }], filter);
            return { ...p, items: await withSlugs(p.rows) };
        },
        async byId(id: string): Promise<T.Brand> {
            return (await withSlugs([await selectOne<BrandRow>(db, 'brands', BRAND_COLS, [eq('id', id)])]))[0]!;
        },
        async bySlug(agencySlug: string, slug: string): Promise<T.Brand> {
            const agency = await agencies.bySlug(agencySlug);
            return toBrand(await selectOne<BrandRow>(db, 'brands', BRAND_COLS, [eq('agency_id', agency.id), eq('slug', slug)]), agency.slug);
        },
        async create(agencyId: string, input: AgencyClientInput): Promise<T.Brand> {
            const name = input.name?.trim() ?? '';
            const slug = (input.slug?.trim() || slugify(name)).toLowerCase();
            assertValid({ name: (!name || name.length > 120) && 'A client name of 1–120 characters is required.', slug: !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) && 'Use lowercase letters, digits and hyphens.' });
            const row = defined({
                agency_id: agencyId, name, slug, description: input.description ?? '', display_name: trimOrNull(input.displayName), industry: trimOrNull(input.industry),
                logo_url: trimOrNull(input.logoUrl), primary_contact_name: trimOrNull(input.primaryContactName), primary_contact_email: trimOrNull(input.primaryContactEmail),
                status: input.status,
            });
            return (await withSlugs([await insertOne<BrandRow>(db, 'brands', row, BRAND_COLS, 'slug')]))[0]!;
        },
        async update(id: string, patch: Partial<Omit<AgencyClientInput, 'slug'>>): Promise<T.Brand> {
            const row = defined({
                name: patch.name?.trim(), description: patch.description, display_name: trimOrNull(patch.displayName), industry: trimOrNull(patch.industry),
                logo_url: trimOrNull(patch.logoUrl), primary_contact_name: trimOrNull(patch.primaryContactName), primary_contact_email: trimOrNull(patch.primaryContactEmail),
                status: patch.status,
            });
            return (await withSlugs([await updateOne<BrandRow>(db, 'brands', id, row, BRAND_COLS)]))[0]!;
        },
    };
}

function websiteFields(input: Partial<WebsiteInput>) {
    let url: string | null | undefined = input.websiteUrl === undefined ? undefined : null;
    if (input.websiteUrl) {
        const check = normalizeWebsiteUrl(input.websiteUrl);
        if (!check.ok) throw new ValidationError({ websiteUrl: check.error });
        url = check.url;
    }
    return defined({
        name: input.name?.trim(), website_url: url, environment: input.environment, platform: input.platform, status: input.status, is_primary: input.isPrimary,
        description: input.description, client_id: input.clientId, primary_conversion: trimOrNull(input.primaryConversion),
        ga4_property_id: trimOrNull(input.ga4PropertyId), gsc_site_url: trimOrNull(input.gscSiteUrl),
    });
}

function websiteRepo(db: DbPort, clients: ReturnType<typeof clientRepo>) {
    return {
        async listByClient(brandId: string, filter: { includeArchived?: boolean } = {}): Promise<T.Website[]> {
            await clients.byId(brandId);
            const filters: Filter[] = [eq('brand_id', brandId)];
            if (!filter.includeArchived) filters.push({ column: 'status', op: 'neq', value: 'archived' });
            return (await selectAll<WebsiteRow>(db, 'websites', WEBSITE_COLS, filters, [{ column: 'is_primary', ascending: false }, { column: 'name' }])).map(toWebsite);
        },
        async byId(id: string): Promise<T.Website> {
            return toWebsite(await selectOne<WebsiteRow>(db, 'websites', WEBSITE_COLS, [eq('id', id)]));
        },
        async create(brandId: string, input: WebsiteInput): Promise<T.Website> {
            assertValid({ name: !input.name?.trim() && 'A website name is required.' });
            // is_demo is never set from the app: demo records come from the dev seed only.
            return toWebsite(await insertOne<WebsiteRow>(db, 'websites', { brand_id: brandId, ...websiteFields(input) }, WEBSITE_COLS, 'websiteUrl'));
        },
        async update(id: string, patch: Partial<WebsiteInput>): Promise<T.Website> {
            return toWebsite(await updateOne<WebsiteRow>(db, 'websites', id, websiteFields(patch), WEBSITE_COLS, 'websiteUrl'));
        },
    };
}

export interface MyMemberships {
    platformAdmin: boolean;
    agency: T.AgencyMembership[];
    brand: T.BrandMembership[];
}

function membershipRepo(db: DbPort, userId: string) {
    return {
        /** The caller's own roles. Filtered by user id: admins can also see other people's rows. */
        async mine(): Promise<MyMemberships> {
            const [admins, agency, brand] = await Promise.all([
                selectAll<{ user_id: string }>(db, 'platform_admins', ['user_id'], [eq('user_id', userId)]),
                selectAll<AgencyMembershipRow>(db, 'agency_memberships', AGENCY_MEMBERSHIP_COLS, [eq('user_id', userId)]),
                selectAll<BrandMembershipRow>(db, 'brand_memberships', BRAND_MEMBERSHIP_COLS, [eq('user_id', userId)]),
            ]);
            return { platformAdmin: admins.length > 0, agency: agency.map(toAgencyMembership), brand: brand.map(toBrandMembership) };
        },
        async forClient(brandId: string): Promise<T.BrandMembership[]> {
            return (await selectAll<BrandMembershipRow>(db, 'brand_memberships', BRAND_MEMBERSHIP_COLS, [eq('brand_id', brandId)], [{ column: 'joined_at' }])).map(toBrandMembership);
        },
        async forAgency(agencyId: string): Promise<T.AgencyMembership[]> {
            return (await selectAll<AgencyMembershipRow>(db, 'agency_memberships', AGENCY_MEMBERSHIP_COLS, [eq('agency_id', agencyId)])).map(toAgencyMembership);
        },
        /** Client admins only (RLS + 0009 triggers); permissions apply to Client Users only. */
        async setClientPermissions(membershipId: string, permissions: T.ClientPermission[]): Promise<T.BrandMembership> {
            return toBrandMembership(await updateOne<BrandMembershipRow>(db, 'brand_memberships', membershipId, { permissions: [...new Set(permissions)] }, BRAND_MEMBERSHIP_COLS, 'permissions'));
        },
        async removeClientMembership(membershipId: string): Promise<void> {
            const { count, error } = await db.delete('brand_memberships', [eq('id', membershipId)]);
            if (error) fail(error);
            if (count !== 1) throw new AccessDeniedError();
        },
        async previewInvitation(token: string): Promise<{ brandName: string; brandSlug: string; role: T.BrandRole; email: string; status: T.InvitationStatus; expiresAt: T.ISODate }> {
            const { data, error } = await db.rpc<Array<{ brand_name: string; brand_slug: string; role: T.BrandRole; email: string; status: T.InvitationStatus; expires_at: string }>>('preview_invitation', { p_token: token });
            if (error) fail(error);
            const r = data?.[0];
            if (!r) throw new ValidationError({ token: 'This invitation link is not valid.' });
            return { brandName: r.brand_name, brandSlug: r.brand_slug, role: r.role, email: r.email, status: r.status, expiresAt: iso(r.expires_at) };
        },
        /** Runs the server-side checks (status, expiry, verified invited email) in `accept_invitation`. */
        async acceptInvitation(token: string): Promise<{ brandSlug: string }> {
            const { data, error } = await db.rpc<string>('accept_invitation', { p_token: token });
            if (error) fail(error, 'token');
            if (!data) throw new ServiceError();
            return { brandSlug: data };
        },
        async acceptAgencyInvitation(token: string): Promise<{ agencySlug: string }> {
            const { data, error } = await db.rpc<string>('accept_agency_invitation', { p_token: token });
            if (error) fail(error, 'token');
            if (!data) throw new ServiceError();
            return { agencySlug: data };
        },
    };
}

function profileRepo(db: DbPort) {
    return {
        /** A profile the caller may see (self, people they work with, or everyone for Super Admins). */
        async byId(id: string): Promise<T.User> {
            return toUser(await selectOne<ProfileRow>(db, 'profiles', PROFILE_COLS, [eq('id', id)]));
        },
        async byIds(ids: string[]): Promise<T.User[]> {
            if (!ids.length) return [];
            return (await selectAll<ProfileRow>(db, 'profiles', PROFILE_COLS, [inList('id', [...new Set(ids)])])).map(toUser);
        },
        async list(filter: { query?: string } & PageRequest = {}): Promise<Page<T.User>> {
            const filters = filter.query?.trim() ? [contains('email', filter.query.trim().toLowerCase())] : [];
            const p = await selectPage<ProfileRow>(db, 'profiles', PROFILE_COLS, filters, [{ column: 'email' }], filter);
            return { ...p, items: p.rows.map(toUser) };
        },
    };
}

function integrationRepo(db: DbPort, clients: ReturnType<typeof clientRepo>) {
    return {
        async listByClient(brandId: string): Promise<IntegrationConnection[]> {
            await clients.byId(brandId);
            return (await selectAll<IntegrationRow>(db, 'integrations', INTEGRATION_COLS, [eq('brand_id', brandId)], [{ column: 'created_at' }])).map(toConnection);
        },
        async listByWebsite(websiteId: string): Promise<IntegrationConnection[]> {
            return (await selectAll<IntegrationRow>(db, 'integrations', INTEGRATION_COLS, [eq('website_id', websiteId)], [{ column: 'created_at' }])).map(toConnection);
        },
    };
}

export interface ConversationInput {
    brandId: string;
    title: string;
    kind?: T.ConversationKind;
    visibility?: T.ConversationVisibility;
    websiteId?: string | null;
    agentInstanceIds?: string[];
    teamKey?: T.TeamKey | null;
}

function conversationRepo(db: DbPort, userId: string, clients: ReturnType<typeof clientRepo>) {
    return {
        /** Conversations the caller may read in this client (RLS: visibility rules of 0009). Newest first. */
        async listByClient(brandId: string, filter: { includeArchived?: boolean } & PageRequest = {}): Promise<Page<T.Conversation>> {
            await clients.byId(brandId);
            const filters: Filter[] = [eq('brand_id', brandId)];
            if (!filter.includeArchived) filters.push(eq('archived', false));
            const p = await selectPage<ConversationRow>(db, 'conversations', CONVERSATION_COLS, filters, [{ column: 'updated_at', ascending: false }, { column: 'id' }], filter);
            return { ...p, items: p.rows.map(toConversation) };
        },
        async byId(id: string): Promise<T.Conversation> {
            return toConversation(await selectOne<ConversationRow>(db, 'conversations', CONVERSATION_COLS, [eq('id', id)]));
        },
        async create(input: ConversationInput): Promise<T.Conversation> {
            const title = input.title.trim();
            assertValid({ title: (!title || title.length > 200) && 'A title of 1–200 characters is required.' });
            const row = defined({
                brand_id: input.brandId, title, kind: input.kind ?? 'direct', visibility: input.visibility ?? 'agency_internal', website_id: input.websiteId ?? undefined,
                agent_instance_ids: input.agentInstanceIds ?? [], team_key: input.teamKey ?? undefined, created_by: userId,
            });
            return toConversation(await insertOne<ConversationRow>(db, 'conversations', row, CONVERSATION_COLS));
        },
        async update(id: string, patch: { title?: string; archived?: boolean; summary?: string | null }): Promise<T.Conversation> {
            return toConversation(await updateOne<ConversationRow>(db, 'conversations', id, defined({ title: patch.title?.trim(), archived: patch.archived, summary: patch.summary }), CONVERSATION_COLS));
        },
    };
}

export const MESSAGE_PAGE_SIZE = 50;

function messageRepo(db: DbPort, userId: string) {
    return {
        /**
         * Keyset pagination, newest page first: pass the oldest `createdAt` you have as `before`
         * to load the previous page. Items come back oldest → newest for display.
         */
        async list(conversationId: string, opts: { before?: T.ISODate; limit?: number } = {}): Promise<{ items: T.Message[]; hasMore: boolean }> {
            const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1), MAX_PAGE_SIZE);
            const filters: Filter[] = [eq('conversation_id', conversationId)];
            if (opts.before) filters.push(lt('created_at', opts.before));
            const { rows, error } = await db.select<MessageRow>({
                table: 'messages', columns: MESSAGE_COLS, filters, order: [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }], range: { from: 0, to: limit },
            });
            if (error) fail(error);
            return { items: rows.slice(0, limit).map(toMessage).reverse(), hasMore: rows.length > limit };
        },
        /** A message authored by the caller. Agent and system messages come from Edge Functions only (RLS). */
        async send(input: { brandId: string; conversationId: string; body: string; mentions?: string[]; replyToId?: string | null }): Promise<T.Message> {
            const body = input.body.trim();
            assertValid({ body: (!body || body.length > 20000) && 'Write a message of up to 20,000 characters.' });
            const row = defined({
                brand_id: input.brandId, conversation_id: input.conversationId, author_type: 'user', author_user_id: userId, body,
                mentions: input.mentions ?? [], reply_to_id: input.replyToId ?? undefined,
            });
            return toMessage(await insertOne<MessageRow>(db, 'messages', row, MESSAGE_COLS));
        },
    };
}

function projectRepo(db: DbPort, clients: ReturnType<typeof clientRepo>) {
    return {
        async listByClient(brandId: string, filter: { status?: T.Project['status'] } & PageRequest = {}): Promise<Page<T.Project>> {
            await clients.byId(brandId);
            const filters: Filter[] = [eq('brand_id', brandId)];
            if (filter.status) filters.push(eq('status', filter.status));
            const p = await selectPage<ProjectRow>(db, 'projects', PROJECT_COLS, filters, [{ column: 'created_at', ascending: false }, { column: 'id' }], filter);
            return { ...p, items: p.rows.map(toProject) };
        },
        async byId(id: string): Promise<T.Project> {
            return toProject(await selectOne<ProjectRow>(db, 'projects', PROJECT_COLS, [eq('id', id)]));
        },
        async create(brandId: string, input: { name: string; description?: string; websiteId?: string | null; clientVisible?: boolean }): Promise<T.Project> {
            const name = input.name.trim();
            assertValid({ name: (!name || name.length > 200) && 'A project name of 1–200 characters is required.' });
            const row = defined({ brand_id: brandId, name, description: input.description ?? '', website_id: input.websiteId ?? undefined, client_visible: input.clientVisible ?? false });
            return toProject(await insertOne<ProjectRow>(db, 'projects', row, PROJECT_COLS));
        },
        async update(id: string, patch: { name?: string; description?: string; status?: T.Project['status']; clientVisible?: boolean; websiteId?: string | null }): Promise<T.Project> {
            const row = defined({ name: patch.name?.trim(), description: patch.description, status: patch.status, client_visible: patch.clientVisible, website_id: patch.websiteId });
            return toProject(await updateOne<ProjectRow>(db, 'projects', id, row, PROJECT_COLS));
        },
    };
}

export interface TaskInput {
    projectId: string;
    title: string;
    description?: string;
    priority?: T.TaskPriority;
    status?: T.TaskStatus;
    dueDate?: string | null;
    assignee?: T.Assignee;
}

const assigneeColumns = (a: T.Assignee | undefined) =>
    a === undefined ? {} : { assignee_user_id: a?.type === 'user' ? a.userId : null, assignee_agent_id: a?.type === 'agent' ? a.agentInstanceId : null };

function taskRepo(db: DbPort, userId: string, clients: ReturnType<typeof clientRepo>) {
    return {
        async listByClient(brandId: string, filter: { projectId?: string; status?: T.TaskStatus } & PageRequest = {}): Promise<Page<T.Task>> {
            await clients.byId(brandId);
            const filters: Filter[] = [eq('brand_id', brandId)];
            if (filter.projectId) filters.push(eq('project_id', filter.projectId));
            if (filter.status) filters.push(eq('status', filter.status));
            const p = await selectPage<TaskRow>(db, 'tasks', TASK_COLS, filters, [{ column: 'created_at', ascending: false }, { column: 'id' }], filter);
            return { ...p, items: p.rows.map(toTask) };
        },
        async byId(id: string): Promise<T.Task> {
            return toTask(await selectOne<TaskRow>(db, 'tasks', TASK_COLS, [eq('id', id)]));
        },
        async create(brandId: string, input: TaskInput): Promise<T.Task> {
            const title = input.title.trim();
            assertValid({ title: (!title || title.length > 300) && 'A task title of 1–300 characters is required.' });
            const row = defined({
                brand_id: brandId, project_id: input.projectId, title, description: input.description ?? '', priority: input.priority, status: input.status,
                due_date: input.dueDate ?? undefined, created_by_type: 'user', created_by_id: userId, ...assigneeColumns(input.assignee),
            });
            return toTask(await insertOne<TaskRow>(db, 'tasks', row, TASK_COLS));
        },
        async update(id: string, patch: Partial<Omit<TaskInput, 'projectId'>>): Promise<T.Task> {
            const row = defined({
                title: patch.title?.trim(), description: patch.description, priority: patch.priority, status: patch.status, due_date: patch.dueDate, ...assigneeColumns(patch.assignee),
            });
            return toTask(await updateOne<TaskRow>(db, 'tasks', id, row, TASK_COLS));
        },
    };
}

// ── Landing page (users.home in Supabase mode) ─────────────────────────────

export type HomeTarget = { path: string; reason: 'super_admin' | 'admin' | 'client_user' | 'member' | 'none' };

/**
 * Where the signed-in user lands. Same rules as the local adapter (src/data/local/users.ts),
 * computed only from rows RLS returns for this user.
 */
export async function resolveHome(repos: Repositories): Promise<HomeTarget> {
    const mine = await repos.memberships.mine();
    if (mine.platformAdmin) return { path: '/platform', reason: 'super_admin' };
    const adminAgencyIds = mine.agency.filter((m) => isAgencyAdminRole(m.role)).map((m) => m.agencyId);
    if (adminAgencyIds.length) {
        const visible = (await repos.agencies.list({ pageSize: MAX_PAGE_SIZE })).items.filter((a) => adminAgencyIds.includes(a.id) && a.status !== 'suspended');
        if (visible.length === 1) return { path: `/a/${visible[0]!.slug}`, reason: 'admin' };
        if (visible.length > 1) return { path: '/agencies', reason: 'admin' };
    }
    const readable = (await repos.clients.list({ pageSize: MAX_PAGE_SIZE })).items.filter((b) => b.status !== 'archived');
    if (!readable.length) return { path: '/access-pending', reason: 'none' };
    const clientRoles = new Set(mine.brand.filter((m) => m.role === 'client').map((m) => m.brandId));
    const clientOnly = mine.agency.length === 0 && readable.every((b) => clientRoles.has(b.id));
    if (readable.length === 1) return { path: `${clientBase(readable[0]!)}/dashboard`, reason: clientOnly ? 'client_user' : 'member' };
    return clientOnly ? { path: '/brands', reason: 'client_user' } : { path: '/agencies', reason: 'member' };
}
