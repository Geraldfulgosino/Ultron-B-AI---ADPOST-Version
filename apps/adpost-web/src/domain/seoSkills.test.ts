import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_TEMPLATES } from './agents';
import { renderSkillRegistryMarkdown, SEO_SKILLS, skillsForAgent, UPSTREAM } from './seoSkills';

const DOC = join(process.cwd(), '..', '..', 'docs', 'development', 'SEO_SKILL_REGISTRY.md');
const toolsOf = (key: string) => AGENT_TEMPLATES.find((t) => t.key === key)?.defaultTools ?? [];

describe('SEO skill registry', () => {
    it('defines the 40 target skills with unique ids across all five categories', () => {
        expect(SEO_SKILLS).toHaveLength(40);
        expect(new Set(SEO_SKILLS.map((s) => s.id)).size).toBe(40);
        expect(new Set(SEO_SKILLS.map((s) => s.category))).toEqual(new Set(['technical', 'content', 'ai_search', 'specialist', 'analytics']));
    });

    it('every allowed agent exists and already holds every tool the skill needs', () => {
        for (const s of SEO_SKILLS) {
            expect(s.allowedAgents.length, s.id).toBeGreaterThan(0);
            for (const a of s.allowedAgents) {
                expect(AGENT_TEMPLATES.some((t) => t.key === a), `${s.id}: ${a}`).toBe(true);
                for (const tool of s.requiredTools) expect(toolsOf(a), `${s.id}: ${a} lacks ${tool}`).toContain(tool);
            }
        }
    });

    it('fake-metric guard: skills producing third-party metrics require an authorized data provider', () => {
        for (const s of SEO_SKILLS.filter((x) => x.externalMetrics)) {
            expect(s.requiredCredentials.some((c) => c === 'backlink_data_provider' || c === 'keyword_data_provider'), s.id).toBe(true);
        }
        // Keyword work uses only queries the brand actually receives (GSC), never invented volumes.
        expect(SEO_SKILLS.find((s) => s.id === 'content.keyword_mapping')!.externalMetrics).toBe(false);
    });

    it('nothing is marked live, and everything is disabled by default', () => {
        for (const s of SEO_SKILLS) {
            expect(['planned', 'requires_credentials', 'requires_worker']).toContain(s.status);
            expect(s.enabledByDefault, s.id).toBe(false);
            expect(s.requiredCredentials, s.id).toContain('model_provider');
            if (s.runtime === 'worker') expect(s.status, s.id).toBe('requires_worker');
        }
    });

    it('bounded execution limits for every skill', () => {
        for (const s of SEO_SKILLS) {
            expect(s.limits.timeoutMs, s.id).toBeGreaterThan(0);
            expect(s.limits.timeoutMs, s.id).toBeLessThanOrEqual(15 * 60_000);
            if (s.runtime === 'edge') expect(s.limits.maxPages, s.id).toBeLessThanOrEqual(5);
            if (s.runtime === 'llm') expect(s.limits.maxPages, s.id).toBe(0);
        }
    });

    it('records upstream provenance pinned to an exact commit', () => {
        expect(UPSTREAM.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(UPSTREAM.license).toBe('MIT');
        for (const s of SEO_SKILLS) for (const u of s.upstream) expect(u, s.id).toMatch(/^seo(-[a-z]+)*$/);
    });

    it('every SEO specialist gets skills; the web agents are not given SEO execution skills yet', () => {
        for (const a of ['seo_manager', 'technical_seo', 'content_seo', 'statistics_seo'] as const) expect(skillsForAgent(a).length, a).toBeGreaterThan(0);
        expect(skillsForAgent('web_development')).toEqual([]);
    });

    it('docs/development/SEO_SKILL_REGISTRY.md matches the registry', () => {
        const md = renderSkillRegistryMarkdown();
        if (process.env.UPDATE_DOCS) writeFileSync(DOC, md);
        expect(readFileSync(DOC, 'utf8')).toBe(md);
    });
});
