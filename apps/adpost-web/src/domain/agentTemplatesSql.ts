import { AGENT_TEMPLATES } from './agents';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Seed SQL for public.agent_templates, generated from AGENT_TEMPLATES (single source of truth). */
export function agentTemplatesSql(): string {
    const rows = AGENT_TEMPLATES.map(
        (t) => `    (${q(t.key)}, ${q(t.name)}, ${q(t.handle)}, ${q(t.team)}, ${q(t.description)}, ${q(t.defaultInstructions)}, array[${t.defaultTools.map(q).join(', ')}]::text[])`,
    );
    return `-- Generated from apps/adpost-web/src/domain/agents.ts (npm run gen:sql). Do not edit by hand.
-- PREPARED ONLY; not applied.
insert into public.agent_templates (key, name, handle, team, description, default_instructions, default_tools) values
${rows.join(',\n')}
on conflict (key) do update set
    name = excluded.name, handle = excluded.handle, team = excluded.team, description = excluded.description,
    default_instructions = excluded.default_instructions, default_tools = excluded.default_tools;
`;
}
