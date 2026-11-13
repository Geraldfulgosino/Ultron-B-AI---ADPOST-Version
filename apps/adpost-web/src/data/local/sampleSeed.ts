/**
 * Development sample hierarchy for the local app (mirrors supabase/seeds/dev/sample_hierarchy.sql):
 * exactly 3 agencies and 10 clients, each with its six agents and two DEMO websites (production +
 * staging) on reserved RFC 2606 .example domains. NO analytics, insights, knowledge, integrations or
 * credentials: these are sample records, not verified client data. Demo websites are never crawled,
 * verified, monitored or connected (isDemo; the SSRF guard also refuses .example hosts).
 *
 * Sign-in accounts are synthetic local-only identities (example.test addresses) so the app can be
 * explored per role. They are not real employees and nothing is sent to them.
 */
import type * as T from '@/domain/types';
import { EMPTY_SNAPSHOT, type Credentials, type DbSnapshot } from './db';
import { agencyRow, brandRow, DEV_PASSWORD } from './fixtures';
import { seedAgents } from './agents';
import { seedAiProviders } from './ai';

const AT = '2026-11-05T09:00:00.000Z';

export const SAMPLE_AGENCIES = [
    { id: 'agy_adpost', name: 'ADPOST', slug: 'adpost' },
    { id: 'agy_vca', name: 'VCA', slug: 'vca' },
    // Renamed from 'Lugenix Digital Services' (owner-approved 2026-11-13); id and slug unchanged.
    { id: 'agy_lugenix', name: 'GoldStarATM', slug: 'lugenix-digital-services' },
] as const;

export const SAMPLE_CLIENTS: ReadonlyArray<{ agency: (typeof SAMPLE_AGENCIES)[number]['slug']; name: string; slug: string }> = [
    { agency: 'adpost', name: 'POD', slug: 'pod' },
    { agency: 'adpost', name: 'DYNAMIC SCREEN PRINTING', slug: 'dsp' },
    { agency: 'adpost', name: 'FMF', slug: 'fmf' },
    { agency: 'adpost', name: 'TRADE BAGS', slug: 'trade-bags' },
    { agency: 'adpost', name: 'STUDIO PILATES', slug: 'studio-pilates' },
    { agency: 'vca', name: 'LIPSKY', slug: 'lipsky' },
    { agency: 'vca', name: 'HLDC', slug: 'hamptons' },
    { agency: 'vca', name: 'CMS', slug: 'cms' },
    { agency: 'vca', name: 'LOOP19', slug: 'loop19' },
    { agency: 'adpost', name: 'CAR MAGNETS', slug: 'car-magnets' },
    { agency: 'lugenix-digital-services', name: 'GoldStar ATM', slug: 'goldstar-atm' },
    { agency: 'lugenix-digital-services', name: 'ATM NEBRASKA', slug: 'atm-nebraska' },
    { agency: 'lugenix-digital-services', name: 'ATM FLORIDA', slug: 'atm-florida' },
    { agency: 'lugenix-digital-services', name: 'ATM OHIO', slug: 'atm-ohio' },
    { agency: 'lugenix-digital-services', name: 'ATM HAWAII', slug: 'atm-hawaii' },
];

/** Archived by the 2026-11-13 reconciliation (preserved and restorable, not deleted). */
export const ARCHIVED_SAMPLE_CLIENTS = ['trade-bags', 'studio-pilates', 'goldstar-atm'];

/** Deterministic ids so re-seeding is idempotent and links stay stable. */
export const sampleClientId = (agencySlug: string, slug: string) => `brd_${agencySlug.split('-')[0]}_${slug.replace(/-/g, '_')}`;

export const SAMPLE_USERS: ReadonlyArray<{ id: string; name: string; email: string; hint: string }> = [
    { id: 'usr_platform', name: 'Super Admin (sample)', email: 'platform@ultron.example.test', hint: 'Super Admin: every agency, client and user' },
    { id: 'usr_adpost_admin', name: 'ADPOST Admin (sample)', email: 'admin@adpost.example.test', hint: 'ADPOST agency owner: all ADPOST clients' },
    { id: 'usr_adpost_manager', name: 'ADPOST Manager (sample)', email: 'manager@adpost.example.test', hint: 'ADPOST agency manager: edit, not administer' },
    { id: 'usr_vca_admin', name: 'VCA Admin (sample)', email: 'admin@vca.example.test', hint: 'VCA agency admin: VCA clients only' },
    { id: 'usr_lugenix_admin', name: 'GoldStarATM Admin (sample)', email: 'admin@lugenix.example.test', hint: 'GoldStarATM agency owner' },
    { id: 'usr_pod_seo', name: 'POD SEO (sample)', email: 'seo@pod.example.test', hint: 'POD member (SEO specialist): POD only' },
    { id: 'usr_lipsky_client', name: 'LIPSKY Client (sample)', email: 'user@lipsky.example.test', hint: 'Client User: LIPSKY portal, AI chat + task comments' },
    { id: 'usr_pod_client', name: 'POD Client (sample)', email: 'client@pod.example.test', hint: 'Client User: POD portal, read-only' },
];

/** Idempotent: adds only what is missing from `s` (used for a fresh snapshot today). */
export function applySampleSeed(s: DbSnapshot): DbSnapshot {
    for (const a of SAMPLE_AGENCIES) if (!s.agencies.some((x) => x.slug === a.slug)) s.agencies.push(agencyRow(a.id, a.name, a.slug, AT));
    for (const c of SAMPLE_CLIENTS) {
        const agency = s.agencies.find((a) => a.slug === c.agency)!;
        if (s.brands.some((b) => b.agencyId === agency.id && b.slug === c.slug)) continue;
        const id = sampleClientId(c.agency, c.slug);
        s.brands.push(brandRow({ id, agencyId: agency.id, agencySlug: agency.slug, name: c.name, slug: c.slug, description: 'Sample development client.' }, AT));
        seedAgents(s, id, c.name, 'usr_platform', AT);
    }
    // Two demo websites per client, keyed by (client, domain). User-created websites are never touched,
    // and the demo production site is primary only when the client has no primary website yet.
    for (const c of SAMPLE_CLIENTS) {
        const brandId = sampleClientId(c.agency, c.slug);
        if (!s.brands.some((b) => b.id === brandId)) continue;
        const client = s.brands.find((b) => b.id === brandId)!;
        for (const env of ['production', 'staging'] as const) {
            const domain = env === 'production' ? `${c.slug}.example` : `staging.${c.slug}.example`;
            if (s.websites.some((w) => w.brandId === brandId && w.domain === domain)) continue;
            const hasPrimary = s.websites.some((w) => w.brandId === brandId && w.isPrimary && w.status !== 'archived');
            s.websites.push({
                id: `web_demo_${brandId.slice(4)}_${env === 'production' ? 'prod' : 'stg'}`, brandId, clientId: null,
                name: `${client.name} — ${env === 'production' ? 'Production' : 'Staging'}`, domain, websiteUrl: `https://${domain}`, environment: env,
                platform: 'unknown', status: 'active', isPrimary: env === 'production' && !hasPrimary,
                description: 'Demo record (reserved .example domain). Not a verified live website.', primaryConversion: null,
                ga4PropertyId: null, gscSiteUrl: null, createdAt: AT, archivedAt: null, isDemo: true,
            });
        }
    }
    for (const u of SAMPLE_USERS) if (!s.users.some((x) => x.id === u.id)) s.users.push({ id: u.id, name: u.name, email: u.email });
    const addAgencyRole = (id: string, agencyId: string, userId: string, role: T.AgencyRole, jobFunction: T.JobFunction | null = null) => {
        if (!s.agencyMemberships.some((m) => m.id === id)) s.agencyMemberships.push({ id, agencyId, userId, role, jobFunction });
    };
    addAgencyRole('agm_adpost_admin', 'agy_adpost', 'usr_adpost_admin', 'agency_owner');
    addAgencyRole('agm_adpost_manager', 'agy_adpost', 'usr_adpost_manager', 'agency_manager', 'client_manager');
    addAgencyRole('agm_vca_admin', 'agy_vca', 'usr_vca_admin', 'agency_admin');
    addAgencyRole('agm_lugenix_admin', 'agy_lugenix', 'usr_lugenix_admin', 'agency_owner');
    if (!s.brandMemberships.some((m) => m.id === 'bm_pod_seo')) {
        s.brandMemberships.push({ id: 'bm_pod_seo', brandId: sampleClientId('adpost', 'pod'), userId: 'usr_pod_seo', role: 'member', clientId: null, department: null, jobFunction: 'seo_specialist', joinedAt: AT });
    }
    if (!s.platformAdmins.some((p) => p.userId === 'usr_platform')) s.platformAdmins.push({ id: 'pla_platform', userId: 'usr_platform', createdAt: AT });
    // One offline simulator connection per agency; no live provider connection is pre-created.
    for (const a of SAMPLE_AGENCIES) {
        const suffix = `_${a.slug.split('-')[0]}`;
        if (!s.aiConnections.some((c) => c.id === `aic_simulator${suffix}`)) {
            seedAiProviders(s, a.id, 'usr_platform', AT, suffix);
            s.aiConnections = s.aiConnections.filter((c) => c.id !== `aic_anthropic${suffix}`);
        }
    }
    // Client Users of the sample (whole-client scope; read-only unless permissions are granted).
    const addClientUser = (id: string, brandId: string, userId: string, permissions: T.ClientPermission[]) => {
        if (!s.brandMemberships.some((m) => m.id === id) && s.brands.some((b) => b.id === brandId)) {
            s.brandMemberships.push({ id, brandId, userId, role: 'client', clientId: null, department: null, permissions, joinedAt: AT });
        }
    };
    addClientUser('bm_lipsky_client', sampleClientId('vca', 'lipsky'), 'usr_lipsky_client', ['ai_chat', 'comment_tasks']);
    addClientUser('bm_pod_client', sampleClientId('adpost', 'pod'), 'usr_pod_client', []);
    reconcile(s);
    return s;
}

/**
 * Owner-approved reconciliation (2026-11-13), applied ONCE per database so a later restore or
 * rename by a user is never undone. Renames and archives only: nothing is deleted.
 */
function reconcile(s: DbSnapshot): void {
    const STEP = '2026-11-13-reconcile';
    if (s.seedSteps.some((x) => x.id === STEP)) return;
    const agency = s.agencies.find((a) => a.slug === 'lugenix-digital-services');
    if (agency?.name === 'Lugenix Digital Services') agency.name = 'GoldStarATM';
    for (const b of s.brands) if (b.agencyId === agency?.id) b.agencySlug = agency.slug;
    const rename = (agencySlug: string, slug: string, from: string, to: string) => {
        const b = s.brands.find((x) => x.agencySlug === agencySlug && x.slug === slug && x.name === from);
        if (!b) return;
        b.name = to;
        for (const w of s.websites) if (w.brandId === b.id && w.isDemo && w.name.startsWith(`${from} — `)) w.name = `${to} — ${w.name.slice(from.length + 3)}`;
        for (const a of s.agentInstances) if (a.brandId === b.id) for (const v of s.instructionVersions) if (v.agentInstanceId === a.id) v.instructions = v.instructions.split(from).join(to);
    };
    rename('adpost', 'dsp', 'DSP', 'DYNAMIC SCREEN PRINTING');
    rename('vca', 'hamptons', 'HAMPTONS', 'HLDC');
    for (const b of s.brands) {
        if (ARCHIVED_SAMPLE_CLIENTS.includes(b.slug) && SAMPLE_CLIENTS.some((c) => c.slug === b.slug && sampleClientId(c.agency, c.slug) === b.id) && b.status !== 'archived') {
            b.status = 'archived';
            b.archivedAt = AT;
        }
    }
    // LIPSKY's SEO Manager is client-facing in the sample (Client Users with ai_chat may use it).
    const lipskySeo = s.agentInstances.find((a) => a.brandId === sampleClientId('vca', 'lipsky') && a.templateKey === 'seo_manager');
    if (lipskySeo) lipskySeo.clientFacing = true;
    s.seedSteps.push({ id: STEP, appliedAt: AT });
}

export function buildSampleSeed(): { snapshot: DbSnapshot; credentials: Credentials } {
    const snapshot = applySampleSeed(EMPTY_SNAPSHOT());
    const credentials: Credentials = {};
    for (const u of SAMPLE_USERS) credentials[u.email] = `plain:${DEV_PASSWORD}`;
    return { snapshot, credentials };
}
