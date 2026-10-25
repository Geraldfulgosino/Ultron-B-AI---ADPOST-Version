import type { Client, Website } from '@/domain/types';
import type { ClientsApi, WebsitesApi } from '../contracts';
import { assertValid } from '../errors';
import { newId, slugify } from '@/lib/utils';
import { byClientId, type Scope } from './scope';

const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

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

    const validate = (brandId: string, input: { name?: string; domain?: string; clientId?: string }, selfId?: string) => {
        const domain = input.domain !== undefined ? normalizeDomain(input.domain) : undefined;
        assertValid({
            name: input.name !== undefined && !input.name.trim() && 'Website name is required.',
            domain:
                domain !== undefined &&
                (!DOMAIN.test(domain)
                    ? 'Enter a valid domain, e.g. example.com.'
                    : db.all('websites').some((w) => w.brandId === brandId && w.domain === domain && w.id !== selfId) && 'This domain is already tracked.'),
            // Client must belong to the same brand: never trust a client id from the browser.
            clientId:
                input.clientId !== undefined && !db.all('clients').some((c) => c.id === input.clientId && c.brandId === brandId) && 'Choose a client from this brand.',
        });
        return domain;
    };

    return {
        async list(brandId, filter) {
            return scope
                .rows('websites', brandId, { clientKey: byClientId })
                .filter((w) => !filter?.clientId || w.clientId === filter.clientId)
                .sort((a, b) => a.name.localeCompare(b.name));
        },

        async get(brandId, id) {
            return scope.row('websites', brandId, id, { clientKey: byClientId, label: 'Website' });
        },

        async create(brandId, input) {
            scope.require(brandId, 'write');
            assertValid({ name: !input.name?.trim() && 'Website name is required.', domain: !input.domain?.trim() && 'Domain is required.', clientId: !input.clientId && 'Client is required.' });
            const domain = validate(brandId, input)!;
            const site: Website = {
                id: newId('web'),
                brandId,
                clientId: input.clientId,
                name: input.name.trim(),
                domain,
                platform: input.platform ?? 'custom',
                status: input.status ?? 'active',
                primaryConversion: input.primaryConversion?.trim() || null,
                ga4PropertyId: input.ga4PropertyId?.trim() || null,
                gscSiteUrl: input.gscSiteUrl?.trim() || null,
                createdAt: db.nowIso(),
            };
            db.insert('websites', site);
            scope.audit(brandId, 'website.created', 'website', site.id);
            return structuredClone(site);
        },

        async update(brandId, id, input) {
            scope.require(brandId, 'write');
            scope.owned('websites', brandId, id, 'Website');
            const domain = validate(brandId, input, id);
            const patch: Partial<Website> = {};
            if (input.name !== undefined) patch.name = input.name.trim();
            if (domain !== undefined) patch.domain = domain;
            if (input.clientId !== undefined) patch.clientId = input.clientId;
            if (input.platform !== undefined) patch.platform = input.platform;
            if (input.status !== undefined) patch.status = input.status;
            if (input.primaryConversion !== undefined) patch.primaryConversion = input.primaryConversion?.trim() || null;
            if (input.ga4PropertyId !== undefined) patch.ga4PropertyId = input.ga4PropertyId?.trim() || null;
            if (input.gscSiteUrl !== undefined) patch.gscSiteUrl = input.gscSiteUrl?.trim() || null;
            const updated = db.patch('websites', id, patch);
            scope.audit(brandId, 'website.updated', 'website', id);
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
