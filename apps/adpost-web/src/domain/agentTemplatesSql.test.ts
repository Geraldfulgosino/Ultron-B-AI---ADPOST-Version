import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentTemplatesSql } from './agentTemplatesSql';

const file = resolve(process.cwd(), '../../supabase/migrations/20261025000003_agent_templates.sql');

describe('agent template seed SQL', () => {
    it('matches the TypeScript templates (run `npm run gen:sql` to regenerate)', () => {
        if (process.env.npm_lifecycle_event === 'gen:sql') writeFileSync(file, agentTemplatesSql());
        expect(existsSync(file) && readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(agentTemplatesSql());
    });
});
