// @vitest-environment node
import { compareGa4, compareGsc, delta, summarizeGsc } from '../../../../../supabase/functions/_shared/integrations/compare.ts';
import type { Ga4Row } from '../../../../../supabase/functions/_shared/integrations/ga4.ts';
import type { GscRow } from '../../../../../supabase/functions/_shared/integrations/gsc.ts';

const CUR = { from: '2026-11-08', to: '2026-11-14' };
const PREV = { from: '2026-11-01', to: '2026-11-07' };

const ga4 = (date: string, sessions: number, engaged: number, keyEvents: number | null = 1): Ga4Row => ({
    date, dimension: 'total', dimensionValue: '', activeUsers: sessions, totalUsers: sessions, sessions, engagedSessions: engaged, engagementRate: engaged / sessions,
    screenPageViews: sessions * 2, eventCount: sessions * 5, keyEvents,
});
const gsc = (date: string, clicks: number, impressions: number, position: number, dataState: GscRow['dataState'] = 'final'): GscRow => ({
    date, dimension: 'total', dimensionValue: '', clicks, impressions, ctr: clicks / impressions, position, dataState,
});

describe('period comparisons', () => {
    it('delta: absolute and relative change; no percentage against zero or missing', () => {
        expect(delta(150, 100)).toEqual({ current: 150, previous: 100, change: 50, changePct: 0.5 });
        expect(delta(5, 0)).toMatchObject({ change: 5, changePct: null });
        expect(delta(5, null)).toEqual({ current: 5, previous: null, change: null, changePct: null });
    });

    it('GA4: engagement rate is recomputed from totals, not averaged across days', () => {
        const rows = [ga4('2026-11-08', 100, 90), ga4('2026-11-09', 900, 450), ga4('2026-11-02', 400, 200)];
        const r = compareGa4(rows, CUR, PREV);
        expect(r.current).toMatchObject({ days: 2, sessions: 1000, engagedSessions: 540 });
        expect(r.deltas.engagementRate.current).toBeCloseTo(0.54);
        expect(r.deltas.engagementRate.previous).toBeCloseTo(0.5);
        expect(r.deltas.sessions).toMatchObject({ current: 1000, previous: 400, change: 600, changePct: 1.5 });
    });

    it('GA4: a missing previous period stays null instead of looking like zero traffic', () => {
        const r = compareGa4([ga4('2026-11-08', 10, 5)], CUR, PREV);
        expect(r.previous).toBeNull();
        expect(r.deltas.sessions).toEqual({ current: 10, previous: null, change: null, changePct: null });
    });

    it('GSC: CTR from totals, impression-weighted position, fresh days flagged', () => {
        const s = summarizeGsc([gsc('2026-11-08', 10, 1000, 20), gsc('2026-11-09', 90, 1000, 4, 'fresh')])!;
        expect(s).toMatchObject({ clicks: 100, impressions: 2000, ctr: 0.05, position: 12, includesFreshData: true });
        const r = compareGsc([gsc('2026-11-08', 10, 1000, 20), gsc('2026-11-01', 5, 500, 25)], CUR, PREV);
        expect(r.deltas.clicks).toMatchObject({ change: 5, changePct: 1 });
        expect(r.deltas.position.change).toBe(-5); // improved
    });

    it('refuses rows from more than one website (no mixing of ADPOST and POD)', () => {
        const adpost = { ...gsc('2026-11-08', 1, 10, 3), websiteId: 'web-adpost' };
        const pod = { ...gsc('2026-11-08', 1, 10, 3), websiteId: 'web-pod' };
        expect(() => compareGsc([adpost, pod], CUR, PREV)).toThrow('per website');
        expect(() => compareGa4([{ ...ga4('2026-11-08', 1, 1), websiteId: 'a' }, { ...ga4('2026-11-08', 1, 1), websiteId: 'b' }], CUR, PREV)).toThrow('per website');
    });
});
