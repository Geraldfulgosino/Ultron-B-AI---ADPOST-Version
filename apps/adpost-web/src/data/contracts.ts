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
import type { ReportData, ReportFilters, SeriesPoint } from '@/domain/analytics';
import type { AgentTemplate } from '@/domain/agents';
import type { Anomaly, Opportunity, WebsiteComparisonRow } from '@/domain/intelligence';
import type { RetrievalHit } from '@/domain/knowledge';

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

// ── Analytics, SEO, reports, automation (legacy parity) ─────────────────

export interface Kpi {
    current: number;
    previous: number;
    delta: number | null;
}

export interface DashboardSummary {
    counts: { clients: number; websites: number; integrationsConnected: number; integrationsError: number; insightsPending: number };
    /** Window used for KPIs: the 28 days ending on the latest synced date. */
    window: { from: string; to: string } | null;
    kpis: { sessions: Kpi; conversions: Kpi; clicks: Kpi; impressions: Kpi };
    sessionsTrend: SeriesPoint[];
    clicksTrend: SeriesPoint[];
    recentInsights: T.SeoInsight[];
    integrations: Array<T.Integration & { websiteName: string }>;
}

export interface SeoOverview {
    filters: { from: string; to: string; websiteId: string | null };
    totals: { sessions: number; conversions: number; clicks: number; impressions: number; ctr: number; avgPosition: number };
    previous: { sessions: number; clicks: number; impressions: number; conversions: number };
    clicksTrend: SeriesPoint[];
    sessionsTrend: SeriesPoint[];
    topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
    topPages: Array<{ path: string; sessions: number; conversions: number; conversionRate: number }>;
}

export interface AnalyticsApi {
    dashboard(brandId: T.ID): Promise<DashboardSummary>;
    /** Earliest/latest metric date visible to the user, or null if there is no data. */
    dataRange(brandId: T.ID): Promise<{ from: string; to: string } | null>;
    seoOverview(brandId: T.ID, filters: { from: string; to: string; websiteId?: string | null }): Promise<SeoOverview>;
}

export interface IntegrationsApi {
    list(brandId: T.ID): Promise<Array<T.Integration & { websiteName: string }>>;
    /** Local: creates a `pending` record. Real OAuth runs server-side (Phase 17). */
    connect(brandId: T.ID, websiteId: T.ID, provider: T.IntegrationProvider): Promise<T.Integration>;
    /** Local: simulated sync (no network). */
    sync(brandId: T.ID, id: T.ID): Promise<T.Integration>;
    disconnect(brandId: T.ID, id: T.ID): Promise<T.Integration>;
    /** Remove a disconnected/pending record. */
    remove(brandId: T.ID, id: T.ID): Promise<void>;
}

export interface InsightFilters {
    status?: T.SeoInsightStatus | 'open';
    websiteId?: T.ID;
    type?: T.SeoInsightType;
    severity?: T.Severity;
}

export interface InsightsApi {
    list(brandId: T.ID, filters?: InsightFilters): Promise<T.SeoInsight[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.SeoInsight & { websiteName: string; domain: string }>;
    /** Runs the rule set over brand data; returns how many new insights were created. */
    generate(brandId: T.ID): Promise<{ created: number }>;
    setStatus(brandId: T.ID, id: T.ID, status: T.SeoInsightStatus, notes?: string | null): Promise<T.SeoInsight>;
    bulkSetStatus(brandId: T.ID, ids: T.ID[], status: 'reviewed' | 'dismissed'): Promise<{ updated: number }>;
}

export interface ReportsApi {
    preview(brandId: T.ID, filters: ReportFilters): Promise<ReportData>;
    /** Records the export (audit + automation event). File building happens client-side today. */
    recordExport(brandId: T.ID, format: 'csv' | 'pdf'): Promise<void>;
}

export interface AutomationState {
    connection: T.N8nConnection | null;
    deliveries: T.N8nDelivery[];
}

export interface AutomationApi {
    get(brandId: T.ID): Promise<AutomationState>;
    save(brandId: T.ID, input: { name: string; webhookUrl: string; events: T.N8nEvent[]; active?: boolean }): Promise<T.N8nConnection>;
    /** Local adapter never calls the network: records a `simulated` delivery. */
    test(brandId: T.ID): Promise<T.N8nDelivery>;
    clearDeliveries(brandId: T.ID): Promise<void>;
    disconnect(brandId: T.ID): Promise<void>;
}

// ── AI workforce ──────────────────────────────────────────────────────────

export interface AgentUsage {
    agentInstanceId: T.ID;
    runsToday: number;
    runsMonth: number;
    tokensMonth: number;
    /** Sum of runs with a known rate. */
    costMonthUsd: number;
    /** Runs whose model has no configured rate (cost unknown, not zero). */
    unpricedRunsMonth: number;
    budgetRemainingUsd: number;
}

export interface AgentUpdate {
    displayName?: string;
    active?: boolean;
    model?: T.ModelRef;
    tools?: T.ToolKey[];
    limits?: Partial<T.AgentLimits>;
}

export interface ExecutionFilters {
    agentInstanceId?: T.ID;
    status?: T.ExecutionStatus;
    mode?: T.ExecutionMode;
    conversationId?: T.ID;
}

export interface AgentsApi {
    templates(): AgentTemplate[];
    list(brandId: T.ID): Promise<T.AgentInstance[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.AgentInstance>;
    /** Admin: create this brand's instance of a template (one per template). */
    provision(brandId: T.ID, templateKey: T.AgentTemplateKey): Promise<T.AgentInstance>;
    update(brandId: T.ID, id: T.ID, patch: AgentUpdate): Promise<T.AgentInstance>;
    instructionVersions(brandId: T.ID, id: T.ID): Promise<T.InstructionVersion[]>;
    /** Admin: save new instructions as the next version and make it active. */
    publishInstructions(brandId: T.ID, id: T.ID, input: { instructions: string; note: string }): Promise<T.InstructionVersion>;
    /** Admin: roll back/forward to an existing version. */
    activateVersion(brandId: T.ID, id: T.ID, versionId: T.ID): Promise<T.AgentInstance>;
    usage(brandId: T.ID): Promise<AgentUsage[]>;
    executions(brandId: T.ID, filters?: ExecutionFilters): Promise<T.AgentExecution[]>;
}

// ── Chat ──────────────────────────────────────────────────────────────────

export interface AttachmentInput {
    name: string;
    sizeBytes: number;
    mimeType: string;
    /** Extracted text for text files; null for binary files. */
    text: string | null;
}

export interface ConversationSummary extends T.Conversation {
    lastMessage: T.Message | null;
    messageCount: number;
}

export interface SendResult {
    message: T.Message;
    /** Agent replies and system notices produced by this send, in order. */
    replies: T.Message[];
}

export interface ChatSearchHit {
    conversationId: T.ID;
    conversationTitle: string;
    message: T.Message;
}

export interface ChatApi {
    list(brandId: T.ID, filter?: { kind?: T.ConversationKind; includeArchived?: boolean }): Promise<ConversationSummary[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.Conversation>;
    createDirect(brandId: T.ID, agentInstanceId: T.ID, title?: string): Promise<T.Conversation>;
    createGroup(brandId: T.ID, input: { team: T.TeamKey; title?: string }): Promise<T.Conversation>;
    messages(brandId: T.ID, conversationId: T.ID): Promise<T.Message[]>;
    send(brandId: T.ID, conversationId: T.ID, input: { body: string; attachments?: AttachmentInput[] }): Promise<SendResult>;
    /** Re-run the agent(s) for the user message a failed reply answered. */
    retry(brandId: T.ID, conversationId: T.ID, failedMessageId: T.ID): Promise<SendResult>;
    rename(brandId: T.ID, id: T.ID, title: string): Promise<T.Conversation>;
    archive(brandId: T.ID, id: T.ID, archived: boolean): Promise<T.Conversation>;
    search(brandId: T.ID, query: string): Promise<ChatSearchHit[]>;
    dismissProposal(brandId: T.ID, messageId: T.ID, proposalId: T.ID): Promise<T.Message>;
    /** Deterministic summary stored on the conversation. */
    summarize(brandId: T.ID, id: T.ID): Promise<T.Conversation>;
}

// ── Projects, tasks, approvals ────────────────────────────────────────────

export interface ProjectInput {
    name: string;
    description?: string;
    status?: T.Project['status'];
    websiteId?: T.ID | null;
}

export interface ProjectSummary extends T.Project {
    taskCounts: Record<T.TaskStatus, number>;
}

export interface TaskInput {
    projectId: T.ID;
    title: string;
    description?: string;
    status?: T.TaskStatus;
    priority?: T.TaskPriority;
    assignee?: T.Assignee;
    dueDate?: string | null;
}

export interface TaskFilters {
    projectId?: T.ID;
    status?: T.TaskStatus;
    agentInstanceId?: T.ID;
    userId?: T.ID;
}

export interface WorkApi {
    projects(brandId: T.ID): Promise<ProjectSummary[]>;
    createProject(brandId: T.ID, input: ProjectInput): Promise<T.Project>;
    updateProject(brandId: T.ID, id: T.ID, input: Partial<ProjectInput>): Promise<T.Project>;
    /** Admin only; deletes the project's tasks. */
    removeProject(brandId: T.ID, id: T.ID): Promise<void>;
    tasks(brandId: T.ID, filters?: TaskFilters): Promise<T.Task[]>;
    createTask(brandId: T.ID, input: TaskInput): Promise<T.Task>;
    updateTask(brandId: T.ID, id: T.ID, input: Partial<Omit<TaskInput, 'projectId'>> & { projectId?: T.ID }): Promise<T.Task>;
    removeTask(brandId: T.ID, id: T.ID): Promise<void>;
    approvals(brandId: T.ID, filters?: { status?: T.ApprovalStatus }): Promise<T.ApprovalRequest[]>;
    requestApproval(brandId: T.ID, input: { kind: T.ApprovalKind; title: string; summary: string; payload?: Record<string, string>; taskId?: T.ID | null }): Promise<T.ApprovalRequest>;
    /** Admins decide; nobody can approve a request they raised themselves. */
    decideApproval(brandId: T.ID, id: T.ID, decision: 'approved' | 'rejected', note: string): Promise<T.ApprovalRequest>;
    cancelApproval(brandId: T.ID, id: T.ID): Promise<T.ApprovalRequest>;
    /** Turn an agent proposal into a task or approval request (human action). */
    applyProposal(brandId: T.ID, messageId: T.ID, proposalId: T.ID): Promise<{ kind: 'task' | 'approval'; id: T.ID }>;
}

// ── SEO intelligence ─────────────────────────────────────────────────────

export interface IntelligenceOverview {
    anomalies: Anomaly[];
    opportunities: Opportunity[];
    comparison: WebsiteComparisonRow[];
}

export interface IntelligenceApi {
    overview(brandId: T.ID, filters: { from: string; to: string; websiteId?: T.ID | null }): Promise<IntelligenceOverview>;
    /** Opens a chat with the SEO Manager seeded with the insight. Requires write access. */
    discussInsight(brandId: T.ID, insightId: T.ID): Promise<{ conversationId: T.ID }>;
}

// ── Web Studio ───────────────────────────────────────────────────────────

export interface StudioApi {
    list(brandId: T.ID, filter?: { stage?: T.WebChangeStage; websiteId?: T.ID }): Promise<T.WebChange[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.WebChange>;
    create(brandId: T.ID, input: { websiteId: T.ID; title: string; brief: string }): Promise<T.WebChange>;
    /** Web Design Agent drafts the design proposal (simulated locally). */
    runDesign(brandId: T.ID, id: T.ID): Promise<T.WebChange>;
    /** Web Development Agent drafts the implementation proposal from the design. */
    runDevelopment(brandId: T.ID, id: T.ID): Promise<T.WebChange>;
    toggleChecklist(brandId: T.ID, id: T.ID, key: string): Promise<T.WebChange>;
    /** Creates a deploy_change approval request; checklist must be complete. */
    requestRelease(brandId: T.ID, id: T.ID): Promise<T.WebChange>;
    /** Admin: record the release once the approval is approved. Local mode deploys nothing. */
    markReleased(brandId: T.ID, id: T.ID): Promise<T.WebChange>;
    cancel(brandId: T.ID, id: T.ID): Promise<T.WebChange>;
}

// ── Knowledge ─────────────────────────────────────────────────────────────

export interface KnowledgeInput {
    title: string;
    kind: T.KnowledgeKind;
    content: string;
    tags?: string[];
}

export interface KnowledgeApi {
    list(brandId: T.ID, filter?: { kind?: T.KnowledgeKind; query?: string }): Promise<T.KnowledgeDocument[]>;
    get(brandId: T.ID, id: T.ID): Promise<T.KnowledgeDocument>;
    create(brandId: T.ID, input: KnowledgeInput): Promise<T.KnowledgeDocument>;
    update(brandId: T.ID, id: T.ID, input: Partial<KnowledgeInput>): Promise<T.KnowledgeDocument>;
    remove(brandId: T.ID, id: T.ID): Promise<void>;
    /** Text files only in local mode; binary goes to Supabase Storage in Phase 17. */
    upload(brandId: T.ID, file: AttachmentInput): Promise<T.KnowledgeDocument>;
    /** Ranked passages (same retrieval agents use). */
    search(brandId: T.ID, query: string): Promise<RetrievalHit[]>;
    /** Save a chat attachment as a knowledge document. */
    saveAttachment(brandId: T.ID, messageId: T.ID, attachmentId: T.ID): Promise<T.KnowledgeDocument>;
}

/** The full API bound to one signed-in user. Extended phase by phase. */
export interface BrandApi {
    workspace: WorkspaceApi;
    clients: ClientsApi;
    websites: WebsitesApi;
    members: MembersApi;
    invitations: InvitationsApi;
    analytics: AnalyticsApi;
    integrations: IntegrationsApi;
    insights: InsightsApi;
    reports: ReportsApi;
    automation: AutomationApi;
    agents: AgentsApi;
    chat: ChatApi;
    work: WorkApi;
    intelligence: IntelligenceApi;
    studio: StudioApi;
    knowledge: KnowledgeApi;
}

export interface Backend {
    auth: AuthApi;
    /** API bound to the current session's user. Throws AuthError when signed out. */
    api(): BrandApi;
    /** Change notifications (local adapter: table writes; Supabase: Realtime). */
    subscribe(listener: (topic: string) => void): () => void;
}
