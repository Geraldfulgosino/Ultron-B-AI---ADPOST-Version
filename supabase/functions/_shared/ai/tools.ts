/**
 * AIToolGateway: the only path from a model's tool call to an effect.
 *  - Tools are offered only if the agent holds the tool permission (ToolKey) AND the model
 *    supports tools. Every call is re-authorized here; the model cannot widen its tools.
 *  - Actions with effects (tasks, approvals, delegation) become PROPOSALS for humans or the
 *    bounded orchestrator. Nothing is published, deployed or sent from here.
 *  - Results are wrapped as untrusted data; instructions inside them are not followed.
 */
import { UrlSafetyError } from '../urlSafety.ts';
import { llmsTxtSkill, pageMetadataSkill, robotsSkill, sitemapSkill, type FetchDeps, type SkillResult } from './seoTools.ts';
import type { ToolCall, ToolSpec } from './types.ts';

/** Mirrors apps/adpost-web/src/domain/types.ts ToolKey. */
export type AgentToolKey =
    | 'read_analytics' | 'read_search_console' | 'read_knowledge' | 'audit_site' | 'draft_content'
    | 'propose_design' | 'propose_code' | 'create_task' | 'delegate' | 'request_approval';

export type Proposal =
    | { type: 'create_task'; title: string; description: string; priority: 'low' | 'medium' | 'high' | 'urgent' }
    | { type: 'request_approval'; kind: 'publish_content' | 'deploy_change' | 'run_webhook' | 'external_action' | 'budget_increase'; title: string; summary: string }
    | { type: 'delegate'; handle: string; brief: string };

export interface ToolContext {
    brandId: string;
    /** Hosts of the brand's websites (re-read server-side with the caller's JWT). */
    allowedHosts: string[];
    fetchDeps: FetchDeps | null;
    /** RLS-filtered knowledge search for this brand. */
    searchKnowledge?: (query: string) => Promise<Array<{ title: string; excerpt: string }>>;
    /** Connected analytics summary for this brand, or null when nothing is connected. */
    metrics?: (kind: 'analytics' | 'search_console') => Promise<{ source: string; asOf: string; summary: Record<string, unknown> } | null>;
    /** Active teammates that may receive a delegation. */
    teammates: Array<{ handle: string; name: string }>;
}

export interface ToolOutcome {
    content: string;
    isError: boolean;
    proposal?: Proposal;
    skillResult?: SkillResult;
}

interface ToolDef {
    spec: ToolSpec;
    permission: AgentToolKey;
    run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const urlProp = { url: { type: 'string', description: 'Absolute http(s) URL on one of the brand websites.' } };

export function untrusted(source: string, payload: unknown): string {
    return `<untrusted_data source="${source.replace(/"/g, '')}">\n${JSON.stringify(payload)}\n</untrusted_data>`;
}

const err = (message: string): ToolOutcome => ({ content: message, isError: true });

function skillTool(name: string, description: string, skill: (url: string, hosts: string[], deps: FetchDeps) => Promise<SkillResult>): ToolDef {
    return {
        spec: { name, description, inputSchema: obj(urlProp, ['url']) },
        permission: 'audit_site',
        async run(input, ctx) {
            const url = str(input.url, 2048);
            if (!url) return err('A "url" string is required.');
            if (!ctx.fetchDeps) return err('Site fetching is not available in this environment.');
            try {
                const r = await skill(url, ctx.allowedHosts, ctx.fetchDeps);
                return { content: untrusted(r.finalUrl ?? r.url, r), isError: false, skillResult: r };
            } catch (e) {
                if (e instanceof UrlSafetyError) return err(`Fetch refused (${e.reason}): ${e.message}`);
                return err('The site could not be analysed.');
            }
        },
    };
}

export const TOOL_DEFS: ToolDef[] = [
    skillTool('seo_page_audit', 'Fetch one page of a brand website and extract title, meta description, canonical, robots directives, headings, images and structured data, with findings and evidence.', pageMetadataSkill),
    skillTool('seo_robots_txt', 'Fetch and analyse robots.txt for a brand website, including search and AI crawler access.', robotsSkill),
    skillTool('seo_sitemap', 'Fetch and validate the XML sitemap of a brand website (URL counts, lastmod, host consistency).', sitemapSkill),
    skillTool('seo_llms_txt', 'Check whether a brand website publishes /llms.txt and summarise its structure.', llmsTxtSkill),
    {
        spec: { name: 'search_knowledge', description: 'Search this brand\'s knowledge base (brand guide, product facts, policies).', inputSchema: obj({ query: { type: 'string' } }, ['query']) },
        permission: 'read_knowledge',
        async run(input, ctx) {
            const q = str(input.query, 300);
            if (!q) return err('A "query" string is required.');
            if (!ctx.searchKnowledge) return err('Knowledge search is not available.');
            const hits = await ctx.searchKnowledge(q);
            return { content: untrusted('brand_knowledge', hits.length ? hits : { result: 'No matching knowledge documents.' }), isError: false };
        },
    },
    {
        spec: { name: 'read_search_console', description: 'Read the connected Google Search Console summary for this brand (queries, clicks, impressions). Returns "not connected" when no data source exists.', inputSchema: obj({}, []) },
        permission: 'read_search_console',
        async run(_input, ctx) {
            const m = await ctx.metrics?.('search_console');
            return { content: m ? untrusted(m.source, m) : 'Search Console is not connected for this brand. No query data is available; do not estimate it.', isError: false };
        },
    },
    {
        spec: { name: 'read_analytics', description: 'Read the connected GA4 summary for this brand (sessions, conversions, landing pages). Returns "not connected" when no data source exists.', inputSchema: obj({}, []) },
        permission: 'read_analytics',
        async run(_input, ctx) {
            const m = await ctx.metrics?.('analytics');
            return { content: m ? untrusted(m.source, m) : 'Google Analytics is not connected for this brand. No analytics data is available; do not estimate it.', isError: false };
        },
    },
    {
        spec: {
            name: 'propose_task', description: 'Propose a task for a human to accept into the brand\'s project board.',
            inputSchema: obj({ title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] } }, ['title', 'description']),
        },
        permission: 'create_task',
        async run(input) {
            const title = str(input.title, 120);
            if (!title) return err('A "title" is required.');
            const priority = (['low', 'medium', 'high', 'urgent'] as const).find((p) => p === input.priority) ?? 'medium';
            return { content: 'Task proposed. A human must accept it.', isError: false, proposal: { type: 'create_task', title, description: str(input.description, 2000) ?? '', priority } };
        },
    },
    {
        spec: {
            name: 'request_approval', description: 'Ask a human administrator to approve an external action (publish, deploy, webhook). The action does not happen unless a human approves and performs it.',
            inputSchema: obj({ kind: { type: 'string', enum: ['publish_content', 'deploy_change', 'run_webhook', 'external_action', 'budget_increase'] }, title: { type: 'string' }, summary: { type: 'string' } }, ['kind', 'title', 'summary']),
        },
        permission: 'request_approval',
        async run(input) {
            const title = str(input.title, 120);
            const kind = (['publish_content', 'deploy_change', 'run_webhook', 'external_action', 'budget_increase'] as const).find((k) => k === input.kind);
            if (!title || !kind) return err('"kind" and "title" are required.');
            return { content: 'Approval requested. Nothing has been executed.', isError: false, proposal: { type: 'request_approval', kind, title, summary: str(input.summary, 2000) ?? '' } };
        },
    },
    {
        spec: {
            name: 'delegate', description: 'Hand a focused brief to an active teammate agent by handle.',
            inputSchema: obj({ handle: { type: 'string' }, brief: { type: 'string' } }, ['handle', 'brief']),
        },
        permission: 'delegate',
        async run(input, ctx) {
            const handle = str(input.handle, 60)?.replace(/^@/, '');
            const brief = str(input.brief, 2000);
            if (!handle || !brief) return err('"handle" and "brief" are required.');
            if (!ctx.teammates.some((t) => t.handle === handle)) return err(`@${handle} is not an active teammate. Available: ${ctx.teammates.map((t) => '@' + t.handle).join(', ') || 'none'}.`);
            return { content: `Delegated to @${handle}.`, isError: false, proposal: { type: 'delegate', handle, brief } };
        },
    },
];

export const MAX_TOOL_CALLS_PER_TURN = 6;

export class AIToolGateway {
    constructor(private readonly defs: ToolDef[] = TOOL_DEFS) {}

    /** Tools this agent may be offered. */
    toolsFor(permissions: readonly string[]): ToolSpec[] {
        return this.defs.filter((d) => permissions.includes(d.permission)).map((d) => d.spec);
    }

    async run(call: ToolCall, permissions: readonly string[], ctx: ToolContext): Promise<ToolOutcome> {
        const def = this.defs.find((d) => d.spec.name === call.name);
        if (!def) return err(`Unknown tool "${call.name}".`);
        if (!permissions.includes(def.permission)) return err(`Tool "${call.name}" is not permitted for this agent.`);
        try {
            return await def.run(call.input ?? {}, ctx);
        } catch {
            return err(`Tool "${call.name}" failed.`);
        }
    }
}
