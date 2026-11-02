/**
 * AI provider connection manager: domain model (mirrors supabase/migrations/20261102000007_ai_providers.sql).
 * A connection holds only a logical server-side secret slot name, never a credential.
 */
import type { ID, ISODate } from './types';
import type { AIErrorCategory, Capability, ConnectionStatus } from '../../../../supabase/functions/_shared/ai/types.ts';
import type { FallbackPolicy } from '../../../../supabase/functions/_shared/ai/routing.ts';

export type { AIErrorCategory, Capability, ConnectionStatus, FallbackPolicy };
export type AiProviderCode = 'simulated' | 'anthropic' | 'openai';
export type AiAuthMethod = 'platform_secret' | 'none';

export interface AiProviderInfo {
    code: AiProviderCode;
    name: string;
    authMethods: AiAuthMethod[];
    live: boolean;
    requiresSeparateBilling: boolean;
    /** Allowed secret-slot prefix for this provider (server env var). */
    slotPrefix: string | null;
    docsUrl: string | null;
    note: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
    {
        code: 'anthropic', name: 'Anthropic API', authMethods: ['platform_secret'], live: true, requiresSeparateBilling: true, slotPrefix: 'ANTHROPIC_API_KEY',
        docsUrl: 'https://docs.anthropic.com/en/api/overview',
        note: 'Needs an Anthropic Console API account with its own billing. A Claude.ai or Claude Code subscription does not provide API access.',
    },
    {
        code: 'openai', name: 'OpenAI API', authMethods: ['platform_secret'], live: true, requiresSeparateBilling: true, slotPrefix: 'OPENAI_API_KEY',
        docsUrl: 'https://platform.openai.com/docs/api-reference',
        note: 'Needs an OpenAI Platform API account with its own billing. A ChatGPT or Codex sign-in does not provide API access.',
    },
    {
        code: 'simulated', name: 'Simulated (offline)', authMethods: ['none'], live: false, requiresSeparateBilling: false, slotPrefix: null, docsUrl: null,
        note: 'Deterministic offline stand-in for development. Replies are always labelled simulated. No model is called.',
    },
];

export const providerInfo = (code: AiProviderCode): AiProviderInfo => AI_PROVIDERS.find((p) => p.code === code)!;

export const SECRET_SLOT_RE = /^(ANTHROPIC|OPENAI)_API_KEY(_[A-Z0-9]{1,32})?$/;
export const MODEL_ID_RE = /^[A-Za-z0-9._:/-]{1,128}$/;

export interface AiConnection {
    id: ID;
    agencyId: ID;
    /** null = organization-wide. */
    brandId: ID | null;
    provider: AiProviderCode;
    displayName: string;
    authenticationMethod: AiAuthMethod;
    credentialReference: string | null;
    apiOrganization: string | null;
    apiProject: string | null;
    defaultModel: string | null;
    maxOutputTokens: number;
    monthlyBudgetUsd: number | null;
    maxCostPerRequestUsd: number | null;
    monthlyRequestLimit: number | null;
    enabled: boolean;
    status: ConnectionStatus;
    lastTestedAt: ISODate | null;
    lastErrorCategory: AIErrorCategory | null;
    verifiedModels: string[];
    createdBy: ID | null;
    updatedBy: ID | null;
    createdAt: ISODate;
    updatedAt: ISODate;
}

export interface AiModel {
    id: ID;
    agencyId: ID;
    provider: AiProviderCode;
    modelId: string;
    displayName: string;
    capabilities: Capability[];
    contextWindow: number | null;
    maxOutputTokens: number | null;
    active: boolean;
    source: 'provider_api' | 'admin';
    inputUsdPerMTok: number | null;
    outputUsdPerMTok: number | null;
    pricingSource: string | null;
    pricingVerifiedAt: ISODate | null;
    createdAt: ISODate;
    updatedAt: ISODate;
}

export interface AiRoutingPolicy {
    id: ID;
    agencyId: ID;
    brandId: ID | null;
    defaultConnectionId: ID | null;
    defaultModel: string | null;
    allowCrossProviderFallback: boolean;
    monthlyBudgetUsd: number | null;
    perUserMonthlyBudgetUsd: number | null;
    maxCostPerRequestUsd: number | null;
    monthlyRequestLimit: number | null;
    monthlyTokenLimit: number | null;
    updatedBy: ID | null;
    updatedAt: ISODate;
}

export interface AiAgentAssignment {
    id: ID;
    brandId: ID;
    agentInstanceId: ID;
    connectionId: ID;
    provider: AiProviderCode;
    modelId: string;
    generationConfig: { temperature?: number };
    fallbackPolicy: FallbackPolicy;
    fallbackConnectionId: ID | null;
    fallbackModelId: string | null;
    enabled: boolean;
    updatedBy: ID | null;
    updatedAt: ISODate;
}

export type AiUsageStatus = 'succeeded' | 'failed' | 'cancelled' | 'limited';

export interface AiUsageEvent {
    id: ID;
    agencyId: ID;
    brandId: ID;
    userId: ID | null;
    agentInstanceId: ID | null;
    conversationId: ID | null;
    executionId: ID | null;
    connectionId: ID | null;
    provider: AiProviderCode;
    modelId: string;
    requestId: string | null;
    inputTokens: number;
    outputTokens: number;
    /** Provider-reported cost when a provider returns one (none do today). */
    reportedCost: number | null;
    /** From admin-entered verified prices only; null = unknown. */
    estimatedCost: number | null;
    currency: string;
    pricingVersion: string | null;
    executionStatus: AiUsageStatus;
    errorCategory: AIErrorCategory | null;
    latencyMs: number | null;
    createdAt: ISODate;
}

export interface AiHealthCheck {
    id: ID;
    agencyId: ID;
    brandId: ID | null;
    connectionId: ID;
    testedBy: ID | null;
    result: 'success' | 'failure';
    failureCategory: AIErrorCategory | null;
    latencyMs: number | null;
    modelsReported: number | null;
    message: string;
    createdAt: ISODate;
}

export interface AiAuditEvent {
    id: ID;
    agencyId: ID;
    brandId: ID | null;
    actorId: ID | null;
    action: 'insert' | 'update' | 'delete' | 'test';
    subjectType: string;
    subjectId: ID | null;
    changedColumns: string[];
    createdAt: ISODate;
}

export const CONNECTION_STATUS: Record<ConnectionStatus, { label: string; variant: 'green' | 'red' | 'yellow' | 'blue' | 'gray' }> = {
    not_configured: { label: 'Not configured', variant: 'gray' },
    configured: { label: 'Configured (not verified)', variant: 'blue' },
    testing: { label: 'Testing', variant: 'blue' },
    connected: { label: 'Connected', variant: 'green' },
    invalid_credentials: { label: 'Invalid credentials', variant: 'red' },
    permission_denied: { label: 'Permission denied', variant: 'red' },
    insufficient_credits: { label: 'Insufficient credits', variant: 'red' },
    rate_limited: { label: 'Rate limited', variant: 'yellow' },
    unavailable: { label: 'Temporarily unavailable', variant: 'yellow' },
    disabled: { label: 'Disabled', variant: 'gray' },
};

export const FALLBACK_LABEL: Record<FallbackPolicy, string> = {
    disabled: 'No fallback (fail visibly)',
    retry_same: 'Retry the same provider (up to 2 retries)',
    secondary_model: 'Use an approved secondary model (same connection)',
    secondary_provider: 'Use an approved secondary provider (needs organization and brand consent)',
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
    text: 'Text', streaming: 'Streaming', tools: 'Tool use', structured_output: 'Structured output', vision: 'Vision', reasoning: 'Reasoning',
};
