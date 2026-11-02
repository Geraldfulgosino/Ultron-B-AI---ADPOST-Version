import { AUTHORIZED_PROJECT_REF, ConfigError, readSupabaseConfig, selectProvider } from './config';
import { checkConnection } from './client';

const URL_OK = `https://${AUTHORIZED_PROJECT_REF}.supabase.co`;
const KEY_OK = 'sb_publishable_' + 'x'.repeat(30);
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.sig`;

describe('selectProvider', () => {
    it('defaults to mock and accepts the legacy VITE_BACKEND=local alias', () => {
        expect(selectProvider({})).toBe('mock');
        expect(selectProvider({ VITE_BACKEND: 'local' })).toBe('mock');
        expect(selectProvider({ VITE_DATA_PROVIDER: 'MOCK' })).toBe('mock');
        expect(selectProvider({ VITE_DATA_PROVIDER: 'supabase' })).toBe('supabase');
    });

    it('rejects unknown providers', () => {
        expect(() => selectProvider({ VITE_DATA_PROVIDER: 'firebase' })).toThrow(ConfigError);
    });
});

describe('readSupabaseConfig', () => {
    it('accepts the authorized staging project with a publishable or legacy anon key', () => {
        expect(readSupabaseConfig({ VITE_SUPABASE_URL: URL_OK + '/', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toEqual({
            url: URL_OK,
            publishableKey: KEY_OK,
            projectRef: AUTHORIZED_PROJECT_REF,
        });
        expect(readSupabaseConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).projectRef).toBe(AUTHORIZED_PROJECT_REF);
    });

    it('names missing or placeholder variables without echoing values', () => {
        expect(() => readSupabaseConfig({})).toThrow(/VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/);
        expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: '<COPY_THE_PUBLISHABLE_KEY_FROM_THE_SUPABASE_DASHBOARD>' })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    });

    it('refuses any other Supabase project, non-HTTPS and non-Supabase hosts', () => {
        expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(/not the authorized staging project/);
        expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: `http://${AUTHORIZED_PROJECT_REF}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(/https/);
        expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'https://evil.example.test', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(ConfigError);
    });

    it('refuses secret and service-role keys, and the message never contains the key', () => {
        const secret = 'sb_secret_' + 'S'.repeat(30);
        for (const key of [secret, jwt('service_role')]) {
            let message = '';
            try {
                readSupabaseConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: key });
            } catch (e) {
                message = (e as Error).message;
            }
            expect(message).toMatch(/SECRET \/ service-role key/);
            expect(message).not.toContain(key);
        }
        expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'not-a-key' })).toThrow(/does not look like/);
    });
});

describe('checkConnection', () => {
    const config = { url: URL_OK, publishableKey: KEY_OK, projectRef: AUTHORIZED_PROJECT_REF };

    it('reports ok / rejected / unreachable without leaking the key', async () => {
        const calls: Array<[string, RequestInit | undefined]> = [];
        const ok = await checkConnection(config, (async (u: string, init?: RequestInit) => {
            calls.push([u, init]);
            return new Response('{}', { status: 200 });
        }) as typeof fetch);
        expect(ok.state).toBe('ok');
        expect(calls[0]![0]).toBe(`${URL_OK}/auth/v1/health`);

        expect(await checkConnection(config, (async () => new Response('', { status: 401 })) as typeof fetch)).toEqual({ state: 'rejected', httpStatus: 401 });
        const down = await checkConnection(config, (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
        expect(down).toEqual({ state: 'unreachable', detail: 'network error' });
        expect(JSON.stringify([ok, down])).not.toContain(KEY_OK);
    });
});
