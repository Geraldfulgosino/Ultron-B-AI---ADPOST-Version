/**
 * Entitlement checks. The local stand-in for plan enforcement that will live in
 * Edge Functions / Postgres functions (never in the browser alone).
 */
import type { ID } from '@/domain/types';
import { PLANS, type AgencyUsage, type Feature, type Plan } from '@/domain/plans';
import { PlanLimitError } from '../errors';
import type { LocalDatabase } from './db';

export function planForAgency(db: LocalDatabase, agencyId: ID): Plan {
    return PLANS[db.find('agencies', agencyId)?.planKey ?? 'internal'];
}

export function planForBrand(db: LocalDatabase, brandId: ID): Plan {
    const brand = db.find('brands', brandId);
    return brand ? planForAgency(db, brand.agencyId) : PLANS.internal;
}

export function agencyUsage(db: LocalDatabase, agencyId: ID): AgencyUsage {
    const now = db.now();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const brandIds = new Set(db.all('brands').filter((b) => b.agencyId === agencyId).map((b) => b.id));
    const members = [...brandIds].map((id) => db.all('brandMemberships').filter((m) => m.brandId === id).length);
    return {
        planKey: db.find('agencies', agencyId)?.planKey ?? 'internal',
        period: { from: from.slice(0, 10), to: now.toISOString().slice(0, 10) },
        brands: brandIds.size,
        maxMembersInABrand: Math.max(0, ...members),
        agentRunsThisMonth: db.all('executions').filter((e) => brandIds.has(e.brandId) && e.startedAt >= from && e.status !== 'limited').length,
        knowledgeBytes: db.all('knowledgeDocuments').filter((d) => brandIds.has(d.brandId)).reduce((s, d) => s + d.sizeBytes, 0),
    };
}

export function assertFeature(db: LocalDatabase, brandId: ID, feature: Feature): void {
    const plan = planForBrand(db, brandId);
    if (!plan.features.includes(feature)) throw new PlanLimitError(`${plan.name} plan does not include this feature.`);
}

export function assertCanAddBrand(db: LocalDatabase, agencyId: ID): void {
    const plan = planForAgency(db, agencyId);
    if (plan.maxBrands !== null && agencyUsage(db, agencyId).brands >= plan.maxBrands) throw new PlanLimitError(`${plan.name} plan allows ${plan.maxBrands} brand(s).`);
}

export function assertCanAddMember(db: LocalDatabase, brandId: ID): void {
    const plan = planForBrand(db, brandId);
    const count = db.all('brandMemberships').filter((m) => m.brandId === brandId).length;
    if (plan.maxMembersPerBrand !== null && count >= plan.maxMembersPerBrand) throw new PlanLimitError(`${plan.name} plan allows ${plan.maxMembersPerBrand} members per brand.`);
}

/** Returns an error message when the agency's monthly run quota is used up. */
export function runQuotaExceeded(db: LocalDatabase, brandId: ID): string | null {
    const brand = db.find('brands', brandId);
    if (!brand) return null;
    const plan = planForAgency(db, brand.agencyId);
    if (plan.maxAgentRunsPerMonth === null) return null;
    return agencyUsage(db, brand.agencyId).agentRunsThisMonth >= plan.maxAgentRunsPerMonth ? `Monthly agent run quota reached for the ${plan.name} plan (${plan.maxAgentRunsPerMonth}).` : null;
}

export function assertKnowledgeRoom(db: LocalDatabase, brandId: ID, addBytes: number): void {
    const brand = db.find('brands', brandId);
    if (!brand) return;
    const plan = planForAgency(db, brand.agencyId);
    if (plan.maxKnowledgeBytes !== null && agencyUsage(db, brand.agencyId).knowledgeBytes + addBytes > plan.maxKnowledgeBytes) throw new PlanLimitError(`Knowledge storage limit reached for the ${plan.name} plan.`);
}
