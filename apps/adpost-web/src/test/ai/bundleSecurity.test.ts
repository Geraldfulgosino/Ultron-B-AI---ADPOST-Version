// @vitest-environment node
/**
 * Client-bundle guard: browser code never imports the server-side provider adapters,
 * secret resolver or execution service, and never reads secret environment variables.
 * If a production build exists, it is scanned for credential-shaped strings too.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) files(p, out);
        else out.push(p);
    }
    return out;
}

const SRC = join(process.cwd(), 'src');
const browserFiles = files(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${join('src', 'test')}`));

describe('no secrets or server runtime in the browser bundle', () => {
    it('browser code imports only type-level or pure modules from the shared AI runtime', () => {
        const forbidden = /_shared\/ai\/(anthropic|openai|registry|execution|http|connectionTest|tools|seoTools|orchestrator)\.ts/;
        const offenders = browserFiles.filter((f) => forbidden.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('browser code reads no secret env vars (only VITE_ public config)', () => {
        const offenders: string[] = [];
        for (const f of browserFiles) {
            const text = readFileSync(f, 'utf8');
            for (const m of text.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
                if (!['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_DATA_PROVIDER', 'VITE_BACKEND', 'DEV', 'PROD', 'MODE'].includes(m[1]!)) offenders.push(`${f}: ${m[1]}`);
            }
            if (/Deno\.env|process\.env\.(ANTHROPIC|OPENAI)/.test(text)) offenders.push(`${f}: server env access`);
        }
        expect(offenders).toEqual([]);
    });

    it('the production build (when present) contains no credential-shaped strings', () => {
        const dist = join(process.cwd(), 'dist');
        if (!existsSync(dist)) return;
        const hits = files(dist).filter((f) => f.endsWith('.js')).filter((f) => /sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|"x-api-key"/.test(readFileSync(f, 'utf8')));
        expect(hits).toEqual([]);
    });
});
