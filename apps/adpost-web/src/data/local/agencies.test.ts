/** Agencies, clients, websites and roles on the dev sample seed (mirrors hierarchy.db.test.ts and roles.db.test.ts). */
import { AccessDeniedError, ValidationError } from '../errors';
import { apiFor } from './backend';
import { LocalDatabase } from './db';
import { ARCHIVED_SAMPLE_CLIENTS, applySampleSeed, buildSampleSeed, sampleClientId } from './sampleSeed';
import { isAuditable } from '@/domain/websites';

const sampleDb = () => {
    const { snapshot, credentials } = buildSampleSeed();
    return new LocalDatabase(snapshot, credentials, { now: () => new Date('2026-11-13T12:00:00.000Z') });
};
const api = (db: LocalDatabase, userId: string) => apiFor(db, userId);
const POD = sampleClientId('adpost', 'pod');
const DSP = sampleClientId('adpost', 'dsp');
const LIPSKY = sampleClientId('vca', 'lipsky');
const CMS = sampleClientId('vca', 'cms');
const active = (db: LocalDatabase, agencySlug: string) => db.all('brands').filter((b) => b.agencySlug === agencySlug && b.status === 'active').map((b) => b.name).sort();

describe('dev sample seed (reconciled 2026-11-13)', () => {
    it('3 agencies; target clients active; non-target clients archived, not deleted', () => {
        const db = sampleDb();
        expect(db.all('agencies').map((a) => a.name).sort()).toEqual(['ADPOST', 'GoldStarATM', 'VCA']);
        expect(active(db, 'vca')).toEqual(['CMS', 'HLDC', 'LIPSKY', 'LOOP19']);
        expect(active(db, 'adpost')).toEqual(['CAR MAGNETS', 'DYNAMIC SCREEN PRINTING', 'FMF', 'POD']);
        expect(active(db, 'lugenix-digital-services')).toEqual(['ATM FLORIDA', 'ATM HAWAII', 'ATM NEBRASKA', 'ATM OHIO']);
        expect(db.all('brands').filter((b) => b.status === 'archived').map((b) => b.slug).sort()).toEqual([...ARCHIVED_SAMPLE_CLIENTS].sort());
        expect(db.all('brands')).toHaveLength(15);
        expect(db.all('agentInstances')).toHaveLength(90);
        // DSP and HAMPTONS kept their ids and slugs (same clients, new names).
        expect(db.find('brands', DSP)).toMatchObject({ slug: 'dsp', name: 'DYNAMIC SCREEN PRINTING' });
        expect(db.find('brands', sampleClientId('vca', 'hamptons'))).toMatchObject({ slug: 'hamptons', name: 'HLDC' });
        for (const t of ['dailyMetrics', 'searchQueries', 'seoInsights', 'integrations', 'knowledgeDocuments', 'invitations'] as const) expect(db.all(t), t).toHaveLength(0);
    });

    it('30 demo websites: production (primary) + staging per client on reserved .example domains, nothing connected', () => {
        const db = sampleDb();
        const sites = db.all('websites');
        expect(sites).toHaveLength(30);
        expect(sites.every((w) => w.isDemo && w.platform === 'unknown' && !w.ga4PropertyId && !isAuditable(w))).toBe(true);
        for (const b of db.all('brands')) {
            const own = sites.filter((w) => w.brandId === b.id).sort((x, y) => x.environment.localeCompare(y.environment));
            expect(own.map((w) => [w.name, w.domain, w.isPrimary]), b.name).toEqual([
                [`${b.name} — Production`, `${b.slug}.example`, true],
                [`${b.name} — Staging`, `staging.${b.slug}.example`, false],
            ]);
        }
    });

    it('reconciles an older stored snapshot once: renames, archives and additions; never undoes later user changes', () => {
        const old = buildSampleSeed().snapshot;
        // Simulate the pre-2026-11-13 state.
        old.seedSteps = [];
        old.agencies.find((a) => a.slug === 'lugenix-digital-services')!.name = 'Lugenix Digital Services';
        const dsp = old.brands.find((b) => b.id === DSP)!;
        dsp.name = 'DSP';
        for (const w of old.websites) if (w.brandId === DSP) w.name = w.name.replace('DYNAMIC SCREEN PRINTING', 'DSP');
        for (const b of old.brands) if (ARCHIVED_SAMPLE_CLIENTS.includes(b.slug)) { b.status = 'active'; b.archivedAt = null; }
        old.brands = old.brands.filter((b) => !b.slug.startsWith('atm-') && b.slug !== 'car-magnets');
        const once = applySampleSeed(old);
        expect(once.agencies.find((a) => a.slug === 'lugenix-digital-services')!.name).toBe('GoldStarATM');
        expect(once.brands.find((b) => b.id === DSP)!.name).toBe('DYNAMIC SCREEN PRINTING');
        expect(once.websites.filter((w) => w.brandId === DSP).map((w) => w.name).sort()).toEqual(['DYNAMIC SCREEN PRINTING — Production', 'DYNAMIC SCREEN PRINTING — Staging']);
        expect(once.brands.filter((b) => b.status === 'archived').map((b) => b.slug).sort()).toEqual([...ARCHIVED_SAMPLE_CLIENTS].sort());
        expect(once.brands).toHaveLength(15);
        // A user restores TRADE BAGS afterwards: re-seeding does not archive it again.
        once.brands.find((b) => b.slug === 'trade-bags')!.status = 'active';
        expect(applySampleSeed(once).brands.find((b) => b.slug === 'trade-bags')!.status).toBe('active');
        expect(applySampleSeed(once).brands).toHaveLength(15);
    });

    it('re-seeding preserves user websites and their primary flag', () => {
        const { snapshot } = buildSampleSeed();
        const fmf = sampleClientId('adpost', 'fmf');
        const s = structuredClone(snapshot);
        s.websites = s.websites.filter((w) => w.brandId !== fmf);
        s.websites.push({ ...snapshot.websites.find((w) => w.brandId === fmf)!, id: 'web_user', name: 'FMF user site', domain: 'fmf-user.example.com', websiteUrl: 'https://fmf-user.example.com', isDemo: false, isPrimary: true });
        const again = applySampleSeed(s);
        expect(again.websites.filter((w) => w.brandId === fmf).map((w) => [w.name, w.isPrimary])).toEqual([['FMF user site', true], ['FMF — Production', false], ['FMF — Staging', false]]);
        expect(again.websites).toHaveLength(31);
    });
});

describe('Super Admin', () => {
    it('sees every agency with real counts, platform totals and every client', async () => {
        const db = sampleDb();
        const p = api(db, 'usr_platform');
        expect(await p.agencies.isPlatformAdmin()).toBe(true);
        expect((await p.agencies.list()).map((a) => [a.name, a.counts?.clients, a.counts?.archivedClients, a.counts?.websites])).toEqual([
            ['ADPOST', 4, 2, 8], ['GoldStarATM', 4, 1, 8], ['VCA', 4, 0, 8],
        ]);
        expect(await p.agencies.platformOverview()).toMatchObject({ agencies: 3, clients: 12, websites: 30, demoWebsites: 30 });
        expect((await p.workspace.listBrands()).map((b) => b.roleLabel)).toEqual(Array(15).fill('Super Admin'));
        expect((await p.agencies.clients('agy_vca')).map((c) => c.client.name)).toEqual(['CMS', 'HLDC', 'LIPSKY', 'LOOP19']);
    });

    it('creates agencies and clients anywhere; changes agency status (including suspension)', async () => {
        const db = sampleDb();
        const p = api(db, 'usr_platform');
        expect((await p.agencies.create({ name: 'North Agency' })).slug).toBe('north-agency');
        expect((await p.agencies.createClient('agy_vca', { name: 'New VCA client' })).agencySlug).toBe('vca');
        await p.agencies.update('agy_adpost', { status: 'suspended' });
        // Suspension locks out the agency's admins and client users immediately; Super Admins keep access.
        await expect(api(db, 'usr_adpost_admin').workspace.brandBySlug('pod', 'adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api(db, 'usr_pod_client').websites.list(POD)).rejects.toBeInstanceOf(AccessDeniedError);
        expect((await p.websites.list(POD)).length).toBe(2);
        await p.agencies.update('agy_adpost', { status: 'active' });
        expect((await api(db, 'usr_adpost_admin').websites.list(POD)).length).toBe(2);
    });

    it('manages users: suspend (not self), grant/revoke Super Admin (not the last), assign agency roles, invite admins; all audited', async () => {
        const db = sampleDb();
        const p = api(db, 'usr_platform');
        const all = await p.users.list({});
        expect(all.total).toBe(8);
        expect(all.users.find((u) => u.email === 'user@lipsky.example.test')!.memberships).toEqual([
            expect.objectContaining({ kind: 'client', brandName: 'LIPSKY', roleLabel: 'Client User', permissions: ['ai_chat', 'comment_tasks'] }),
        ]);
        await expect(p.users.setSuspended('usr_platform', true)).rejects.toBeInstanceOf(ValidationError);
        expect((await p.users.setSuspended('usr_pod_client', true)).status).toBe('suspended');
        await expect(api(db, 'usr_pod_client').websites.list(POD)).rejects.toBeInstanceOf(AccessDeniedError);
        await p.users.setSuspended('usr_pod_client', false);
        await expect(p.users.revokeSuperAdmin('usr_platform')).rejects.toBeInstanceOf(ValidationError);
        await p.users.grantSuperAdmin('usr_lugenix_admin');
        await p.users.revokeSuperAdmin('usr_lugenix_admin');
        await p.users.assignAgencyRole('agy_vca', 'usr_pod_seo', 'agency_manager');
        const inv = await p.users.inviteAgencyUser('agy_vca', { email: 'New.Admin@vca.example.test', role: 'agency_admin' });
        expect(inv.invitation.status).toBe('pending');
        expect(inv.devAcceptPath).toMatch(/^\/agency-invitations\//);
        expect((await p.users.audit()).map((e) => e.action)).toEqual(expect.arrayContaining([
            'user.suspended', 'user.reactivated', 'super_admin.granted', 'super_admin.revoked', 'agency_role.assigned', 'agency_invitation.created',
        ]));
        expect(await p.users.home()).toEqual({ path: '/platform', reason: 'super_admin' });
    });
});

describe('Admin', () => {
    it('sees only their agency and its users; lands on the agency dashboard', async () => {
        const db = sampleDb();
        const a = api(db, 'usr_vca_admin');
        expect((await a.agencies.list()).map((x) => x.slug)).toEqual(['vca']);
        await expect(a.agencies.clients('agy_adpost')).rejects.toBeInstanceOf(AccessDeniedError);
        const users = await a.users.list({ agencyId: 'agy_vca' });
        expect(users.users.map((u) => u.email).sort()).toEqual(['admin@vca.example.test', 'user@lipsky.example.test']);
        await expect(a.users.list({ agencyId: 'agy_adpost' })).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await a.users.home()).toEqual({ path: '/a/vca', reason: 'admin' });
    });

    it('cannot create Admins or Super Admins, suspend accounts or reach another agency', async () => {
        const a = api(sampleDb(), 'usr_vca_admin');
        await expect(a.users.grantSuperAdmin('usr_vca_admin')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(a.users.assignAgencyRole('agy_vca', 'usr_pod_seo', 'agency_admin')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(a.users.assignAgencyRole('agy_adpost', 'usr_vca_admin', 'agency_owner')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(a.users.inviteAgencyUser('agy_vca', { email: 'x@example.test', role: 'agency_admin' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(a.users.setSuspended('usr_lipsky_client', true)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(a.agencies.update('agy_vca', { status: 'suspended' })).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('invites Client Users with explicit permissions and adjusts them; acceptance needs the invited email', async () => {
        const db = sampleDb();
        const a = api(db, 'usr_vca_admin');
        const { invitation, devAcceptPath } = await a.invitations.send(CMS, { email: 'user@lipsky.example.test', role: 'client', permissions: ['download_reports'] });
        expect(invitation.role).toBe('client');
        const token = devAcceptPath!.split('/').pop()!;
        await expect(api(db, 'usr_pod_seo').invitations.accept(token)).rejects.toBeInstanceOf(AccessDeniedError);
        await api(db, 'usr_lipsky_client').invitations.accept(token);
        const m = db.all('brandMemberships').find((x) => x.brandId === CMS && x.userId === 'usr_lipsky_client')!;
        expect(m).toMatchObject({ role: 'client', clientId: null, permissions: ['download_reports'] });
        await a.users.setClientPermissions(CMS, m.id, ['download_reports', 'ai_chat']);
        expect(db.find('brandMemberships', m.id)!.permissions).toEqual(['download_reports', 'ai_chat']);
        await expect(a.invitations.send(CMS, { email: 'z@example.test', role: 'member', permissions: ['ai_chat'] })).rejects.toBeInstanceOf(ValidationError);
        await expect(api(db, 'usr_adpost_admin').users.setClientPermissions(CMS, m.id, [])).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('archive and restore clients; managers cannot administer', async () => {
        const db = sampleDb();
        const admin = api(db, 'usr_adpost_admin');
        expect((await admin.agencies.updateClient(DSP, { status: 'archived' })).archivedAt).not.toBeNull();
        expect((await admin.agencies.clients('agy_adpost', { status: 'archived' })).map((c) => c.client.name)).toEqual(['DYNAMIC SCREEN PRINTING', 'STUDIO PILATES', 'TRADE BAGS']);
        expect((await admin.agencies.updateClient(DSP, { status: 'active' })).archivedAt).toBeNull();
        await expect(api(db, 'usr_adpost_manager').agencies.updateClient(DSP, { name: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(admin.agencies.createClient('agy_adpost', { name: 'POD' })).rejects.toMatchObject({ fields: { slug: expect.stringContaining('already exists') } });
    });
});

describe('Client User portal', () => {
    it('lands on its single client; sees websites read-only; nothing of other clients', async () => {
        const db = sampleDb();
        const c = api(db, 'usr_lipsky_client');
        expect(await c.users.home()).toEqual({ path: '/a/vca/c/lipsky/dashboard', reason: 'client_user' });
        expect((await c.workspace.listBrands()).map((b) => [b.brand.name, b.roleLabel])).toEqual([['LIPSKY', 'Client']]);
        expect((await c.websites.list(LIPSKY)).map((w) => w.name)).toEqual(['LIPSKY — Production', 'LIPSKY — Staging']);
        await expect(c.websites.list(CMS)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(c.websites.create(LIPSKY, { name: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(c.members.list(LIPSKY)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(c.invitations.send(LIPSKY, { email: 'x@example.test', role: 'admin' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(c.knowledge.list(LIPSKY)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(c.users.list({})).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('AI chat only with client-facing agents in client-shared conversations; staff-internal conversations stay hidden', async () => {
        const db = sampleDb();
        const staff = api(db, 'usr_vca_admin');
        const agents = await staff.agents.list(LIPSKY);
        const seo = agents.find((a) => a.templateKey === 'seo_manager')!;
        const tech = agents.find((a) => a.templateKey === 'technical_seo')!;
        const internal = await staff.chat.createDirect(LIPSKY, seo.id, 'Internal pricing');
        const c = api(db, 'usr_lipsky_client');
        expect((await c.agents.list(LIPSKY)).map((a) => a.templateKey)).toEqual(['seo_manager']);
        await expect(c.chat.createDirect(LIPSKY, tech.id)).rejects.toBeInstanceOf(ValidationError);
        const mine = await c.chat.createDirect(LIPSKY, seo.id);
        expect(mine.visibility).toBe('client_shared');
        const res = await c.chat.send(LIPSKY, mine.id, { body: 'What should we fix first?' });
        expect(res.replies[0]!.mode).toBe('simulated');
        expect((await c.chat.list(LIPSKY)).map((x) => x.id)).toEqual([mine.id]);
        await expect(c.chat.get(LIPSKY, internal.id)).rejects.toThrow();
        await expect(c.chat.messages(LIPSKY, internal.id)).rejects.toThrow();
        await expect(c.chat.send(LIPSKY, internal.id, { body: 'peek' })).rejects.toThrow();
        // A read-only client user (no ai_chat) gets no chat at all.
        await expect(api(db, 'usr_pod_client').chat.list(POD)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(api(db, 'usr_pod_client').agents.list(POD)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('private conversations are visible to their creator only, not to admins or Super Admins', async () => {
        const db = sampleDb();
        const seoUser = api(db, 'usr_pod_seo');
        const agent = (await seoUser.agents.list(POD))[0]!;
        const priv = await seoUser.chat.createDirect(POD, agent.id, 'My notes', { visibility: 'user_private' });
        expect((await seoUser.chat.list(POD)).some((x) => x.id === priv.id)).toBe(true);
        for (const u of ['usr_adpost_admin', 'usr_platform']) {
            expect((await api(db, u).chat.list(POD)).some((x) => x.id === priv.id), u).toBe(false);
            await expect(api(db, u).chat.messages(POD, priv.id), u).rejects.toThrow();
        }
    });

    it('projects: only client-visible ones; comments need comment_tasks; reports need download_reports', async () => {
        const db = sampleDb();
        const staff = api(db, 'usr_vca_admin');
        const shared = await staff.work.createProject(LIPSKY, { name: 'Shared roadmap', clientVisible: true });
        const internal = await staff.work.createProject(LIPSKY, { name: 'Internal pricing' });
        const t1 = await staff.work.createTask(LIPSKY, { projectId: shared.id, title: 'Publish blog' });
        const t2 = await staff.work.createTask(LIPSKY, { projectId: internal.id, title: 'Margin review' });
        void t2;
        const c = api(db, 'usr_lipsky_client');
        expect((await c.work.projects(LIPSKY)).map((p) => p.name)).toEqual(['Shared roadmap']);
        expect((await c.work.tasks(LIPSKY)).map((t) => t.title)).toEqual(['Publish blog']);
        await c.work.addComment(LIPSKY, t1.id, 'Looks good');
        expect((await staff.work.comments(LIPSKY, t1.id)).map((x) => [x.authorName, x.body])).toEqual([['LIPSKY Client (sample)', 'Looks good']]);
        await expect(c.work.updateTask(LIPSKY, t1.id, { priority: 'urgent' })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(c.reports.recordExport(LIPSKY, 'pdf')).rejects.toBeInstanceOf(AccessDeniedError);
        // POD client: read-only, no comments.
        const podStaff = api(db, 'usr_adpost_admin');
        const pp = await podStaff.work.createProject(POD, { name: 'POD shared', clientVisible: true });
        const pt = await podStaff.work.createTask(POD, { projectId: pp.id, title: 'x' });
        await expect(api(db, 'usr_pod_client').work.addComment(POD, pt.id, 'hi')).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('profile', () => {
    it('updates the display name and password; roles are not editable from the profile', async () => {
        const { createLocalBackend } = await import('./backend');
        const backend = createLocalBackend();
        await backend.auth.signIn('user@lipsky.example.test', 'adpost-dev');
        expect((await backend.auth.updateProfile({ name: 'Lee Lipsky' })).user.name).toBe('Lee Lipsky');
        await expect(backend.auth.changePassword('wrong', 'new-password-1')).rejects.toBeInstanceOf(ValidationError);
        await backend.auth.changePassword('adpost-dev', 'new-password-1');
        await backend.auth.signOut();
        await expect(backend.auth.signIn('user@lipsky.example.test', 'adpost-dev')).rejects.toThrow();
        await backend.auth.signIn('user@lipsky.example.test', 'new-password-1');
        expect(backend.db.all('brandMemberships').find((m) => m.userId === 'usr_lipsky_client')!.role).toBe('client');
    });
});
