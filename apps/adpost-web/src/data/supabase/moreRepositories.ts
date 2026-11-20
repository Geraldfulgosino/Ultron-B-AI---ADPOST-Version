/**
 * Supabase repositories for the remaining tables the application API needs: legacy inner
 * clients, agent instances (read-only in the browser), client invitations, agency invitations,
 * task comments and the platform audit log. Same rules as repositories.ts: RLS decides, hidden
 * rows are AccessDeniedError, outages are ServiceError, tokens and token hashes are never selected.
 */
import type * as T from '@/domain/types';
import type { AgencyInvitationView, ClientInput, InvitationView } from '@/data/contracts';
import { AccessDeniedError, assertValid } from '@/data/errors';
import { slugify } from '@/lib/utils';
import { eq, type DbPort } from './dbPort';
import { defined, fail, insertOne, iso, selectAll, selectOne, updateOne } from './repositories';

// ── Legacy inner clients (table `clients`, inside a client workspace) ─────

const INNER_CLIENT_COLS = ['id', 'brand_id', 'name', 'slug', 'status', 'timezone', 'currency', 'business_goals', 'created_at'] as const;
interface InnerClientRow { id: string; brand_id: string; name: string; slug: string; status: T.Client['status']; timezone: string; currency: string; business_goals: string | null; created_at: string }
const toInnerClient = (r: InnerClientRow): T.Client => ({
    id: r.id, brandId: r.brand_id, name: r.name, slug: r.slug, status: r.status, timezone: r.timezone, currency: r.currency.trim(), businessGoals: r.business_goals, createdAt: iso(r.created_at),
});

export function innerClientRepo(db: DbPort) {
    /** Scoped to `brandId` in the query itself, so an id from another client cannot be smuggled in. */
    const one = (brandId: string, id: string) => selectOne<InnerClientRow>(db, 'clients', INNER_CLIENT_COLS, [eq('brand_id', brandId), eq('id', id)]);
    return {
        async list(brandId: string): Promise<T.Client[]> {
            return (await selectAll<InnerClientRow>(db, 'clients', INNER_CLIENT_COLS, [eq('brand_id', brandId)], [{ column: 'name' }])).map(toInnerClient);
        },
        async get(brandId: string, id: string): Promise<T.Client> {
            return toInnerClient(await one(brandId, id));
        },
        async create(brandId: string, input: ClientInput): Promise<T.Client> {
            const name = input.name.trim();
            assertValid({ name: (!name || name.length > 120) && 'A name of 1–120 characters is required.' });
            const row = defined({ brand_id: brandId, name, slug: slugify(name), status: input.status, timezone: input.timezone, currency: input.currency, business_goals: input.businessGoals ?? undefined });
            return toInnerClient(await insertOne<InnerClientRow>(db, 'clients', row, INNER_CLIENT_COLS, 'name'));
        },
        async update(brandId: string, id: string, input: Partial<ClientInput>): Promise<T.Client> {
            await one(brandId, id);
            const row = defined({ name: input.name?.trim(), status: input.status, timezone: input.timezone, currency: input.currency, business_goals: input.businessGoals });
            return toInnerClient(await updateOne<InnerClientRow>(db, 'clients', id, row, INNER_CLIENT_COLS, 'name'));
        },
        async remove(brandId: string, id: string): Promise<void> {
            const { count, error } = await db.delete('clients', [eq('brand_id', brandId), eq('id', id)]);
            if (error) fail(error);
            if (count !== 1) throw new AccessDeniedError();
        },
    };
}

// ── Agent instances (read-only; provisioning and runs are server-side) ────

const AGENT_COLS = ['id', 'brand_id', 'template_key', 'display_name', 'handle', 'active', 'model_provider', 'model', 'active_instruction_version_id', 'tools', 'max_output_tokens', 'max_runs_per_day', 'monthly_budget_usd', 'client_facing', 'created_at', 'updated_at'] as const;
interface AgentRow {
    id: string; brand_id: string; template_key: T.AgentTemplateKey; display_name: string; handle: string; active: boolean; model_provider: T.ModelRef['provider']; model: string;
    active_instruction_version_id: string | null; tools: T.ToolKey[]; max_output_tokens: number; max_runs_per_day: number; monthly_budget_usd: string | number; client_facing: boolean;
    created_at: string; updated_at: string;
}
const toAgent = (r: AgentRow): T.AgentInstance => ({
    id: r.id, brandId: r.brand_id, templateKey: r.template_key, displayName: r.display_name, handle: r.handle, active: r.active, model: { provider: r.model_provider, model: r.model },
    activeInstructionVersionId: r.active_instruction_version_id ?? '', tools: r.tools ?? [],
    limits: { maxOutputTokens: r.max_output_tokens, maxRunsPerDay: r.max_runs_per_day, monthlyBudgetUsd: Number(r.monthly_budget_usd) },
    clientFacing: r.client_facing, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

export function agentRepo(db: DbPort) {
    return {
        /** RLS: staff see the client's agents; Client Users only client-facing ones (never instructions). */
        async list(brandId: string): Promise<T.AgentInstance[]> {
            return (await selectAll<AgentRow>(db, 'agent_instances', AGENT_COLS, [eq('brand_id', brandId)], [{ column: 'display_name' }])).map(toAgent);
        },
        async get(brandId: string, id: string): Promise<T.AgentInstance> {
            return toAgent(await selectOne<AgentRow>(db, 'agent_instances', AGENT_COLS, [eq('brand_id', brandId), eq('id', id)]));
        },
    };
}

// ── Client invitations (tokens are created and checked server-side; only hashes are stored) ──

const INVITATION_COLS = ['id', 'brand_id', 'email', 'role', 'client_id', 'invited_by', 'status', 'permissions', 'expires_at', 'created_at'] as const;
interface InvitationRow {
    id: string; brand_id: string; email: string; role: T.BrandRole; client_id: string | null; invited_by: string; status: T.InvitationStatus; permissions: T.ClientPermission[];
    expires_at: string; created_at: string;
}
const toInvitation = (r: InvitationRow, now: number): InvitationView => ({
    id: r.id, brandId: r.brand_id, email: r.email, role: r.role, clientId: r.client_id, invitedBy: r.invited_by,
    // Expiry is a fact of time: shown as expired even before anything rewrites the row.
    status: r.status === 'pending' && Date.parse(iso(r.expires_at)) < now ? 'expired' : r.status,
    permissions: r.permissions ?? [], expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
});

const AGENCY_INVITATION_COLS = ['id', 'agency_id', 'email', 'role', 'status', 'expires_at', 'created_at'] as const;
interface AgencyInvitationRow { id: string; agency_id: string; email: string; role: AgencyInvitationView['role']; status: AgencyInvitationView['status']; expires_at: string; created_at: string }

export function invitationRepo(db: DbPort, now: () => number = Date.now) {
    return {
        async list(brandId: string): Promise<InvitationView[]> {
            return (await selectAll<InvitationRow>(db, 'invitations', INVITATION_COLS, [eq('brand_id', brandId)], [{ column: 'created_at', ascending: false }])).map((r) => toInvitation(r, now()));
        },
        /** `create_invitation` checks the caller's authority and returns the token once, for delivery. */
        async create(brandId: string, input: { email: string; role: T.BrandRole; clientId?: string | null; permissions?: T.ClientPermission[] }): Promise<{ id: string; token: string; expiresAt: string }> {
            const { data, error } = await db.rpc<Array<{ invitation_id: string; token: string; expires_at: string }>>('create_invitation', {
                p_brand_id: brandId, p_email: input.email.trim().toLowerCase(), p_role: input.role, p_client_id: input.clientId ?? null, p_permissions: input.permissions ?? [],
            });
            if (error) fail(error, 'email');
            const r = data?.[0];
            if (!r) throw new AccessDeniedError();
            return { id: r.invitation_id, token: r.token, expiresAt: iso(r.expires_at) };
        },
        /** Only `status` is updatable, and only pending → cancelled by the client's admins (RLS). */
        async cancel(brandId: string, id: string): Promise<void> {
            await selectOne<InvitationRow>(db, 'invitations', ['id'], [eq('brand_id', brandId), eq('id', id)]);
            await updateOne(db, 'invitations', id, { status: 'cancelled' }, ['id']);
        },
        async listForAgency(agencyId: string): Promise<AgencyInvitationView[]> {
            const rows = await selectAll<AgencyInvitationRow>(db, 'agency_invitations', AGENCY_INVITATION_COLS, [eq('agency_id', agencyId)], [{ column: 'created_at', ascending: false }]);
            return rows.map((r) => ({ id: r.id, agencyId: r.agency_id, email: r.email, role: r.role, status: r.status, expiresAt: iso(r.expires_at), createdAt: iso(r.created_at) }));
        },
        async createForAgency(agencyId: string, email: string, role: 'agency_admin' | 'agency_manager'): Promise<{ id: string; token: string; expiresAt: string }> {
            const { data, error } = await db.rpc<Array<{ invitation_id: string; token: string; expires_at: string }>>('create_agency_invitation', { p_agency_id: agencyId, p_email: email.trim().toLowerCase(), p_role: role });
            if (error) fail(error, 'email');
            const r = data?.[0];
            if (!r) throw new AccessDeniedError();
            return { id: r.invitation_id, token: r.token, expiresAt: iso(r.expires_at) };
        },
        async revokeForAgency(invitationId: string): Promise<void> {
            const { error } = await db.rpc('revoke_agency_invitation', { p_invitation_id: invitationId });
            if (error) fail(error);
        },
    };
}

// ── Task comments ──────────────────────────────────────────────────────────

const COMMENT_COLS = ['id', 'brand_id', 'task_id', 'author_id', 'body', 'created_at'] as const;
interface CommentRow { id: string; brand_id: string; task_id: string; author_id: string; body: string; created_at: string }
const toComment = (r: CommentRow): T.TaskComment => ({ id: r.id, brandId: r.brand_id, taskId: r.task_id, authorId: r.author_id, body: r.body, createdAt: iso(r.created_at) });

export function commentRepo(db: DbPort, userId: string) {
    return {
        async list(brandId: string, taskId: string): Promise<T.TaskComment[]> {
            return (await selectAll<CommentRow>(db, 'task_comments', COMMENT_COLS, [eq('brand_id', brandId), eq('task_id', taskId)], [{ column: 'created_at' }])).map(toComment);
        },
        /** RLS: staff with write access, or Client Users with comment_tasks on a client-visible project. */
        async add(brandId: string, taskId: string, body: string): Promise<T.TaskComment> {
            const clean = body.trim();
            assertValid({ body: (!clean || clean.length > 5000) && 'Write a comment of up to 5,000 characters.' });
            return toComment(await insertOne<CommentRow>(db, 'task_comments', { brand_id: brandId, task_id: taskId, author_id: userId, body: clean }, COMMENT_COLS, 'body'));
        },
    };
}

// ── Platform audit log ─────────────────────────────────────────────────────

const AUDIT_COLS = ['id', 'actor_id', 'action', 'target_type', 'target_id', 'agency_id', 'brand_id', 'created_at'] as const;
export interface AuditRow { id: string; actor_id: string | null; action: string; target_type: string; target_id: string | null; agency_id: string | null; brand_id: string | null; created_at: string }

export function auditRepo(db: DbPort) {
    return {
        /** RLS: Super Admins see every event; Admins the events of agencies they administer. Newest 200. */
        async list(filter: { agencyId?: string } = {}): Promise<AuditRow[]> {
            const { rows, error } = await db.select<AuditRow>({
                table: 'platform_audit_events', columns: AUDIT_COLS, filters: filter.agencyId ? [eq('agency_id', filter.agencyId)] : [],
                order: [{ column: 'created_at', ascending: false }], range: { from: 0, to: 199 },
            });
            if (error) fail(error);
            return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
        },

    };
}
