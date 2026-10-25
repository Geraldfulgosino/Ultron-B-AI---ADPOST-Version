/**
 * Backend contract suite. Uses ONLY the public `Backend` interface, so the
 * Supabase adapter (Phase 17) must pass exactly the same scenarios as the local
 * adapter. Requires a backend seeded with the synthetic fixture tenants:
 * brands `pod` and `dmd`, plus users priya (POD owner), vic (POD viewer),
 * casey (POD client of the first POD client) and dana (DMD manager).
 */
import type { Backend } from '@/data/contracts';

export interface ContractFixture {
    password: string;
    emails: { podOwner: string; podViewer: string; podClient: string; dmdManager: string };
}

const isDenied = async (p: Promise<unknown>) => {
    try {
        await p;
        return false;
    } catch (e) {
        return e instanceof Error && /AccessDenied|NotFound/.test(e.name);
    }
};

export function runBackendContract(name: string, makeBackend: () => Backend | Promise<Backend>, fx: ContractFixture): void {
    describe(`backend contract: ${name}`, () => {
        async function as(email: string) {
            const backend = await makeBackend();
            await backend.auth.signIn(email, fx.password);
            const api = backend.api();
            const brands = await api.workspace.listBrands();
            const bySlug = (slug: string) => brands.find((b) => b.brand.slug === slug)?.brand.id;
            return { backend, api, brands, bySlug };
        }

        it('rejects bad credentials and requires a session', async () => {
            const backend = await makeBackend();
            await expect(backend.auth.signIn(fx.emails.podOwner, 'definitely-wrong')).rejects.toThrow();
            expect(() => backend.api()).toThrow();
        });

        it('a brand member sees only their brands', async () => {
            const { brands } = await as(fx.emails.podOwner);
            expect(brands.map((b) => b.brand.slug)).toEqual(['pod']);
        });

        it('cross-brand reads and writes are denied on every brand-owned resource', async () => {
            const dana = await as(fx.emails.dmdManager);
            const dmdId = dana.bySlug('dmd')!;
            const priya = await as(fx.emails.podOwner);
            const deniedReads = await Promise.all([
                isDenied(priya.api.clients.list(dmdId)),
                isDenied(priya.api.websites.list(dmdId)),
                isDenied(priya.api.members.list(dmdId)),
                isDenied(priya.api.analytics.dashboard(dmdId)),
                isDenied(priya.api.insights.list(dmdId)),
                isDenied(priya.api.agents.list(dmdId)),
                isDenied(priya.api.chat.list(dmdId)),
                isDenied(priya.api.work.tasks(dmdId)),
                isDenied(priya.api.knowledge.list(dmdId)),
                isDenied(priya.api.studio.list(dmdId)),
                isDenied(priya.api.reports.preview(dmdId, { from: '2026-10-01', to: '2026-10-24', websiteId: null, source: 'all' })),
            ]);
            expect(deniedReads.every(Boolean)).toBe(true);
            expect(await isDenied(priya.api.clients.create(dmdId, { name: 'Injected' }))).toBe(true);
            expect((await dana.api.clients.list(dmdId)).some((c) => c.name === 'Injected')).toBe(false);
        });

        it('ids from another brand cannot be smuggled through an allowed brand', async () => {
            const dana = await as(fx.emails.dmdManager);
            const dmdClient = (await dana.api.clients.list(dana.bySlug('dmd')!))[0]!;
            const priya = await as(fx.emails.podOwner);
            const podId = priya.bySlug('pod')!;
            expect(await isDenied(priya.api.clients.get(podId, dmdClient.id))).toBe(true);
            expect(await isDenied(priya.api.clients.update(podId, dmdClient.id, { name: 'x' }))).toBe(true);
        });

        it('viewers read but cannot write', async () => {
            const vic = await as(fx.emails.podViewer);
            const podId = vic.bySlug('pod')!;
            expect((await vic.api.clients.list(podId)).length).toBeGreaterThan(0);
            await expect(vic.api.clients.create(podId, { name: 'Nope' })).rejects.toThrow();
        });

        it('client users are scoped to their client and denied staff areas', async () => {
            const casey = await as(fx.emails.podClient);
            const podId = casey.bySlug('pod')!;
            expect(await casey.api.clients.list(podId)).toHaveLength(1);
            const sites = await casey.api.websites.list(podId);
            expect(new Set(sites.map((w) => w.clientId)).size).toBe(1);
            expect(await isDenied(casey.api.agents.list(podId))).toBe(true);
            expect(await isDenied(casey.api.chat.list(podId))).toBe(true);
            expect(await isDenied(casey.api.knowledge.list(podId))).toBe(true);
        });

        it('integration listings never include credential fields', async () => {
            const priya = await as(fx.emails.podOwner);
            const list = await priya.api.integrations.list(priya.bySlug('pod')!);
            expect(list.flatMap((i) => Object.keys(i)).filter((k) => /token|secret|credential|password/i.test(k))).toEqual([]);
        });

        it('agent replies are labelled with their execution mode', async () => {
            const priya = await as(fx.emails.podOwner);
            const podId = priya.bySlug('pod')!;
            const [agent] = await priya.api.agents.list(podId);
            const c = await priya.api.chat.createDirect(podId, agent!.id);
            const { replies } = await priya.api.chat.send(podId, c.id, { body: 'Status update please' });
            expect(replies.every((r) => r.mode === 'simulated' || r.mode === 'live')).toBe(true);
        });
    });
}
