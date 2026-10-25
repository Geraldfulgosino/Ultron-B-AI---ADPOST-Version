import type { ID } from '@/domain/types';
import { can, clientRestriction, type AccessFacts, type Capability } from '../access';
import { AccessDeniedError, NotFoundError } from '../errors';
import { newId } from '@/lib/utils';
import type { LocalDatabase, TableName, Tables } from './db';

/** Rows that belong to a brand. */
type BrandRow = { id: ID; brandId: ID };

/**
 * Per-user authorization context for the local adapter: the local stand-in for
 * `auth.uid()` + RLS. Every repository read/write passes through here.
 */
export class Scope {
    constructor(
        readonly db: LocalDatabase,
        readonly userId: ID,
    ) {}

    /** Unknown brand and no-access both raise AccessDenied, so brand existence never leaks. */
    facts(brandId: ID): AccessFacts {
        const brand = this.db.find('brands', brandId);
        if (!brand) throw new AccessDeniedError();
        const membership = this.db.all('brandMemberships').find((m) => m.brandId === brandId && m.userId === this.userId) ?? null;
        const agencyMembership =
            this.db.all('agencyMemberships').find((m) => m.agencyId === brand.agencyId && m.userId === this.userId) ?? null;
        const facts = { brand, membership, agencyMembership };
        if (!can(facts, 'read')) throw new AccessDeniedError();
        return facts;
    }

    require(brandId: ID, capability: Capability): AccessFacts {
        const f = this.facts(brandId);
        if (!can(f, capability)) throw new AccessDeniedError();
        return f;
    }

    /** Brand rows visible to this user, with client-role restriction applied when `clientKey` is given. */
    rows<K extends TableName>(
        table: K,
        brandId: ID,
        opts: { capability?: Capability; clientKey?: (row: Tables[K]) => ID } = {},
    ): Tables[K][] {
        const f = this.require(brandId, opts.capability ?? (opts.clientKey ? 'read' : 'staff'));
        const restriction = clientRestriction(f);
        let rows = (this.db.all(table) as Array<Tables[K] & BrandRow>).filter((r) => r.brandId === brandId);
        if (restriction !== null) {
            if (!opts.clientKey || restriction === 'none') return [];
            rows = rows.filter((r) => opts.clientKey!(r) === restriction);
        }
        return structuredClone(rows);
    }

    /** Single row inside the brand; cross-brand ids surface as NotFound. */
    row<K extends TableName>(
        table: K,
        brandId: ID,
        id: ID,
        opts: { capability?: Capability; clientKey?: (row: Tables[K]) => ID; label?: string } = {},
    ): Tables[K] {
        const found = this.rows(table, brandId, opts).find((r) => (r as unknown as BrandRow).id === id);
        if (!found) throw new NotFoundError(opts.label);
        return found;
    }

    /** Raw mutable row after an access check; for use inside write operations only. */
    owned<K extends TableName>(table: K, brandId: ID, id: ID, label?: string): Tables[K] {
        const row = this.db.find(table, id) as (Tables[K] & BrandRow) | undefined;
        if (!row || row.brandId !== brandId) throw new NotFoundError(label);
        return row;
    }

    audit(brandId: ID, action: string, subjectType: string, subjectId: ID): void {
        this.db.insert('auditLogs', {
            id: newId('aud'),
            brandId,
            actorId: this.userId,
            action,
            subjectType,
            subjectId,
            createdAt: this.db.nowIso(),
        });
    }
}

export const byClientId = <R extends { clientId: ID }>(r: R): ID => r.clientId;
