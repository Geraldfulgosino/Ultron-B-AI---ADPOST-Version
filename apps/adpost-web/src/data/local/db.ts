import type * as T from '@/domain/types';

/** One array per future Postgres table. Keys map to snake_case table names. */
export interface Tables {
    agencies: T.Agency;
    brands: T.Brand;
    users: T.User;
    agencyMemberships: T.AgencyMembership;
    brandMemberships: T.BrandMembership;
    invitations: T.Invitation;
    clients: T.Client;
    websites: T.Website;
    integrations: T.Integration;
    dailyMetrics: T.DailyMetric;
    searchQueries: T.SearchQuery;
    landingPages: T.LandingPage;
    seoInsights: T.SeoInsight;
    n8nConnections: T.N8nConnection;
    n8nDeliveries: T.N8nDelivery;
    auditLogs: T.AuditLog;
    agentInstances: T.AgentInstance;
    instructionVersions: T.InstructionVersion;
    conversations: T.Conversation;
    messages: T.Message;
    executions: T.AgentExecution;
    projects: T.Project;
    tasks: T.Task;
    approvals: T.ApprovalRequest;
    knowledgeDocuments: T.KnowledgeDocument;
    knowledgeChunks: T.KnowledgeChunk;
    webChanges: T.WebChange;
}

export type TableName = keyof Tables;
export type DbSnapshot = { [K in TableName]: Tables[K][] };

/** Local-only credential store. Never part of any API response. */
export type Credentials = Record<string, string>; // lowercased email -> dev password

export const EMPTY_SNAPSHOT = (): DbSnapshot => ({
    agencies: [], brands: [], users: [], agencyMemberships: [], brandMemberships: [], invitations: [],
    clients: [], websites: [], integrations: [], dailyMetrics: [], searchQueries: [], landingPages: [],
    seoInsights: [], n8nConnections: [], n8nDeliveries: [], auditLogs: [], agentInstances: [],
    instructionVersions: [], conversations: [], messages: [], executions: [], projects: [], tasks: [],
    approvals: [], knowledgeDocuments: [], knowledgeChunks: [], webChanges: [],
});

type Listener = (table: TableName) => void;

export interface LocalDatabaseOptions {
    /** localStorage key; omit to keep data in memory only (tests). */
    persistKey?: string;
    /** Fixed clock for deterministic tests. */
    now?: () => Date;
}

export class LocalDatabase {
    private data: DbSnapshot;
    private listeners = new Set<Listener>();
    readonly now: () => Date;

    constructor(
        seed: DbSnapshot,
        readonly credentials: Credentials,
        private readonly options: LocalDatabaseOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.data = this.load() ?? structuredClone(seed);
    }

    nowIso(): string {
        return this.now().toISOString();
    }

    all<K extends TableName>(table: K): readonly Tables[K][] {
        return this.data[table];
    }

    find<K extends TableName>(table: K, id: string): Tables[K] | undefined {
        return (this.data[table] as Array<Tables[K] & { id: string }>).find((r) => r.id === id);
    }

    insert<K extends TableName>(table: K, row: Tables[K]): Tables[K] {
        (this.data[table] as Tables[K][]).push(row);
        this.changed(table);
        return row;
    }

    insertMany<K extends TableName>(table: K, rows: Tables[K][]): void {
        (this.data[table] as Tables[K][]).push(...rows);
        this.changed(table);
    }

    patch<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>): Tables[K] {
        const row = this.find(table, id);
        if (!row) throw new Error(`patch: ${table}/${id} missing`);
        Object.assign(row, patch);
        this.changed(table);
        return row;
    }

    delete<K extends TableName>(table: K, predicate: (row: Tables[K]) => boolean): number {
        const before = this.data[table].length;
        (this.data as Record<TableName, unknown[]>)[table] = (this.data[table] as Tables[K][]).filter((r) => !predicate(r));
        const removed = before - this.data[table].length;
        if (removed) this.changed(table);
        return removed;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    snapshot(): DbSnapshot {
        return structuredClone(this.data);
    }

    private changed(table: TableName): void {
        this.save();
        for (const l of this.listeners) l(table);
    }

    private load(): DbSnapshot | null {
        if (!this.options.persistKey) return null;
        try {
            const raw = localStorage.getItem(this.options.persistKey);
            if (!raw) return null;
            return { ...EMPTY_SNAPSHOT(), ...(JSON.parse(raw) as Partial<DbSnapshot>) };
        } catch {
            return null;
        }
    }

    private save(): void {
        if (!this.options.persistKey) return;
        try {
            localStorage.setItem(this.options.persistKey, JSON.stringify(this.data));
        } catch {
            // Storage full or unavailable: keep working in memory.
        }
    }
}
