import { N8N_EVENTS, type ID, type N8nConnection, type N8nDelivery, type N8nEvent } from '@/domain/types';
import type { AutomationApi } from '../contracts';
import { assertValid, NotFoundError } from '../errors';
import { newId } from '@/lib/utils';
import type { LocalDatabase } from './db';
import type { Scope } from './scope';



/**
 * Full webhook URLs are kept out of the table (and out of every API response),
 * like `n8n_connection_secrets` in Supabase. In-memory only for the local adapter.
 */
const webhookUrls = new WeakMap<LocalDatabase, Map<ID, string>>();

/** https anywhere; plain http only for local/self-hosted n8n (legacy docker host `n8n`). */
export function validateWebhookUrl(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return 'Enter a valid webhook URL.';
    }
    if (url.username || url.password) return 'Webhook URLs must not contain credentials.';
    if (url.protocol === 'https:') return null;
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', 'n8n'].includes(url.hostname)) return null;
    return 'Webhook URL must use https (http is allowed only for localhost or the n8n container).';
}

/**
 * Record an automation event for the brand's active connection. The local adapter
 * never sends HTTP: deliveries are `simulated`. The Supabase `n8n-dispatch` Edge
 * Function performs the signed POST in Phase 17.
 */
export function emitAutomationEvent(db: LocalDatabase, brandId: ID, event: N8nEvent): void {
    const conn = db.all('n8nConnections').find((c) => c.brandId === brandId && c.active && c.events.includes(event));
    if (!conn) return;
    db.insert('n8nDeliveries', {
        id: newId('dlv'), brandId, connectionId: conn.id, event, status: 'simulated', attempt: 1, responseCode: null, error: null, createdAt: db.nowIso(),
    });
}

export function localAutomation(scope: Scope): AutomationApi {
    const { db } = scope;
    const current = (brandId: ID) => db.all('n8nConnections').find((c) => c.brandId === brandId);

    return {
        async get(brandId) {
            scope.require(brandId, 'admin');
            const connection = current(brandId);
            return {
                connection: connection ? structuredClone(connection) : null,
                deliveries: structuredClone(db.all('n8nDeliveries').filter((d) => d.brandId === brandId))
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .slice(0, 50),
            };
        },

        async save(brandId, input) {
            scope.require(brandId, 'admin');
            const urlError = validateWebhookUrl(input.webhookUrl);
            assertValid({
                name: !input.name.trim() && 'Name is required.',
                webhookUrl: urlError,
                events: input.events.some((e) => !N8N_EVENTS.includes(e)) && 'Unknown event selected.',
            });
            const host = new URL(input.webhookUrl.trim()).host;
            const existing = current(brandId);
            let conn: N8nConnection;
            if (existing) {
                conn = db.patch('n8nConnections', existing.id, { name: input.name.trim(), webhookHost: host, events: [...new Set(input.events)], active: input.active ?? existing.active });
            } else {
                conn = db.insert('n8nConnections', {
                    id: newId('n8n'), brandId, name: input.name.trim(), webhookHost: host, events: [...new Set(input.events)], active: input.active ?? true, createdAt: db.nowIso(),
                });
            }
            if (!webhookUrls.has(db)) webhookUrls.set(db, new Map());
            webhookUrls.get(db)!.set(conn.id, input.webhookUrl.trim());
            scope.audit(brandId, 'automation.saved', 'n8n_connection', conn.id);
            return structuredClone(conn);
        },

        async test(brandId) {
            scope.require(brandId, 'admin');
            const conn = current(brandId);
            if (!conn) throw new NotFoundError('Connection');
            const delivery: N8nDelivery = {
                id: newId('dlv'), brandId, connectionId: conn.id, event: 'connection.test', status: 'simulated', attempt: 1, responseCode: null, error: null, createdAt: db.nowIso(),
            };
            db.insert('n8nDeliveries', delivery);
            return structuredClone(delivery);
        },

        async clearDeliveries(brandId) {
            scope.require(brandId, 'admin');
            db.delete('n8nDeliveries', (d) => d.brandId === brandId);
            scope.audit(brandId, 'automation.deliveries_cleared', 'n8n_connection', current(brandId)?.id ?? brandId);
        },

        async disconnect(brandId) {
            scope.require(brandId, 'admin');
            const conn = current(brandId);
            if (!conn) return;
            webhookUrls.get(db)?.delete(conn.id);
            db.delete('n8nDeliveries', (d) => d.connectionId === conn.id);
            db.delete('n8nConnections', (c) => c.id === conn.id);
            scope.audit(brandId, 'automation.disconnected', 'n8n_connection', conn.id);
        },
    };
}
