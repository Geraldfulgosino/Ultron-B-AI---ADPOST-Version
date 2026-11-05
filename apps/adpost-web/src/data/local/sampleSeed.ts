/**
 * Development sample hierarchy for the local app (mirrors supabase/seeds/dev/sample_hierarchy.sql):
 * exactly 3 agencies and 10 clients, each with its six agents. NO websites, analytics, insights,
 * knowledge, integrations or credentials: these are sample records, not verified client data.
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
    { id: 'agy_lugenix', name: 'Lugenix Digital Services', slug: 'lugenix-digital-services' },
] as const;

export const SAMPLE_CLIENTS: ReadonlyArray<{ agency: (typeof SAMPLE_AGENCIES)[number]['slug']; name: string; slug: string }> = [
    { agency: 'adpost', name: 'POD', slug: 'pod' },
    { agency: 'adpost', name: 'DSP', slug: 'dsp' },
    { agency: 'adpost', name: 'FMF', slug: 'fmf' },
    { agency: 'adpost', name: 'TRADE BAGS', slug: 'trade-bags' },
    { agency: 'adpost', name: 'STUDIO PILATES', slug: 'studio-pilates' },
    { agency: 'vca', name: 'LIPSKY', slug: 'lipsky' },
    { agency: 'vca', name: 'HAMPTONS', slug: 'hamptons' },
    { agency: 'vca', name: 'CMS', slug: 'cms' },
    { agency: 'vca', name: 'LOOP19', slug: 'loop19' },
    { agency: 'lugenix-digital-services', name: 'GoldStar ATM', slug: 'goldstar-atm' },
];

/** Deterministic ids so re-seeding is idempotent and links stay stable. */
export const sampleClientId = (agencySlug: string, slug: string) => `brd_${agencySlug.split('-')[0]}_${slug.replace(/-/g, '_')}`;

export const SAMPLE_USERS: ReadonlyArray<{ id: string; name: string; email: string; hint: string }> = [
    { id: 'usr_platform', name: 'Platform Admin (sample)', email: 'platform@ultron.example.test', hint: 'Platform admin: agencies directory, no client data' },
    { id: 'usr_adpost_admin', name: 'ADPOST Admin (sample)', email: 'admin@adpost.example.test', hint: 'ADPOST agency owner: all ADPOST clients' },
    { id: 'usr_adpost_manager', name: 'ADPOST Manager (sample)', email: 'manager@adpost.example.test', hint: 'ADPOST agency manager: edit, not administer' },
    { id: 'usr_vca_admin', name: 'VCA Admin (sample)', email: 'admin@vca.example.test', hint: 'VCA agency admin: VCA clients only' },
    { id: 'usr_lugenix_admin', name: 'Lugenix Admin (sample)', email: 'admin@lugenix.example.test', hint: 'Lugenix agency owner' },
    { id: 'usr_pod_seo', name: 'POD SEO (sample)', email: 'seo@pod.example.test', hint: 'POD member (SEO specialist): POD only' },
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
    return s;
}

export function buildSampleSeed(): { snapshot: DbSnapshot; credentials: Credentials } {
    const snapshot = applySampleSeed(EMPTY_SNAPSHOT());
    const credentials: Credentials = {};
    for (const u of SAMPLE_USERS) credentials[u.email] = `plain:${DEV_PASSWORD}`;
    return { snapshot, credentials };
}
