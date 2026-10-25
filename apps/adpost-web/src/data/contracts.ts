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

/** The full API bound to one signed-in user. Extended phase by phase. */
export interface BrandApi {
    workspace: WorkspaceApi;
    clients: ClientsApi;
    websites: WebsitesApi;
}

export interface Backend {
    auth: AuthApi;
    /** API bound to the current session's user. Throws AuthError when signed out. */
    api(): BrandApi;
    /** Change notifications (local adapter: table writes; Supabase: Realtime). */
    subscribe(listener: (topic: string) => void): () => void;
}
