import type { Client, Website } from '@/domain/types';
import type { ClientsApi, WebsiteInput, WebsitesApi } from '../contracts';
import { normalizeWebsiteUrl } from '@/domain/websites';
import { assertValid } from '../errors';
import { newId, slugify } from '@/lib/utils';
import { byClientId, type Scope } from './scope';


/** Accepts "https://www.Example.com/path" and stores "www.example.com" (legacy behaviour). */
export function normalizeDomain(input: string): string {
    return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function localClients(scope: Scope): ClientsApi {
    const { db } = scope;
    const clientKey = (c: Client) => c.id;

    return {
        async list(brandId) {
            return scope.rows('clients', brandId, { clientKey }).sort((a, b) => a.name.localeCompare(b.name));
        },

        async get(brandId, id) {
            return scope.row('clients', brandId, id, { clientKey, label: 'Client' });
        },

        async create(brandId, input) {
            scope.require(brandId, 'write');
            const name = input.name?.trim() ?? '';
            const slug = slugify(name);
            assertValid({
                name: !name && 'Client name is required.',
                slug: name && db.all('clients').some((c) => c.brandId === brandId && c.slug === slug) && 'A client with this name already exists.',
            });
            const client: Client = {
                id: newId('cli'),
                brandId,
                name,
                slug,
                status: input.status ?? 'active',
                timezone: input.timezone ?? 'UTC',
                currency: input.currency ?? 'USD',
                businessGoals: input.businessGoals?.trim() || null,
                createdAt: db.nowIso(),
            };
            db.insert('clients', client);
            scope.audit(brandId, 'client.created', 'client', client.id);
            return structuredClone(client);
        },

        async update(brandId, id, input) {
            scope.require(brandId, 'write');
            const existing = scope.owned('clients', brandId, id, 'Client');
            const patch: Partial<Client> = {};
            if (input.name !== undefined) {
                const name = input.name.trim();
                const slug = slugify(name);
                assertValid({
                    name: !name && 'Client name is required.',
                    slug: db.all('clients').some((c) => c.brandId === brandId && c.slug === slug && c.id !== id) && 'A client with this name already exists.',
                });
                patch.name = name;
                patch.slug = slug;
            }
            if (input.status !== undefined) patch.status = input.status;
            if (input.timezone !== undefined) patch.timezone = input.timezone;
            if (input.currency !== undefined) patch.currency = input.currency;
            if (input.businessGoals !== undefined) patch.businessGoals = input.businessGoals?.trim() || null;
            const updated = db.patch('clients', existing.id, patch);
            scope.audit(brandId, 'client.updated', 'client', id);
            return structuredClone(updated);
        },

        async remove(brandId, id) {
            scope.require(brandId, 'admin');
            scope.owned('clients', brandId, id, 'Client');
            // Matches legacy soft-delete semantics for dependants: websites of the client go too.
            const siteIds = new Set(db.all('websites').filter((w) => w.clientId === id).map((w) => w.id));
            db.delete('websites', (w) => w.clientId === id);
            db.delete('integrations', (i) => siteIds.has(i.websiteId));
            db.delete('clients', (c) => c.id === id);
            scope.audit(brandId, 'client.deleted', 'client', id);
        },
    };
}

export function localWebsites(scope: Scope): WebsitesApi {
    const { db } = scope;

    /** Validates the fields present in the input; returns the normalized URL/domain when a URL was given. */
    const validate = (brandId: string, input: Partial<WebsiteInput>, selfId?: string) => {
        let url: { url: string; domain: string } | null | undefined;
        let urlError: string | false = false;
        if (input.websiteUrl !== undefined) {
            if (input.websiteUrl === null || !input.websiteUrl.trim()) url = null;
            else {
                const r = normalizeWebsiteUrl(input.websiteUrl);
                if (r.ok) url = { url: r.url, domain: r.domain };
                else urlError = r.error;
            }
        }
        assertValid({
            name: input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120) && 'A website name of 1–120 characters is required.',
            websiteUrl: urlError || (!!url && db.all('websites').some((w) => w.brandId === brandId && w.domain === url!.domain && w.id !== selfId) && 'This domain is already tracked for this client.'),
            environment: input.environment !== undefined && !['production', 'staging', 'development'].includes(input.environment) && 'Choose an environment.',
            platform: input.platform !== undefined && !['wordpress', 'shopify', 'custom', 'other', 'unknown'].includes(input.platform) && 'Choose a platform.',
            status: input.status !== undefined && !['active', 'inactive', 'archived'].includes(input.status) && 'Choose a status.',
            description: input.description !== undefined && input.description.length > 2000 && 'At most 2,000 characters.',
            // A legacy client must belong to the same brand: never trust an id from the browser.
            clientId: !!input.clientId && !db.all('clients').some((c) => c.id === input.clientId && c.brandId === brandId) && 'Choose a client from this brand.',
        });
        return url;
    };

    /** Mirrors app.website_normalize(): archive stamps, and one primary per client. */
    const applyLifecycle = (brandId: string, site: Website) => {
        if (site.status === 'archived') {
            site.archivedAt = site.archivedAt ?? db.nowIso();
            site.isPrimary = false;
        } else site.archivedAt = null;
        if (site.isPrimary) {
            for (const w of db.all('websites')) if (w.brandId === brandId && w.id !== site.id && w.isPrimary) db.patch('websites', w.id, { isPrimary: false });
        }
    };

    return {
        async list(brandId, filter) {
            return scope
                .rows('websites', brandId, { clientKey: byClientId })
                .filter((w) => !filter?.clientId || w.clientId === filter.clientId)
                .filter((w) => filter?.includeArchived || w.status !== 'archived')
                .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
        },

        async get(brandId, id) {
            return scope.row('websites', brandId, id, { clientKey: byClientId, label: 'Website' });
        },

        async create(brandId, input) {
            scope.require(brandId, 'write');
            assertValid({ name: !input.name?.trim() && 'Website name is required.' });
            const url = validate(brandId, input);
            const site: Website = {
                id: newId('web'),
                brandId,
                clientId: input.clientId ?? null,
                name: input.name.trim(),
                domain: url?.domain ?? null,
                websiteUrl: url?.url ?? null,
                environment: input.environment ?? 'production',
                // Never assume a platform that was not supplied.
                platform: input.platform ?? 'unknown',
                status: input.status ?? 'active',
                isPrimary: input.isPrimary ?? false,
                description: input.description?.trim() ?? '',
                primaryConversion: input.primaryConversion?.trim() || null,
                ga4PropertyId: input.ga4PropertyId?.trim() || null,
                gscSiteUrl: input.gscSiteUrl?.trim() || null,
                createdAt: db.nowIso(),
                archivedAt: null,
            };
            applyLifecycle(brandId, site);
            db.insert('websites', site);
            scope.audit(brandId, 'website.created', 'website', site.id);
            return structuredClone(site);
        },

        async update(brandId, id, input) {
            scope.require(brandId, 'write');
            const current = scope.owned('websites', brandId, id, 'Website');
            const url = validate(brandId, input, id);
            const next: Website = { ...current };
            if (input.name !== undefined) next.name = input.name.trim();
            if (url !== undefined) { next.websiteUrl = url?.url ?? null; next.domain = url?.domain ?? null; }
            if (input.clientId !== undefined) next.clientId = input.clientId;
            for (const k of ['environment', 'platform', 'status', 'isPrimary'] as const) if (input[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = input[k];
            if (input.description !== undefined) next.description = input.description.trim();
            if (input.primaryConversion !== undefined) next.primaryConversion = input.primaryConversion?.trim() || null;
            if (input.ga4PropertyId !== undefined) next.ga4PropertyId = input.ga4PropertyId?.trim() || null;
            if (input.gscSiteUrl !== undefined) next.gscSiteUrl = input.gscSiteUrl?.trim() || null;
            if (input.status !== undefined && input.status !== 'archived' && current.status === 'archived') next.archivedAt = null;
            applyLifecycle(brandId, next);
            const updated = db.patch('websites', id, next);
            scope.audit(brandId, input.status === 'archived' ? 'website.archived' : current.status === 'archived' && input.status ? 'website.restored' : 'website.updated', 'website', id);
            return structuredClone(updated);
        },

        async remove(brandId, id) {
            scope.require(brandId, 'admin');
            scope.owned('websites', brandId, id, 'Website');
            db.delete('integrations', (i) => i.websiteId === id);
            db.delete('websites', (w) => w.id === id);
            scope.audit(brandId, 'website.deleted', 'website', id);
        },
    };
}
