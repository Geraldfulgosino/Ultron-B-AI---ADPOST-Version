/**
 * Subscription plans and entitlements (Phase 16, future SaaS).
 * The agency (tenant owner) holds the plan; brands inherit it. ADPOST runs on
 * `internal` (unlimited), so nothing is restricted today. Prices are not
 * defined here: billing is a separate provider boundary (see BillingProvider).
 */
export type PlanKey = 'internal' | 'starter' | 'growth' | 'agency';

export type Feature = 'team_chat' | 'web_studio' | 'intelligence' | 'automation' | 'live_models';

export interface Plan {
    key: PlanKey;
    name: string;
    /** null = unlimited */
    maxBrands: number | null;
    maxMembersPerBrand: number | null;
    maxAgentRunsPerMonth: number | null;
    maxKnowledgeBytes: number | null;
    features: Feature[];
}

const ALL: Feature[] = ['team_chat', 'web_studio', 'intelligence', 'automation', 'live_models'];

export const PLANS: Record<PlanKey, Plan> = {
    internal: { key: 'internal', name: 'Internal (unlimited)', maxBrands: null, maxMembersPerBrand: null, maxAgentRunsPerMonth: null, maxKnowledgeBytes: null, features: ALL },
    starter: { key: 'starter', name: 'Starter', maxBrands: 1, maxMembersPerBrand: 5, maxAgentRunsPerMonth: 500, maxKnowledgeBytes: 5_000_000, features: ['intelligence'] },
    growth: { key: 'growth', name: 'Growth', maxBrands: 5, maxMembersPerBrand: 20, maxAgentRunsPerMonth: 5_000, maxKnowledgeBytes: 50_000_000, features: ['team_chat', 'intelligence', 'automation', 'web_studio'] },
    agency: { key: 'agency', name: 'Agency', maxBrands: 25, maxMembersPerBrand: 100, maxAgentRunsPerMonth: 50_000, maxKnowledgeBytes: 500_000_000, features: ALL },
};

export const FEATURE_LABELS: Record<Feature, string> = {
    team_chat: 'Team chat & orchestration',
    web_studio: 'Web Studio',
    intelligence: 'SEO Intelligence',
    automation: 'n8n automation',
    live_models: 'Live AI models',
};

export interface AgencyUsage {
    planKey: PlanKey;
    period: { from: string; to: string };
    brands: number;
    maxMembersInABrand: number;
    agentRunsThisMonth: number;
    knowledgeBytes: number;
}

/** Metered quantities vs limits; `ratio` is null when unlimited. */
export function usageVsLimits(u: AgencyUsage) {
    const p = PLANS[u.planKey];
    const row = (label: string, used: number, limit: number | null) => ({ label, used, limit, ratio: limit === null ? null : limit === 0 ? 1 : used / limit });
    return [
        row('Brands', u.brands, p.maxBrands),
        row('Members (largest brand)', u.maxMembersInABrand, p.maxMembersPerBrand),
        row('Agent runs this month', u.agentRunsThisMonth, p.maxAgentRunsPerMonth),
        row('Knowledge storage (bytes)', u.knowledgeBytes, p.maxKnowledgeBytes),
    ];
}

/**
 * Billing boundary for a future SaaS launch. No provider is connected; an
 * implementation (for example a Stripe-backed Edge Function) maps provider
 * subscriptions onto `agencies.plan_key` via verified webhooks only.
 */
export interface BillingProvider {
    createCheckout(agencyId: string, plan: Exclude<PlanKey, 'internal'>): Promise<{ url: string }>;
    customerPortal(agencyId: string): Promise<{ url: string }>;
    /** Server-side only: verify the signature, then update the plan. */
    handleWebhook(rawBody: string, signature: string): Promise<void>;
}
