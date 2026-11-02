/**
 * ULTRON-B SEO skill registry (Phase 17I). Application-level skill definitions: these are NOT
 * Claude Code slash commands and never execute the upstream CLI. Each skill runs through our
 * own backend (Edge Function or future durable worker) with our authorization and limits.
 *
 * Provenance: methods are adapted (not copied verbatim) from AgriciDaniel/claude-seo,
 * MIT License, Copyright (c) 2026 agricidaniel, inspected at commit UPSTREAM.sha.
 * See docs/development/CLAUDE_SEO_CAPABILITY_MAP.md.
 */
import type { AgentTemplateKey, ToolKey } from './types';

export const UPSTREAM = {
    repo: 'https://github.com/AgriciDaniel/claude-seo',
    sha: '6be93f45064ffbadced572b5d5c95f55fd263af0',
    license: 'MIT',
    copyright: 'Copyright (c) 2026 agricidaniel',
    inspected: '2026-11-02',
} as const;

export type SkillCategory = 'technical' | 'content' | 'ai_search' | 'specialist' | 'analytics';

/**
 * Where a skill executes:
 *  - llm: model reasoning over data we already hold (no network fetch)
 *  - edge: bounded fetch of a few public URLs via the SSRF-safe fetcher (Edge Function)
 *  - worker: crawls / headless rendering / batch jobs (durable worker, not provisioned yet)
 */
export type SkillRuntime = 'llm' | 'edge' | 'worker';

/** Honest lifecycle. Nothing is "live" until verified against real services. */
export type SkillStatus = 'planned' | 'requires_credentials' | 'requires_worker';

export type Credential = 'model_provider' | 'google_oauth' | 'pagespeed_api_key' | 'keyword_data_provider' | 'backlink_data_provider';

export interface SeoSkill {
    id: string;
    name: string;
    category: SkillCategory;
    description: string;
    version: string;
    /** Upstream claude-seo skill(s) whose method is adapted; [] = ULTRON-original. */
    upstream: string[];
    runtime: SkillRuntime;
    requiredTools: ToolKey[];
    requiredCredentials: Credential[];
    allowedAgents: AgentTemplateKey[];
    /** Produces third-party metrics (volumes, rankings, backlinks): must come from an authorized source. */
    externalMetrics: boolean;
    limits: { maxPages: number; timeoutMs: number };
    status: SkillStatus;
    enabledByDefault: boolean;
}

const MODEL: Credential[] = ['model_provider'];
const T = (maxPages: number, timeoutMs: number) => ({ maxPages, timeoutMs });

function skill(
    id: string,
    name: string,
    category: SkillCategory,
    description: string,
    o: { upstream: string[]; runtime: SkillRuntime; tools: ToolKey[]; agents: AgentTemplateKey[]; creds?: Credential[]; external?: boolean; limits?: { maxPages: number; timeoutMs: number } },
): SeoSkill {
    const requiredCredentials = [...MODEL, ...(o.creds ?? [])];
    const status: SkillStatus = o.runtime === 'worker' ? 'requires_worker' : requiredCredentials.length > 1 ? 'requires_credentials' : 'planned';
    return {
        id, name, category, description, version: '0.1.0', upstream: o.upstream, runtime: o.runtime,
        requiredTools: o.tools, requiredCredentials, allowedAgents: o.agents, externalMetrics: o.external ?? false,
        limits: o.limits ?? (o.runtime === 'llm' ? T(0, 60_000) : o.runtime === 'edge' ? T(5, 30_000) : T(500, 15 * 60_000)),
        status, enabledByDefault: false,
    };
}

const TECH: AgentTemplateKey[] = ['technical_seo'];
const CONTENT: AgentTemplateKey[] = ['content_seo'];
const STATS: AgentTemplateKey[] = ['statistics_seo'];
const MGR: AgentTemplateKey[] = ['seo_manager'];

export const SEO_SKILLS: SeoSkill[] = [
    // ── Technical SEO ──
    skill('tech.full_site_audit', 'Full Site Audit', 'technical', 'Crawl a site within limits and score crawlability, indexability, metadata, schema and performance.', { upstream: ['seo-audit', 'seo-technical'], runtime: 'worker', tools: ['audit_site', 'create_task'], agents: TECH }),
    skill('tech.page_audit', 'Single Page Audit', 'technical', 'On-page, metadata, schema, image and performance review of one URL.', { upstream: ['seo-page'], runtime: 'edge', tools: ['audit_site'], agents: TECH, limits: T(1, 20_000) }),
    skill('tech.robots', 'Robots.txt Analysis', 'technical', 'Fetch and parse robots.txt: blocked paths, sitemap directives, AI crawler rules.', { upstream: ['seo-technical'], runtime: 'edge', tools: ['audit_site'], agents: TECH, limits: T(1, 10_000) }),
    skill('tech.sitemap', 'XML Sitemap Analysis', 'technical', 'Validate sitemap format, URL counts, lastmod and index coverage.', { upstream: ['seo-sitemap'], runtime: 'edge', tools: ['audit_site'], agents: TECH, limits: T(5, 20_000) }),
    skill('tech.canonical', 'Canonical Audit', 'technical', 'Check canonical tags for self-reference, conflicts and cross-domain targets.', { upstream: ['seo-technical'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('tech.redirects', 'Redirect Audit', 'technical', 'Trace redirect chains and loops hop by hop (every hop re-validated for SSRF).', { upstream: ['seo-technical'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('tech.indexability', 'Indexability Review', 'technical', 'Combine status codes, robots meta, X-Robots-Tag and canonicals into an indexability verdict.', { upstream: ['seo-technical', 'seo-google'], runtime: 'edge', tools: ['audit_site', 'read_search_console'], agents: TECH }),
    skill('tech.structured_data', 'Structured Data Audit', 'technical', 'Detect and validate Schema.org JSON-LD against required properties.', { upstream: ['seo-schema'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('tech.images', 'Image SEO Audit', 'technical', 'Alt text, dimensions, formats, lazy loading and file sizes.', { upstream: ['seo-images'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('tech.hreflang', 'Hreflang Audit', 'technical', 'Validate language/region codes, return links and x-default.', { upstream: ['seo-hreflang'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('tech.internal_links', 'Internal Linking Audit', 'technical', 'Map internal links, orphan pages and depth within crawl limits.', { upstream: ['seo-audit'], runtime: 'worker', tools: ['audit_site'], agents: TECH }),
    skill('tech.performance', 'Page Performance Analysis', 'technical', 'PageSpeed Insights / CrUX field data for Core Web Vitals.', { upstream: ['seo-google'], runtime: 'edge', tools: ['audit_site'], agents: TECH, creds: ['pagespeed_api_key'] }),

    // ── Content SEO ──
    skill('content.quality', 'Content Quality Audit', 'content', 'Usefulness, thinness, readability and freshness of supplied pages.', { upstream: ['seo-content'], runtime: 'edge', tools: ['read_knowledge'], agents: CONTENT }),
    skill('content.eeat', 'E-E-A-T Review', 'content', 'Experience, expertise, authoritativeness and trust signals on page.', { upstream: ['seo-content'], runtime: 'edge', tools: ['read_knowledge'], agents: CONTENT }),
    skill('content.keyword_mapping', 'Keyword Mapping', 'content', 'Map queries the brand already receives (GSC) to target pages; no invented volumes.', { upstream: ['seo-cluster'], runtime: 'llm', tools: ['read_search_console'], agents: CONTENT }),
    skill('content.brief', 'Content Brief Generation', 'content', 'Brief with intent, outline, entities and internal links, grounded in brand knowledge.', { upstream: ['seo-content-brief'], runtime: 'llm', tools: ['read_knowledge', 'draft_content'], agents: CONTENT }),
    skill('content.topic_clusters', 'Topic Cluster Planning', 'content', 'Hub-and-spoke architecture from observed queries and brand topics.', { upstream: ['seo-cluster'], runtime: 'llm', tools: ['read_search_console', 'read_knowledge'], agents: CONTENT }),
    skill('content.search_intent', 'Search Intent Analysis', 'content', 'Classify intent for observed queries and flag page-type mismatches.', { upstream: ['seo-sxo'], runtime: 'llm', tools: ['read_search_console'], agents: CONTENT }),
    skill('content.gap', 'Content Gap Review', 'content', 'Topics with impressions but weak or missing pages (from GSC data we hold).', { upstream: ['seo-plan'], runtime: 'llm', tools: ['read_search_console', 'read_knowledge'], agents: CONTENT }),
    skill('content.metadata', 'Metadata Optimization', 'content', 'Title and meta description proposals for low-CTR pages; proposals only.', { upstream: ['seo-page'], runtime: 'llm', tools: ['read_search_console', 'draft_content'], agents: CONTENT }),
    skill('content.internal_link_recs', 'Internal Link Recommendations', 'content', 'Suggest contextual internal links between related brand pages.', { upstream: ['seo-cluster'], runtime: 'llm', tools: ['read_knowledge'], agents: CONTENT }),

    // ── AI search optimization ──
    skill('ai.geo_aeo', 'GEO/AEO Review', 'ai_search', 'Citability, entity clarity and passage structure for AI answers.', { upstream: ['seo-geo'], runtime: 'edge', tools: ['read_knowledge'], agents: CONTENT }),
    skill('ai.readiness', 'AI Search Readiness', 'ai_search', 'Combined readiness score from crawler access, structure and entities.', { upstream: ['seo-geo', 'seo-agentic'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('ai.crawler_access', 'AI Crawler Accessibility', 'ai_search', 'robots.txt / meta rules for GPTBot, ClaudeBot, PerplexityBot, Google-Extended.', { upstream: ['seo-geo'], runtime: 'edge', tools: ['audit_site'], agents: TECH, limits: T(1, 10_000) }),
    skill('ai.llms_txt', 'llms.txt Assessment', 'ai_search', 'Presence and structure of /llms.txt.', { upstream: ['seo-geo'], runtime: 'edge', tools: ['audit_site'], agents: TECH, limits: T(1, 10_000) }),
    skill('ai.structured_answers', 'Structured Answer Readiness', 'ai_search', 'Question/answer passages, FAQ and HowTo markup suitability.', { upstream: ['seo-geo', 'seo-schema'], runtime: 'edge', tools: ['read_knowledge'], agents: CONTENT }),
    skill('ai.citation_opportunities', 'AI Citation Opportunity Analysis', 'ai_search', 'Pages likely to be cited and gaps to close, from content we fetched.', { upstream: ['seo-geo'], runtime: 'llm', tools: ['read_knowledge'], agents: CONTENT }),

    // ── Specialist SEO ──
    skill('spec.local', 'Local SEO Review', 'specialist', 'NAP consistency, local schema and location pages on the brand site.', { upstream: ['seo-local'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('spec.ecommerce', 'E-Commerce SEO Review', 'specialist', 'Product schema, faceted navigation and category structure.', { upstream: ['seo-ecommerce'], runtime: 'edge', tools: ['audit_site'], agents: TECH }),
    skill('spec.programmatic', 'Programmatic SEO Planning', 'specialist', 'Template, URL pattern and thin-content safeguards for pages at scale.', { upstream: ['seo-programmatic'], runtime: 'llm', tools: ['read_knowledge', 'create_task'], agents: MGR }),
    skill('spec.international', 'International SEO Review', 'specialist', 'Market targeting, hreflang strategy and localisation structure.', { upstream: ['seo-hreflang'], runtime: 'llm', tools: ['read_knowledge'], agents: MGR }),
    skill('spec.backlinks', 'Backlink Analysis', 'specialist', 'Referring domains, anchors and toxicity. Requires an authorized backlink data provider.', { upstream: ['seo-backlinks', 'seo-dataforseo'], runtime: 'edge', tools: ['read_knowledge'], agents: MGR, creds: ['backlink_data_provider'], external: true }),
    skill('spec.drift', 'SEO Drift Monitoring', 'specialist', 'Baseline SEO-critical elements and diff them on schedule.', { upstream: ['seo-drift'], runtime: 'worker', tools: ['audit_site'], agents: TECH }),

    // ── Analytics and reporting ──
    skill('analytics.ga4', 'GA4 Interpretation', 'analytics', 'Explain GA4 trends from connected data with freshness and source labels.', { upstream: ['seo-google'], runtime: 'llm', tools: ['read_analytics'], agents: STATS, creds: ['google_oauth'] }),
    skill('analytics.gsc', 'GSC Performance Analysis', 'analytics', 'Clicks, impressions, CTR and position changes from connected Search Console.', { upstream: ['seo-google'], runtime: 'llm', tools: ['read_search_console'], agents: STATS, creds: ['google_oauth'] }),
    skill('analytics.pagespeed', 'PageSpeed Interpretation', 'analytics', 'Interpret Lighthouse lab data and CrUX field data.', { upstream: ['seo-google'], runtime: 'edge', tools: ['read_analytics'], agents: STATS, creds: ['pagespeed_api_key'] }),
    skill('analytics.priority_scoring', 'SEO Priority Scoring', 'analytics', 'Rank findings by severity, effort and evidence confidence.', { upstream: ['seo-audit', 'seo-flow'], runtime: 'llm', tools: ['create_task'], agents: MGR }),
    skill('analytics.roadmap', 'SEO Improvement Roadmap', 'analytics', '30/60/90-day plan from verified findings; tasks go to the approval queue.', { upstream: ['seo-plan', 'seo-flow'], runtime: 'llm', tools: ['create_task', 'delegate'], agents: MGR }),
    skill('analytics.report', 'SEO Report Generation', 'analytics', 'Client-ready report from persisted findings with data-source labels.', { upstream: ['seo-google'], runtime: 'llm', tools: ['read_analytics', 'read_search_console'], agents: ['seo_manager', 'statistics_seo'] }),
    skill('analytics.change_comparison', 'Technical SEO Change Comparison', 'analytics', 'Compare two stored audits and summarise regressions/improvements.', { upstream: ['seo-drift'], runtime: 'llm', tools: ['create_task'], agents: ['statistics_seo', 'seo_manager'] }),
];

export function skillsForAgent(agent: AgentTemplateKey): SeoSkill[] {
    return SEO_SKILLS.filter((s) => s.allowedAgents.includes(agent));
}

const CRED_LABELS: Record<Credential, string> = {
    model_provider: 'Model API',
    google_oauth: 'Google OAuth',
    pagespeed_api_key: 'PageSpeed API key',
    keyword_data_provider: 'Keyword data provider',
    backlink_data_provider: 'Backlink data provider',
};

/** Generated docs (docs/development/SEO_SKILL_REGISTRY.md); a test fails if the file drifts. */
export function renderSkillRegistryMarkdown(): string {
    const rows = SEO_SKILLS.map(
        (s) => `| \`${s.id}\` | ${s.name} | ${s.runtime} | ${s.allowedAgents.join(', ')} | ${s.requiredCredentials.map((c) => CRED_LABELS[c]).join(', ')} | ${s.upstream.join(', ') || '—'} | ${s.status} |`,
    );
    return [
        '# SEO Skill Registry',
        '',
        '<!-- GENERATED from apps/adpost-web/src/domain/seoSkills.ts. Do not edit by hand: run `UPDATE_DOCS=1 npx vitest run src/domain/seoSkills.test.ts`. -->',
        '',
        `${SEO_SKILLS.length} application skills. Methods are adapted from [claude-seo](${UPSTREAM.repo}) at \`${UPSTREAM.sha.slice(0, 12)}\` (${UPSTREAM.license}, ${UPSTREAM.copyright}). Skills run only through ULTRON-B's backend, never as Claude Code commands.`,
        '',
        '**No skill is live yet.** `planned` means it needs only the model API. `requires_credentials` means it also needs the listed third-party access. `requires_worker` means it needs the durable worker, which is not provisioned. Every skill is disabled by default per brand.',
        '',
        '| ID | Skill | Runtime | Agents | Credentials | Upstream method | Status |',
        '|---|---|---|---|---|---|---|',
        ...rows,
        '',
    ].join('\n');
}
