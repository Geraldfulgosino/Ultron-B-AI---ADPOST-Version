/**
 * Synthetic development fixtures. All people, emails and metrics are invented.
 * Deterministic: same output on every run (seeded PRNG, fixed dates).
 */
import type * as T from '@/domain/types';
import { EMPTY_SNAPSHOT, type Credentials, type DbSnapshot } from './db';
import { generateInsightCandidates } from '@/domain/analytics';
import { hashString, mulberry32 } from '@/lib/random';
import { seedAgents } from './agents';

/** Local dev password for every fixture user. Not a secret; the local adapter only. */
export const DEV_PASSWORD = 'adpost-dev';

/** Last day of synthetic analytics. Reports default to the 28 days ending here. */
export const FIXTURE_END_DATE = '2026-10-24';
export const FIXTURE_DAYS = 90;

const CREATED = '2026-07-01T09:00:00.000Z';

export const FIXTURE_IDS = {
    agency: 'agy_adpost',
    brands: { adpost: 'brd_adpost', pod: 'brd_pod', dmd: 'brd_dmd', fmf: 'brd_fmf', urban: 'brd_urban' },
    users: {
        alex: 'usr_alex', morgan: 'usr_morgan', priya: 'usr_priya', dana: 'usr_dana',
        frank: 'usr_frank', uma: 'usr_uma', vic: 'usr_vic', casey: 'usr_casey',
    },
} as const;

const B = FIXTURE_IDS.brands;
const U = FIXTURE_IDS.users;

const BRANDS: Array<Pick<T.Brand, 'id' | 'name' | 'slug' | 'description' | 'color'>> = [
    { id: B.adpost, name: 'ADPOST', slug: 'adpost', description: 'ADPOST agency workspace.', color: '#4f46e5' },
    { id: B.pod, name: 'POD', slug: 'pod', description: 'POD brand workspace.', color: '#0ea5e9' },
    { id: B.dmd, name: 'DMD', slug: 'dmd', description: 'DMD brand workspace.', color: '#10b981' },
    { id: B.fmf, name: 'FMF', slug: 'fmf', description: 'FMF brand workspace.', color: '#f59e0b' },
    { id: B.urban, name: 'Urban Rest', slug: 'urban-rest', description: 'Urban Rest brand workspace.', color: '#e11d48' },
];

const USERS: T.User[] = [
    { id: U.alex, name: 'Alex Rivera', email: 'alex@adpost.example.test' },
    { id: U.morgan, name: 'Morgan Lee', email: 'morgan@adpost.example.test' },
    { id: U.priya, name: 'Priya Shah', email: 'priya@pod.example.test' },
    { id: U.dana, name: 'Dana Cruz', email: 'dana@dmd.example.test' },
    { id: U.frank, name: 'Frank Osei', email: 'frank@fmf.example.test' },
    { id: U.uma, name: 'Uma Patel', email: 'uma@urbanrest.example.test' },
    { id: U.vic, name: 'Vic Moreno', email: 'vic@pod.example.test' },
    { id: U.casey, name: 'Casey Jordan', email: 'casey@client.example.test' },
];

/** Two clients per brand, one website each. */
const CLIENTS: Record<string, Array<{ name: string; domain: string; platform: T.WebsitePlatform; conversion: string }>> = {
    [B.adpost]: [
        { name: 'ADPOST Corporate', domain: 'adpost.example.test', platform: 'wordpress', conversion: 'Contact form' },
        { name: 'ADPOST Careers', domain: 'careers.adpost.example.test', platform: 'custom', conversion: 'Job application' },
    ],
    [B.pod]: [
        { name: 'POD Store', domain: 'shop.pod.example.test', platform: 'shopify', conversion: 'Purchase' },
        { name: 'POD Blog', domain: 'blog.pod.example.test', platform: 'wordpress', conversion: 'Newsletter signup' },
    ],
    [B.dmd]: [
        { name: 'DMD Services', domain: 'dmd.example.test', platform: 'wordpress', conversion: 'Quote request' },
        { name: 'DMD Academy', domain: 'academy.dmd.example.test', platform: 'custom', conversion: 'Course enrolment' },
    ],
    [B.fmf]: [
        { name: 'FMF Main', domain: 'fmf.example.test', platform: 'custom', conversion: 'Booking' },
        { name: 'FMF Events', domain: 'events.fmf.example.test', platform: 'other', conversion: 'Ticket sale' },
    ],
    [B.urban]: [
        { name: 'Urban Rest Hotels', domain: 'urbanrest.example.test', platform: 'wordpress', conversion: 'Room booking' },
        { name: 'Urban Rest Dining', domain: 'dining.urbanrest.example.test', platform: 'shopify', conversion: 'Table reservation' },
    ],
};

const QUERY_STEMS = ['near me', 'reviews', 'pricing', 'best', 'how to choose', 'vs competitors', 'deals', 'opening hours', 'contact', 'guide'];
const PAGE_PATHS = ['/', '/services', '/pricing', '/about', '/blog/getting-started', '/contact', '/faq', '/blog/top-10-tips'];

function isoDay(base: string, offsetDays: number): string {
    const d = new Date(base + 'T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

export function buildFixtures(): { snapshot: DbSnapshot; credentials: Credentials } {
    const s = EMPTY_SNAPSHOT();

    s.agencies.push({ id: FIXTURE_IDS.agency, name: 'ADPOST', slug: 'adpost' });
    for (const b of BRANDS) s.brands.push({ ...b, agencyId: FIXTURE_IDS.agency, status: 'active', timezone: 'UTC', currency: 'USD', createdAt: CREATED });
    s.users.push(...USERS);

    s.agencyMemberships.push({ id: 'agm_alex', agencyId: FIXTURE_IDS.agency, userId: U.alex, role: 'agency_owner' });

    const member = (id: string, brandId: string, userId: string, role: T.BrandRole, department: string | null = null, clientId: string | null = null) =>
        s.brandMemberships.push({ id, brandId, userId, role, clientId, department, joinedAt: CREATED });
    member('bm_morgan_adpost', B.adpost, U.morgan, 'admin', 'Operations');
    member('bm_priya_pod', B.pod, U.priya, 'owner', 'Leadership');
    member('bm_dana_dmd', B.dmd, U.dana, 'manager', 'Marketing');
    member('bm_frank_fmf', B.fmf, U.frank, 'member', 'Content');
    member('bm_uma_urban', B.urban, U.uma, 'owner', 'Leadership');
    member('bm_vic_pod', B.pod, U.vic, 'viewer', 'Finance');
    member('bm_morgan_pod', B.pod, U.morgan, 'manager', 'Operations');

    for (const [brandId, list] of Object.entries(CLIENTS)) {
        list.forEach((c, i) => {
            const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const clientId = `cli_${brandId.slice(4)}_${i + 1}`;
            const websiteId = `web_${brandId.slice(4)}_${i + 1}`;
            s.clients.push({ id: clientId, brandId, name: c.name, slug, status: 'active', timezone: 'UTC', currency: 'USD', businessGoals: `Grow qualified ${c.conversion.toLowerCase()}s from organic search.`, createdAt: CREATED });
            s.websites.push({ id: websiteId, brandId, clientId, name: c.name, domain: c.domain, platform: c.platform, status: 'active', primaryConversion: c.conversion, ga4PropertyId: `properties/${100000 + s.websites.length}`, gscSiteUrl: `sc-domain:${c.domain}`, createdAt: CREATED });
            addAnalytics(s, brandId, clientId, websiteId, c.domain);
        });
    }

    // Client portal user: sees only POD Store.
    member('bm_casey_pod', B.pod, U.casey, 'client', null, 'cli_pod_1');

    for (const b of BRANDS) seedAgents(s, b.id, b.name, U.alex, CREATED);

    // Seed insights by running the real rule set over the synthetic data.
    const generatedAt = `${FIXTURE_END_DATE}T08:00:00.000Z`;
    for (const brand of BRANDS) {
        const own = <R extends { brandId: string }>(rows: R[]) => rows.filter((r) => r.brandId === brand.id);
        generateInsightCandidates({
            websites: own(s.websites), metrics: own(s.dailyMetrics), queries: own(s.searchQueries), pages: own(s.landingPages),
            integrations: own(s.integrations), now: new Date(generatedAt),
        }).forEach((c, i) =>
            s.seoInsights.push({
                id: `ins_${brand.id.slice(4)}_${i + 1}`, brandId: brand.id, clientId: c.clientId, websiteId: c.websiteId, type: c.type, severity: c.severity,
                status: 'pending', subject: c.subject, title: c.title, summary: c.summary, recommendation: c.recommendation, evidence: c.evidence,
                source: 'rules', reviewedBy: null, reviewedAt: null, reviewNotes: null, createdAt: generatedAt,
            }),
        );
    }

    const credentials: Credentials = {};
    for (const u of USERS) credentials[u.email.toLowerCase()] = DEV_PASSWORD;
    return { snapshot: s, credentials };
}

function addAnalytics(s: DbSnapshot, brandId: string, clientId: string, websiteId: string, domain: string): void {
    const rand = mulberry32(hashString(websiteId));
    const baseSessions = 200 + Math.floor(rand() * 1800);
    const startDate = isoDay(FIXTURE_END_DATE, -(FIXTURE_DAYS - 1));
    const trend = rand() > 0.3 ? 1 : -1; // most sites grow; some decline (drives insights)

    for (let d = 0; d < FIXTURE_DAYS; d++) {
        const weekday = new Date(isoDay(startDate, d) + 'T00:00:00Z').getUTCDay();
        const weekly = weekday === 0 || weekday === 6 ? 0.72 : 1.08;
        const growth = 1 + trend * (d / FIXTURE_DAYS) * 0.25;
        const sessions = Math.round(baseSessions * weekly * growth * (0.85 + rand() * 0.3));
        const impressions = Math.round(sessions * (9 + rand() * 6));
        const clicks = Math.round(impressions * (0.025 + rand() * 0.035));
        s.dailyMetrics.push({
            id: `dm_${websiteId}_${d}`,
            brandId, clientId, websiteId,
            date: isoDay(startDate, d),
            sessions,
            users: Math.round(sessions * (0.7 + rand() * 0.15)),
            conversions: Math.round(sessions * (0.012 + rand() * 0.02)),
            clicks,
            impressions,
            position: Math.round((8 + rand() * 14 - trend * (d / FIXTURE_DAYS) * 3) * 10) / 10,
        });
    }

    const name = domain.split('.')[0]!.replace(/-/g, ' ');
    const queryBase = QUERY_STEMS.map((_, i) => ({ impressions: 60 + rand() * 700, ctr: i === 2 ? 0.006 + rand() * 0.006 : 0.02 + rand() * 0.08, position: 2 + rand() * 18 }));
    const pageBase = PAGE_PATHS.map((_, i) => ({ share: (8 - i) * (0.6 + rand() * 0.8), conv: i === 2 ? 0.002 : 0.01 + rand() * 0.03, bounce: 0.3 + rand() * 0.45 }));

    for (let w = 0; w * 7 < FIXTURE_DAYS; w++) {
        const date = isoDay(startDate, w * 7);
        const growth = 1 + trend * (w / 13) * 0.25;
        QUERY_STEMS.forEach((stem, i) => {
            const q = queryBase[i]!; // "pricing" (i=2) is a low-CTR opportunity
            const impressions = Math.round(q.impressions * growth * (0.85 + rand() * 0.3));
            s.searchQueries.push({
                id: `sq_${websiteId}_${w}_${i}`,
                brandId, clientId, websiteId, date,
                query: `${name} ${stem}`,
                impressions,
                clicks: Math.round(impressions * q.ctr),
                position: Math.round((q.position + (rand() - 0.5)) * 10) / 10,
            });
        });
        PAGE_PATHS.forEach((path, i) => {
            const p = pageBase[i]!;
            const sessions = Math.round((baseSessions / 6) * p.share * growth * (0.85 + rand() * 0.3));
            s.landingPages.push({
                id: `lp_${websiteId}_${w}_${i}`,
                brandId, clientId, websiteId, date,
                path,
                sessions,
                conversions: Math.round(sessions * p.conv),
                bounceRate: Math.round(p.bounce * 1000) / 1000,
            });
        });
    }

    s.integrations.push(
        {
            id: `int_${websiteId}_ga4`, brandId, clientId, websiteId,
            provider: 'google_analytics', status: 'connected',
            externalAccountName: `${name} (synthetic)`, externalPropertyName: `GA4 · ${domain}`,
            lastSyncedAt: `${FIXTURE_END_DATE}T06:00:00.000Z`, lastErrorMessage: null, createdAt: CREATED,
        },
        {
            id: `int_${websiteId}_gsc`, brandId, clientId, websiteId,
            provider: 'google_search_console', status: trend < 0 ? 'error' : 'connected',
            externalAccountName: `${name} (synthetic)`, externalPropertyName: `sc-domain:${domain}`,
            lastSyncedAt: trend < 0 ? `${isoDay(FIXTURE_END_DATE, -6)}T06:00:00.000Z` : `${FIXTURE_END_DATE}T06:00:00.000Z`,
            lastErrorMessage: trend < 0 ? 'Synthetic: token expired. Reconnect to resume sync.' : null,
            createdAt: CREATED,
        },
    );
}
