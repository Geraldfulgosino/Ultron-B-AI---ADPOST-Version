/**
 * Backend contracts. UI code depends only on these interfaces (ADR-003).
 * The local adapter (src/data/local) implements them today; a Supabase adapter
 * implements the same interfaces in Phase 17.
 *
 * Every method is scoped to the signed-in user. Implementations MUST enforce
 * authorization themselves; callers are never trusted.
 */
import type * as T from '@/domain/types';
import type { Capability } from './access';

export interface Session {
    user: T.User;
}

export interface AuthApi {
    signIn(email: string, password: string): Promise<Session>;
    /** Creates an account with no memberships; access comes from invitations. */
    register(input: { name: string; email: string; password: string }): Promise<Session>;
    signOut(): Promise<void>;
    currentSession(): Session | null;
}

export interface BrandAccess {
    brand: T.Brand;
    role: T.BrandRole | 'agency';
    roleLabel: string;
    can: Record<Capability, boolean>;
    /** For client users: the only client they may see. */
    clientId: T.ID | null;
    /** Roles this user may grant in the brand (empty = cannot manage members). */
    assignableRoles: T.BrandRole[];
}

export interface BrandInput {
    name: string;
    description?: string;
    timezone?: string;
    currency?: string;
    color?: string;
}

export interface WorkspaceApi {
    me(): T.User;
    listBrands(): Promise<BrandAccess[]>;
    /** Throws AccessDeniedError for unknown or inaccessible slugs. */
    brandBySlug(slug: string): Promise<BrandAccess>;
    /** True for agency staff (may create brands). */
    canCreateBrands(): Promise<boolean>;
    /** Agency staff only. */
    createBrand(input: BrandInput): Promise<T.Brand>;
    updateBrand(brandId: T.ID, input: Partial<BrandInput> & { status?: T.Brand['status'] }): Promise<T.Brand>;
}

export interface ClientInput {
    name: string;
    status?: T.Client['status'];
    timezone?: string;
    currency?: string;
    businessGoals?: string | null;
}

export interface ClientsApi {
    list(brandId: T.ID): Promise<T.Client[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.Client>;
    create(brandId: T.ID, input: ClientInput): Promise<T.Client>;
    update(brandId: T.ID, id: T.ID, input: Partial<ClientInput>): Promise<T.Client>;
    remove(brandId: T.ID, id: T.ID): Promise<void>;
}

export interface WebsiteInput {
    clientId: T.ID;
    name: string;
    domain: string;
    platform?: T.WebsitePlatform;
    status?: T.Website['status'];
    primaryConversion?: string | null;
    ga4PropertyId?: string | null;
    gscSiteUrl?: string | null;
}

export interface WebsitesApi {
    list(brandId: T.ID, filter?: { clientId?: T.ID }): Promise<T.Website[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.Website>;
    create(brandId: T.ID, input: WebsiteInput): Promise<T.Website>;
    update(brandId: T.ID, id: T.ID, input: Partial<WebsiteInput>): Promise<T.Website>;
    remove(brandId: T.ID, id: T.ID): Promise<void>;
}

export interface MemberView extends T.BrandMembership {
    name: string;
    email: string;
    clientName: string | null;
}

export interface MembersApi {
    list(brandId: T.ID): Promise<MemberView[]>;
    updateRole(brandId: T.ID, membershipId: T.ID, role: T.BrandRole, clientId?: T.ID | null): Promise<MemberView>;
    remove(brandId: T.ID, membershipId: T.ID): Promise<void>;
}

/** The invite token is never returned to listing callers. */
export type InvitationView = Omit<T.Invitation, 'token'>;

export interface InvitationPreview {
    brandName: string;
    brandSlug: string;
    role: T.BrandRole;
    email: string;
    status: T.InvitationStatus;
    expiresAt: T.ISODate;
}

export interface InvitationsApi {
    list(brandId: T.ID): Promise<InvitationView[]>;
    send(
        brandId: T.ID,
        input: { email: string; role: T.BrandRole; clientId?: T.ID | null },
    ): Promise<{ invitation: InvitationView; devAcceptPath?: string }>;
    cancel(brandId: T.ID, id: T.ID): Promise<void>;
    preview(token: string): Promise<InvitationPreview>;
    accept(token: string): Promise<{ brandSlug: string }>;
}

/** The full API bound to one signed-in user. Extended phase by phase. */
export interface BrandApi {
    workspace: WorkspaceApi;
    clients: ClientsApi;
    websites: WebsitesApi;
    members: MembersApi;
    invitations: InvitationsApi;
}

export interface Backend {
    auth: AuthApi;
    /** API bound to the current session's user. Throws AuthError when signed out. */
    api(): BrandApi;
    /** Change notifications (local adapter: table writes; Supabase: Realtime). */
    subscribe(listener: (topic: string) => void): () => void;
}
