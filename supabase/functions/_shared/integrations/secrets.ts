/**
 * Integration credential encryption (server-side only).
 *
 * WordPress Application Passwords and Google refresh tokens are encrypted with AES-256-GCM
 * before they are written to public.integration_secrets (a table app users cannot read).
 * The key is the Edge Function secret INTEGRATION_ENCRYPTION_KEY (32 random bytes, base64);
 * it never reaches the browser, Git or logs. The integration id is bound as additional
 * authenticated data, so a ciphertext copied to another integration row does not decrypt.
 */
import { IntegrationError } from './types.ts';

const VERSION = 'v1';

function b64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function importKey(base64Key: string | undefined | null): Promise<CryptoKey> {
    if (!base64Key) throw new IntegrationError('not_configured', 'Integration credential storage is not configured on the server.');
    let raw: Uint8Array<ArrayBuffer>;
    try {
        raw = unb64(base64Key.trim());
    } catch {
        throw new IntegrationError('not_configured', 'The integration encryption key is malformed.');
    }
    if (raw.length !== 32) throw new IntegrationError('not_configured', 'The integration encryption key must be 32 bytes.');
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(key: CryptoKey, integrationId: string, value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(value));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(integrationId) }, key, data));
    return `${VERSION}.${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret<T>(key: CryptoKey, integrationId: string, blob: string): Promise<T> {
    const [v, iv, ct] = blob.split('.');
    if (v !== VERSION || !iv || !ct) throw new IntegrationError('credentials_expired', 'Stored credentials are unreadable; reconnect the integration.');
    try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(integrationId) }, key, unb64(ct));
        return JSON.parse(new TextDecoder().decode(pt)) as T;
    } catch {
        throw new IntegrationError('credentials_expired', 'Stored credentials are unreadable; reconnect the integration.');
    }
}

/** For logs and UI: never more than the last 4 characters. */
export function maskSecret(s: string | null | undefined): string {
    if (!s) return '';
    const t = s.replace(/\s+/g, '');
    return t.length <= 4 ? '••••' : `••••${t.slice(-4)}`;
}
