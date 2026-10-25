/**
 * LLM provider boundary (ADR-004). The browser only ever talks to the
 * SimulatedProvider; live providers run inside the `agent-execute` Edge
 * Function with server-held keys (Phase 17) and return the same shape.
 */
import type { AgentTemplateKey, ApprovalKind, ExecutionMode, TaskPriority, ToolKey } from '@/domain/types';
import { estimateTokens } from '@/domain/agents';
import { hashString, mulberry32 } from '@/lib/random';

export interface BrandContext {
    kpis: { sessions: number; clicks: number; impressions: number; conversions: number; window: string | null };
    insights: Array<{ title: string; type: string; severity: string }>;
    topQueries: Array<{ query: string; clicks: number; impressions: number }>;
    knowledge: Array<{ title: string; excerpt: string }>;
    teammates: Array<{ handle: string; name: string; active: boolean }>;
}

export interface ChatTurn {
    role: 'user' | 'assistant';
    name: string;
    content: string;
}

export interface CompletionRequest {
    agent: { templateKey: AgentTemplateKey; displayName: string; handle: string };
    brandName: string;
    instructions: string;
    context: BrandContext;
    messages: ChatTurn[];
    maxOutputTokens: number;
    allowedTools: ToolKey[];
}

export type ProposedAction =
    | { type: 'create_task'; title: string; description: string; priority: TaskPriority }
    | { type: 'request_approval'; kind: ApprovalKind; title: string; summary: string }
    | { type: 'delegate'; handle: string; brief: string };

export interface CompletionResponse {
    text: string;
    actions: ProposedAction[];
    inputTokens: number;
    outputTokens: number;
    mode: ExecutionMode;
    model: string;
    truncated: boolean;
}

export interface LlmProvider {
    readonly mode: ExecutionMode;
    readonly model: string;
    complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export class ProviderError extends Error {
    constructor(message: string, readonly retryable = true) {
        super(message);
        this.name = 'ProviderError';
    }
}

/** Typing this token in a message makes the simulated provider fail (for exercising retry UI). */
export const SIMULATE_FAILURE_TOKEN = '#simulate-failure';

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/**
 * Deterministic offline provider. Output depends only on the request, so tests
 * and demos are reproducible. It reasons over the real brand context passed in
 * (KPIs, insights, queries, knowledge) and never pretends to be a live model.
 */
export class SimulatedProvider implements LlmProvider {
    readonly mode = 'simulated' as const;
    readonly model = 'sim-deterministic-1';

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
        const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (last.includes(SIMULATE_FAILURE_TOKEN)) throw new ProviderError('Simulated provider failure (requested via #simulate-failure).');

        const prompt = req.instructions + '\n' + req.messages.map((m) => `${m.name}: ${m.content}`).join('\n');
        const rand = mulberry32(hashString(req.agent.handle + '|' + prompt));
        const q = last.toLowerCase();
        const { text: body, actions } = respond(req, q, rand);
        const allowed = actions.filter((a) =>
            a.type === 'create_task' ? req.allowedTools.includes('create_task')
            : a.type === 'delegate' ? req.allowedTools.includes('delegate') && req.context.teammates.some((t) => t.handle === a.handle && t.active)
            : req.allowedTools.includes('request_approval'),
        );

        let text = body;
        let truncated = false;
        const maxChars = req.maxOutputTokens * 4;
        if (text.length > maxChars) {
            text = text.slice(0, Math.max(0, maxChars - 40)).trimEnd() + '\n\n[Truncated at the output token limit.]';
            truncated = true;
        }
        return { text, actions: allowed, inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(text), mode: 'simulated', model: this.model, truncated };
    }
}

const n = (v: number) => new Intl.NumberFormat('en-US').format(v);

function kpiLine(c: BrandContext): string {
    if (!c.kpis.window) return 'There is no synced analytics data yet, so I cannot quantify performance.';
    const ctr = c.kpis.impressions ? ((c.kpis.clicks / c.kpis.impressions) * 100).toFixed(2) : '0.00';
    return `In ${c.kpis.window}: ${n(c.kpis.sessions)} sessions, ${n(c.kpis.conversions)} conversions, ${n(c.kpis.clicks)} search clicks from ${n(c.kpis.impressions)} impressions (${ctr}% CTR).`;
}

function insightLines(c: BrandContext, type?: string, limit = 3): string[] {
    return c.insights.filter((i) => !type || i.type === type).slice(0, limit).map((i) => `- [${i.severity}] ${i.title}`);
}

function knowledgeNote(c: BrandContext): string {
    return c.knowledge.length ? `Brand knowledge used: ${c.knowledge.map((k) => `"${k.title}"`).join(', ')}.` : 'No brand knowledge documents matched; I followed general best practice.';
}

function respond(req: CompletionRequest, q: string, rand: () => number): { text: string; actions: ProposedAction[] } {
    const c = req.context;
    const actions: ProposedAction[] = [];
    const lines: string[] = [];
    const topInsight = c.insights[0];
    const topQuery = c.topQueries[0];

    switch (req.agent.templateKey) {
        case 'seo_manager': {
            lines.push(`Here is my read on ${req.brandName}.`, kpiLine(c));
            const open = insightLines(c, undefined, 4);
            if (open.length) lines.push('', 'Priority opportunities:', ...open);
            lines.push('', 'Plan for this week:');
            lines.push('1. Fix anything blocking data collection or indexing first.');
            lines.push('2. Rewrite titles and meta descriptions for high-impression, low-CTR queries.');
            lines.push('3. Strengthen pages that rank in positions 4–20.');
            const wantsTech = has(q, 'technical', 'crawl', 'index', 'speed', 'audit');
            const wantsContent = has(q, 'content', 'brief', 'blog', 'meta', 'title', 'keyword');
            const wantsStats = has(q, 'report', 'trend', 'number', 'forecast', 'why', 'drop');
            if (wantsTech || (!wantsContent && !wantsStats)) actions.push({ type: 'delegate', handle: 'technical-seo', brief: 'Audit the technical issues behind the open insights and list the fixes.' });
            if (wantsContent || (!wantsTech && !wantsStats)) actions.push({ type: 'delegate', handle: 'content-seo', brief: topQuery ? `Draft a title/meta rewrite and brief for "${topQuery.query}".` : 'Draft briefs for the top query opportunities.' });
            if (wantsStats) actions.push({ type: 'delegate', handle: 'statistics-seo', brief: 'Quantify the trend and confirm whether the change is significant.' });
            if (topInsight) actions.push({ type: 'create_task', title: `Address: ${topInsight.title}`.slice(0, 120), description: 'Raised by the SEO Manager from the open insight queue.', priority: topInsight.severity === 'high' ? 'high' : 'medium' });
            break;
        }
        case 'technical_seo': {
            lines.push(`Technical review for ${req.brandName} (simulated audit; no live crawl was run):`);
            const tech = insightLines(c, 'technical_issue');
            lines.push(...(tech.length ? tech : ['- No open technical issues were raised by the rule engine.']));
            const checks = ['XML sitemap freshness', 'canonical tags on paginated pages', 'Largest Contentful Paint on mobile', 'structured data (Organization, Product, FAQ)', 'internal links to orphaned pages', 'robots.txt rules'];
            const pick = checks.filter(() => rand() > 0.45).slice(0, 3);
            lines.push('', 'Recommended checks:', ...(pick.length ? pick : checks.slice(0, 2)).map((x) => `- Verify ${x}.`));
            if (tech.length || has(q, 'fix', 'task')) actions.push({ type: 'create_task', title: 'Resolve technical SEO findings', description: lines.slice(1).join('\n').slice(0, 500), priority: tech.length ? 'high' : 'medium' });
            break;
        }
        case 'content_seo': {
            const target = c.topQueries.find((x) => x.impressions > 0 && x.clicks / x.impressions < 0.03) ?? topQuery;
            lines.push(`Content plan for ${req.brandName}.`);
            if (target) {
                lines.push(`Target query: "${target.query}" (${n(target.impressions)} impressions, ${n(target.clicks)} clicks).`);
                lines.push('', 'Proposed title: ' + titleCase(target.query) + ` | ${req.brandName}`);
                lines.push('Proposed meta description: ' + `Discover ${target.query} from ${req.brandName}. Compare options, see answers to common questions, and get started today.`.slice(0, 155));
                lines.push('', 'Brief outline:', '- Search intent and the answer in the first 100 words', '- Comparison table', '- FAQ section with schema', '- Clear call to action');
            } else lines.push('No query data is available yet. Connect Search Console to target real searches.');
            lines.push('', knowledgeNote(c));
            actions.push({ type: 'create_task', title: target ? `Content brief: ${target.query}` : 'Content brief backlog', description: 'Brief drafted by the Content SEO Agent.', priority: 'medium' });
            if (has(q, 'publish', 'go live', 'post it')) actions.push({ type: 'request_approval', kind: 'publish_content', title: `Publish content for "${target?.query ?? 'brand page'}"`, summary: 'The Content SEO Agent asks to publish the drafted copy.' });
            break;
        }
        case 'statistics_seo': {
            lines.push(`Measurement summary for ${req.brandName}.`, kpiLine(c));
            if (c.kpis.window && c.kpis.sessions) {
                const rate = ((c.kpis.conversions / c.kpis.sessions) * 100).toFixed(2);
                lines.push(`Conversion rate: ${rate}%. A change below ±10% over one 28-day window is within normal week-to-week variance.`);
            }
            if (c.topQueries.length) {
                lines.push('', 'Top queries by clicks:', ...c.topQueries.slice(0, 5).map((x) => `- ${x.query}: ${n(x.clicks)} clicks / ${n(x.impressions)} impressions`));
            }
            lines.push('', 'These numbers come only from synced brand data. Nothing is extrapolated beyond it.');
            break;
        }
        case 'web_design': {
            lines.push(`Design recommendations for ${req.brandName}:`);
            const conv = insightLines(c, 'conversion_gap', 2);
            if (conv.length) lines.push('Pages with weak conversion:', ...conv);
            lines.push('', '- Put a single primary call to action above the fold, in the brand colour.', '- Use a 16px minimum body size with a 1.5 line height for readability.', '- Ensure text contrast of at least 4.5:1 and visible focus states.', '- Add trust signals (reviews, guarantees) next to the CTA.');
            lines.push('', knowledgeNote(c));
            if (has(q, 'build', 'implement', 'develop', 'code')) actions.push({ type: 'delegate', handle: 'web-development', brief: 'Implement the CTA and layout changes as a reviewable proposal.' });
            actions.push({ type: 'create_task', title: 'Design review: primary landing page', description: 'UX recommendations from the Web Design Agent.', priority: 'medium' });
            break;
        }
        case 'web_development': {
            lines.push(`Implementation proposal for ${req.brandName} (proposal only; nothing has been deployed):`);
            lines.push('', '1. Add JSON-LD Organization + FAQ schema to the page template.', '2. Lazy-load below-the-fold images and set explicit width/height to cut layout shift.', '3. Preload the primary web font and inline critical CSS.', '', 'Test plan: Lighthouse before/after, Rich Results test, visual regression on key templates.');
            actions.push({ type: 'create_task', title: 'Dev proposal: schema + performance', description: 'Change proposal from the Web Development Agent.', priority: 'medium' });
            if (has(q, 'deploy', 'release', 'ship', 'go live')) actions.push({ type: 'request_approval', kind: 'deploy_change', title: 'Deploy schema + performance changes', summary: 'The Web Development Agent requests approval to deploy the proposed changes.' });
            break;
        }
    }
    return { text: lines.join('\n'), actions };
}

function titleCase(s: string): string {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
