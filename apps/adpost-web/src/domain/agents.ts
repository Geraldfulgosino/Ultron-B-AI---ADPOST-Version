/**
 * The six reusable specialist templates (ADR-004). A brand gets an *instance* of
 * a template with its own name, model, instructions, tools and limits.
 */
import type { AgentLimits, AgentTeam, AgentTemplateKey, ModelRef, ToolKey } from './types';

export interface AgentTemplate {
    key: AgentTemplateKey;
    name: string;
    handle: string;
    team: AgentTeam;
    description: string;
    capabilities: string[];
    defaultTools: ToolKey[];
    defaultInstructions: string;
}

export const TOOL_LABELS: Record<ToolKey, { label: string; description: string; external: boolean }> = {
    read_analytics: { label: 'Read analytics', description: 'GA4 sessions, conversions and landing pages for this brand.', external: false },
    read_search_console: { label: 'Read Search Console', description: 'Queries, clicks, impressions and positions.', external: false },
    read_knowledge: { label: 'Read brand knowledge', description: 'Brand guides, product facts and SEO policies.', external: false },
    audit_site: { label: 'Audit site', description: 'Run technical SEO checks (simulated offline).', external: false },
    draft_content: { label: 'Draft content', description: 'Write briefs, outlines and copy drafts.', external: false },
    propose_design: { label: 'Propose design', description: 'Produce layout and UI recommendations.', external: false },
    propose_code: { label: 'Propose code', description: 'Produce code change proposals (never deploys).', external: false },
    create_task: { label: 'Create tasks', description: 'Add tasks to brand projects.', external: false },
    delegate: { label: 'Delegate to agents', description: 'Hand work to another active agent with @mention.', external: false },
    request_approval: { label: 'Request approval', description: 'Ask a human to approve an external action (publish, deploy, webhook).', external: true },
};

export const ALL_TOOLS = Object.keys(TOOL_LABELS) as ToolKey[];

export const AGENT_TEMPLATES: AgentTemplate[] = [
    {
        key: 'seo_manager',
        name: 'SEO Manager',
        handle: 'seo-manager',
        team: 'seo',
        description: 'Owns the SEO strategy, prioritises work and coordinates the SEO specialists.',
        capabilities: ['Prioritise opportunities', 'Plan sprints', 'Delegate to specialists', 'Summarise performance'],
        defaultTools: ['read_analytics', 'read_search_console', 'read_knowledge', 'create_task', 'delegate', 'request_approval'],
        defaultInstructions:
            'You are the SEO Manager for {brand}. Turn analytics and insights into a prioritised plan. Delegate technical work to @technical-seo, content work to @content-seo and measurement questions to @statistics-seo. Create tasks for agreed work and never publish without human approval.',
    },
    {
        key: 'technical_seo',
        name: 'Technical SEO Agent',
        handle: 'technical-seo',
        team: 'seo',
        description: 'Crawlability, indexing, Core Web Vitals, structured data and site architecture.',
        capabilities: ['Technical audits', 'Indexing diagnosis', 'Structured data', 'Performance recommendations'],
        defaultTools: ['read_search_console', 'audit_site', 'read_knowledge', 'create_task'],
        defaultInstructions:
            'You are the Technical SEO Agent for {brand}. Diagnose crawl, index, speed and markup issues. Give concrete fixes with the affected URLs and expected impact. Code changes go to @web-development as proposals.',
    },
    {
        key: 'content_seo',
        name: 'Content SEO Agent',
        handle: 'content-seo',
        team: 'seo',
        description: 'Keyword mapping, content briefs, on-page optimisation and content gaps.',
        capabilities: ['Content briefs', 'Title and meta rewrites', 'Keyword mapping', 'Content gap analysis'],
        defaultTools: ['read_search_console', 'read_knowledge', 'draft_content', 'create_task', 'request_approval'],
        defaultInstructions:
            'You are the Content SEO Agent for {brand}. Follow the brand voice in the knowledge base. Produce briefs and rewrites tied to real queries. Publishing always requires a human approval request.',
    },
    {
        key: 'statistics_seo',
        name: 'Statistics SEO Agent',
        handle: 'statistics-seo',
        team: 'seo',
        description: 'Measurement, trend analysis, anomaly detection and reporting narratives.',
        capabilities: ['Trend analysis', 'Anomaly detection', 'Forecasts', 'Report narratives'],
        defaultTools: ['read_analytics', 'read_search_console', 'create_task'],
        defaultInstructions:
            'You are the Statistics SEO Agent for {brand}. Quantify changes with exact numbers and comparison windows. State uncertainty plainly and never invent data that is not in the analytics.',
    },
    {
        key: 'web_design',
        name: 'Web Design Agent',
        handle: 'web-design',
        team: 'web',
        description: 'UX, layout, visual hierarchy, accessibility and conversion-focused design.',
        capabilities: ['Page layouts', 'UX reviews', 'Accessibility checks', 'Conversion design'],
        defaultTools: ['read_analytics', 'read_knowledge', 'propose_design', 'create_task', 'delegate'],
        defaultInstructions:
            'You are the Web Design Agent for {brand}. Propose layouts and UX changes grounded in the brand guide and conversion data. Hand implementation to @web-development.',
    },
    {
        key: 'web_development',
        name: 'Web Development Agent',
        handle: 'web-development',
        team: 'web',
        description: 'Implementation proposals, performance fixes, schema markup and release planning.',
        capabilities: ['Code proposals', 'Performance fixes', 'Schema markup', 'Release checklists'],
        defaultTools: ['read_knowledge', 'propose_code', 'create_task', 'request_approval'],
        defaultInstructions:
            'You are the Web Development Agent for {brand}. Produce reviewable change proposals with file paths, diffs and test steps. You never deploy; every deploy is a human approval request.',
    },
];

export const templateByKey = (key: AgentTemplateKey): AgentTemplate => AGENT_TEMPLATES.find((t) => t.key === key)!;

/**
 * Model catalogue. Rates are USD per 1K tokens. The simulated model uses a
 * notional rate so cost reporting can be exercised offline. Live rates are left
 * null on purpose: set them from the provider's current pricing in Phase 17.
 */
export interface ModelOption extends ModelRef {
    label: string;
    inputPer1k: number | null;
    outputPer1k: number | null;
    live: boolean;
}

export const MODEL_CATALOG: ModelOption[] = [
    { provider: 'simulated', model: 'sim-deterministic-1', label: 'Simulated (offline, deterministic)', inputPer1k: 0.003, outputPer1k: 0.015, live: false },
    { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (requires server key, Phase 17)', inputPer1k: null, outputPer1k: null, live: true },
    { provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (requires server key, Phase 17)', inputPer1k: null, outputPer1k: null, live: true },
];

export const DEFAULT_MODEL: ModelRef = { provider: 'simulated', model: 'sim-deterministic-1' };
export const DEFAULT_LIMITS: AgentLimits = { maxOutputTokens: 800, maxRunsPerDay: 200, monthlyBudgetUsd: 25 };

export function modelOption(ref: ModelRef): ModelOption | undefined {
    return MODEL_CATALOG.find((m) => m.provider === ref.provider && m.model === ref.model);
}

/** ~4 characters per token: the usual rough estimate for English text. */
export function estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}

/** null when the model has no configured rate (cost unknown, not zero). */
export function estimateCost(ref: ModelRef, inputTokens: number, outputTokens: number): number | null {
    const m = modelOption(ref);
    if (!m || m.inputPer1k === null || m.outputPer1k === null) return null;
    return Math.round(((inputTokens / 1000) * m.inputPer1k + (outputTokens / 1000) * m.outputPer1k) * 1e6) / 1e6;
}

export function renderInstructions(template: string, brandName: string): string {
    return template.replace(/\{brand\}/g, brandName);
}
