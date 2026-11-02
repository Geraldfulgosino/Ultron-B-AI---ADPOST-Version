/**
 * AIUsageService budget checks. Application limits are safeguards, not provider billing
 * controls: owners must also set spend limits in the provider console.
 *
 * Fail-closed rules
 *  - Cost is computed only from admin-entered, sourced prices. Without them a USD budget
 *    cannot be enforced, so a live call then requires a monthly token ceiling instead.
 *  - Checks use the worst case (estimated input + the full output cap) before any call.
 *  - The output cap is lowered to fit a per-request cost limit when possible.
 */
import type { ConnectionConfig, ModelCatalogEntry, RoutingPolicy } from './routing.ts';

export interface UsageSnapshot {
    orgMonthCostUsd: number;
    orgMonthRequests: number;
    orgMonthTokens: number;
    brandMonthCostUsd: number;
    brandMonthRequests: number;
    brandMonthTokens: number;
    userMonthCostUsd: number;
    agentMonthCostUsd: number;
    agentRunsToday: number;
    connectionMonthCostUsd: number;
    connectionMonthRequests: number;
}

export const EMPTY_USAGE: UsageSnapshot = {
    orgMonthCostUsd: 0, orgMonthRequests: 0, orgMonthTokens: 0, brandMonthCostUsd: 0, brandMonthRequests: 0, brandMonthTokens: 0,
    userMonthCostUsd: 0, agentMonthCostUsd: 0, agentRunsToday: 0, connectionMonthCostUsd: 0, connectionMonthRequests: 0,
};

export interface AgentLimits {
    maxOutputTokens: number;
    maxRunsPerDay: number;
    monthlyBudgetUsd: number;
}

export interface BudgetInput {
    live: boolean;
    agent: AgentLimits;
    connection: ConnectionConfig;
    model: ModelCatalogEntry | null;
    brandPolicy: RoutingPolicy | null;
    orgPolicy: RoutingPolicy | null;
    usage: UsageSnapshot;
    estimatedInputTokens: number;
    requestedOutputTokens: number;
}

export type BudgetDecision = { ok: true; maxOutputTokens: number; priced: boolean } | { ok: false; reason: string };

export function priceOf(model: ModelCatalogEntry | null): { input: number; output: number; version: string | null } | null {
    if (!model || model.inputUsdPerMTok === null || model.outputUsdPerMTok === null) return null;
    return { input: model.inputUsdPerMTok, output: model.outputUsdPerMTok, version: model.pricingVersion };
}

export function costUsd(model: ModelCatalogEntry | null, inputTokens: number, outputTokens: number): number | null {
    const p = priceOf(model);
    if (!p) return null;
    return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * 1e6) / 1e6;
}

const minDefined = (...xs: Array<number | null | undefined>) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? Math.min(...v) : null;
};

/** ~4 characters per token. Used only for the pre-call worst case, never for billing. */
export function estimateInputTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}

export function checkBudget(b: BudgetInput): BudgetDecision {
    const { usage: u, brandPolicy: bp, orgPolicy: op, connection: c } = b;
    let maxOut = Math.min(b.requestedOutputTokens, b.agent.maxOutputTokens, c.maxOutputTokens, b.model?.maxOutputTokens ?? Infinity);
    if (maxOut < 1) return { ok: false, reason: 'The output token limit is zero.' };

    if (u.agentRunsToday >= b.agent.maxRunsPerDay) return { ok: false, reason: `Daily run limit reached (${b.agent.maxRunsPerDay}).` };
    if (!b.live) return { ok: true, maxOutputTokens: maxOut, priced: false };

    const reqLimits: Array<[number | null, number, string]> = [
        [c.monthlyRequestLimit, u.connectionMonthRequests, 'connection'],
        [bp?.monthlyRequestLimit ?? null, u.brandMonthRequests, 'brand'],
        [op?.monthlyRequestLimit ?? null, u.orgMonthRequests, 'organization'],
    ];
    for (const [limit, used, level] of reqLimits) {
        if (limit !== null && used >= limit) return { ok: false, reason: `Monthly request limit for the ${level} reached (${limit}).` };
    }

    const worstTokens = b.estimatedInputTokens + maxOut;
    const tokenLimits: Array<[number | null, number, string]> = [
        [bp?.monthlyTokenLimit ?? null, u.brandMonthTokens, 'brand'],
        [op?.monthlyTokenLimit ?? null, u.orgMonthTokens, 'organization'],
    ];
    for (const [limit, used, level] of tokenLimits) {
        if (limit !== null && used + worstTokens > limit) return { ok: false, reason: `Monthly token limit for the ${level} would be exceeded (${limit.toLocaleString('en-US')} tokens).` };
    }
    const hasTokenCeiling = tokenLimits.some(([limit]) => limit !== null);

    const price = priceOf(b.model);
    if (!price) {
        if (!hasTokenCeiling) {
            return { ok: false, reason: 'This model has no verified price, so USD budgets cannot be enforced. Enter verified prices for the model or set a monthly token limit for the brand or organization.' };
        }
        return { ok: true, maxOutputTokens: maxOut, priced: false };
    }

    const perRequest = minDefined(c.maxCostPerRequestUsd, bp?.maxCostPerRequestUsd, op?.maxCostPerRequestUsd);
    const cost = (out: number) => (b.estimatedInputTokens * price.input + out * price.output) / 1_000_000;
    if (perRequest !== null && cost(maxOut) > perRequest) {
        const fit = Math.floor(((perRequest * 1_000_000) - b.estimatedInputTokens * price.input) / price.output);
        if (fit < 64) return { ok: false, reason: `The per-request cost limit ($${perRequest}) is too low for this conversation.` };
        maxOut = Math.min(maxOut, fit);
    }
    const worst = cost(maxOut);
    const monthly: Array<[number | null | undefined, number, string]> = [
        [b.agent.monthlyBudgetUsd, u.agentMonthCostUsd, 'agent'],
        [c.monthlyBudgetUsd, u.connectionMonthCostUsd, 'connection'],
        [bp?.monthlyBudgetUsd, u.brandMonthCostUsd, 'brand'],
        [bp?.perUserMonthlyBudgetUsd ?? op?.perUserMonthlyBudgetUsd, u.userMonthCostUsd, 'user'],
        [op?.monthlyBudgetUsd, u.orgMonthCostUsd, 'organization'],
    ];
    for (const [limit, used, level] of monthly) {
        if (typeof limit === 'number' && used + worst > limit) return { ok: false, reason: `Monthly ${level} budget reached ($${limit}).` };
    }
    return { ok: true, maxOutputTokens: maxOut, priced: true };
}
