/**
 * Domain model for ADPOST Edition. Field names are camelCase here; the
 * Supabase schema (supabase/migrations) uses the snake_case equivalents.
 * Every brand-owned record carries `brandId` (ADR-002).
 */

export type ID = string;
export type ISODate = string;

// ── Tenancy ──────────────────────────────────────────────────────────────

export type BrandRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'client';
export type AgencyRole = 'agency_owner' | 'agency_admin';

export interface Agency {
    id: ID;
    name: string;
    slug: string;
}

export interface Brand {
    id: ID;
    agencyId: ID;
    name: string;
    slug: string;
    status: 'active' | 'archived';
    description: string;
    timezone: string;
    currency: string;
    color: string;
    createdAt: ISODate;
}

export interface User {
    id: ID;
    name: string;
    email: string;
}

export interface AgencyMembership {
    id: ID;
    agencyId: ID;
    userId: ID;
    role: AgencyRole;
}

export interface BrandMembership {
    id: ID;
    brandId: ID;
    userId: ID;
    role: BrandRole;
    /** Set only for role `client`: the client whose data the user may see. */
    clientId: ID | null;
    department: string | null;
    joinedAt: ISODate;
}

export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface Invitation {
    id: ID;
    brandId: ID;
    email: string;
    role: BrandRole;
    clientId: ID | null;
    invitedBy: ID;
    status: InvitationStatus;
    token: string;
    expiresAt: ISODate;
    createdAt: ISODate;
}

// ── Legacy parity: clients, websites, integrations, analytics, SEO ────────

export interface Client {
    id: ID;
    brandId: ID;
    name: string;
    slug: string;
    status: 'active' | 'archived';
    timezone: string;
    currency: string;
    businessGoals: string | null;
    createdAt: ISODate;
}

export type WebsitePlatform = 'wordpress' | 'shopify' | 'custom' | 'other';

export interface Website {
    id: ID;
    brandId: ID;
    clientId: ID;
    name: string;
    domain: string;
    platform: WebsitePlatform;
    status: 'active' | 'archived';
    primaryConversion: string | null;
    ga4PropertyId: string | null;
    gscSiteUrl: string | null;
    createdAt: ISODate;
}

export type IntegrationProvider = 'google_analytics' | 'google_search_console';
export type IntegrationStatus = 'pending' | 'connected' | 'error' | 'disconnected';

/** Credentials are never part of this type; they live server-side only. */
export interface Integration {
    id: ID;
    brandId: ID;
    clientId: ID;
    websiteId: ID;
    provider: IntegrationProvider;
    status: IntegrationStatus;
    externalAccountName: string | null;
    externalPropertyName: string | null;
    lastSyncedAt: ISODate | null;
    lastErrorMessage: string | null;
    createdAt: ISODate;
}

export interface DailyMetric {
    id: ID;
    brandId: ID;
    clientId: ID;
    websiteId: ID;
    date: string; // YYYY-MM-DD
    sessions: number;
    users: number;
    conversions: number;
    clicks: number;
    impressions: number;
    /** Average position, lower is better. */
    position: number;
}

export interface SearchQuery {
    id: ID;
    brandId: ID;
    clientId: ID;
    websiteId: ID;
    /** Start of the weekly bucket (YYYY-MM-DD). Legacy stores daily rows; weekly keeps local storage small. */
    date: string;
    query: string;
    clicks: number;
    impressions: number;
    position: number;
}

export interface LandingPage {
    id: ID;
    brandId: ID;
    clientId: ID;
    websiteId: ID;
    /** Start of the weekly bucket (YYYY-MM-DD). */
    date: string;
    path: string;
    sessions: number;
    conversions: number;
    bounceRate: number;
}

export type SeoInsightStatus = 'pending' | 'reviewed' | 'approved' | 'dismissed';
export type SeoInsightType = 'traffic_drop' | 'ctr_opportunity' | 'ranking_opportunity' | 'conversion_gap' | 'technical_issue' | 'content_gap';
export type Severity = 'low' | 'medium' | 'high';

export interface SeoInsight {
    id: ID;
    brandId: ID;
    clientId: ID;
    websiteId: ID;
    type: SeoInsightType;
    severity: Severity;
    status: SeoInsightStatus;
    /** Dedupe key from the rule that raised it (e.g. ctr:<site>:<query>). */
    subject: string;
    title: string;
    summary: string;
    recommendation: string;
    evidence: Record<string, string | number>;
    source: 'rules' | 'agent';
    reviewedBy: ID | null;
    reviewedAt: ISODate | null;
    reviewNotes: string | null;
    createdAt: ISODate;
}

export type N8nEvent = 'report.generated' | 'insight.approved' | 'approval.decided' | 'task.completed';

export interface N8nConnection {
    id: ID;
    brandId: ID;
    name: string;
    /** Only the host is stored client-side; the full signed URL stays server-side. */
    webhookHost: string;
    events: N8nEvent[];
    active: boolean;
    createdAt: ISODate;
}

export interface N8nDelivery {
    id: ID;
    brandId: ID;
    connectionId: ID;
    event: N8nEvent | 'connection.test';
    status: 'simulated' | 'delivered' | 'failed';
    attempt: number;
    responseCode: number | null;
    error: string | null;
    createdAt: ISODate;
}

export interface AuditLog {
    id: ID;
    brandId: ID;
    actorId: ID;
    action: string;
    subjectType: string;
    subjectId: ID;
    createdAt: ISODate;
}

// ── AI workforce ──────────────────────────────────────────────────────────

export type AgentTemplateKey = 'seo_manager' | 'technical_seo' | 'content_seo' | 'statistics_seo' | 'web_design' | 'web_development';
export type AgentTeam = 'seo' | 'web';

export type ToolKey =
    | 'read_analytics'
    | 'read_search_console'
    | 'read_knowledge'
    | 'audit_site'
    | 'draft_content'
    | 'propose_design'
    | 'propose_code'
    | 'create_task'
    | 'delegate'
    | 'request_approval';

export interface ModelRef {
    provider: 'simulated' | 'anthropic' | 'openai';
    model: string;
}

export interface AgentLimits {
    maxOutputTokens: number;
    maxRunsPerDay: number;
    monthlyBudgetUsd: number;
}

export interface AgentInstance {
    id: ID;
    brandId: ID;
    templateKey: AgentTemplateKey;
    displayName: string;
    handle: string;
    active: boolean;
    model: ModelRef;
    activeInstructionVersionId: ID;
    tools: ToolKey[];
    limits: AgentLimits;
    createdAt: ISODate;
    updatedAt: ISODate;
}

export interface InstructionVersion {
    id: ID;
    brandId: ID;
    agentInstanceId: ID;
    version: number;
    instructions: string;
    note: string;
    createdBy: ID;
    createdAt: ISODate;
}

export type Actor = { type: 'user'; userId: ID } | { type: 'agent'; agentInstanceId: ID } | { type: 'system' };

export interface Attachment {
    id: ID;
    name: string;
    sizeBytes: number;
    mimeType: string;
    knowledgeDocumentId: ID | null;
}

export type ConversationKind = 'direct' | 'group';
export type TeamKey = 'seo' | 'web' | 'all';

export interface Conversation {
    id: ID;
    brandId: ID;
    kind: ConversationKind;
    title: string;
    agentInstanceIds: ID[];
    teamKey: TeamKey | null;
    createdBy: ID;
    archived: boolean;
    summary: string | null;
    createdAt: ISODate;
    updatedAt: ISODate;
}

export type ExecutionMode = 'simulated' | 'live';

export interface Message {
    id: ID;
    brandId: ID;
    conversationId: ID;
    author: Actor;
    body: string;
    mentions: ID[];
    attachments: Attachment[];
    status: 'sent' | 'failed';
    executionId: ID | null;
    mode: ExecutionMode | null;
    createdAt: ISODate;
}

export type ExecutionStatus = 'running' | 'succeeded' | 'failed' | 'limited';

export interface AgentExecution {
    id: ID;
    brandId: ID;
    agentInstanceId: ID;
    conversationId: ID | null;
    triggerMessageId: ID | null;
    parentExecutionId: ID | null;
    handoffDepth: number;
    status: ExecutionStatus;
    mode: ExecutionMode;
    provider: ModelRef['provider'];
    model: string;
    instructionVersion: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    error: string | null;
    startedAt: ISODate;
    finishedAt: ISODate | null;
}

// ── Work ──────────────────────────────────────────────────────────────────

export interface Project {
    id: ID;
    brandId: ID;
    name: string;
    description: string;
    status: 'active' | 'on_hold' | 'completed';
    websiteId: ID | null;
    createdAt: ISODate;
}

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type Assignee = { type: 'user'; userId: ID } | { type: 'agent'; agentInstanceId: ID } | null;

export interface Task {
    id: ID;
    brandId: ID;
    projectId: ID;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: Assignee;
    createdBy: Actor;
    sourceMessageId: ID | null;
    dueDate: string | null;
    createdAt: ISODate;
    updatedAt: ISODate;
}

export type ApprovalKind = 'publish_content' | 'deploy_change' | 'run_webhook' | 'external_action' | 'budget_increase';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalRequest {
    id: ID;
    brandId: ID;
    kind: ApprovalKind;
    title: string;
    summary: string;
    payload: Record<string, string>;
    requestedBy: Actor;
    status: ApprovalStatus;
    decidedBy: ID | null;
    decidedAt: ISODate | null;
    decisionNote: string | null;
    taskId: ID | null;
    executionId: ID | null;
    createdAt: ISODate;
}

// ── Knowledge ─────────────────────────────────────────────────────────────

export type KnowledgeKind = 'brand_guide' | 'product' | 'seo_policy' | 'faq' | 'note' | 'upload';

export interface KnowledgeDocument {
    id: ID;
    brandId: ID;
    title: string;
    kind: KnowledgeKind;
    content: string;
    tags: string[];
    sizeBytes: number;
    createdBy: ID;
    createdAt: ISODate;
    updatedAt: ISODate;
}

export interface KnowledgeChunk {
    id: ID;
    brandId: ID;
    documentId: ID;
    index: number;
    text: string;
}
