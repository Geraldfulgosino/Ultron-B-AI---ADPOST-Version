/**
 * Website URL rules. Mirrors app.website_normalize() and the websites_url_format /
 * websites_domain_format checks in supabase/migrations/20261105000008_agency_client_website.sql.
 */
import type { Website, WebsiteEnvironment, WebsitePlatform } from './types';

const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type UrlCheck = { ok: true; url: string; domain: string } | { ok: false; error: string };

/** Validate and normalize a website URL: http(s) only, a public-looking host, no credentials. */
export function normalizeWebsiteUrl(input: string): UrlCheck {
    const raw = input.trim();
    if (!/^https?:\/\//i.test(raw)) return { ok: false, error: 'Enter a full URL starting with https:// (or http://).' };
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return { ok: false, error: 'This is not a valid URL.' };
    }
    if (u.username || u.password) return { ok: false, error: 'Website URLs must not contain a username or password.' };
    const host = u.hostname.toLowerCase();
    if (!HOST.test(host)) return { ok: false, error: 'Use a public domain name such as example.com (not localhost or an IP address).' };
    const path = raw.replace(/^[a-z]+:\/\/[^/?#]+/i, '');
    const url = `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}${path}`;
    if (url.length > 2048) return { ok: false, error: 'The URL is too long.' };
    return { ok: true, url, domain: host };
}

export function isValidDomain(domain: string): boolean {
    return HOST.test(domain.trim().toLowerCase());
}

/** Only an active website with a validated URL may be crawled, audited or treated as connected. */
export function isAuditable(w: Pick<Website, 'websiteUrl' | 'status'>): boolean {
    return !!w.websiteUrl && w.status === 'active';
}

export const ENVIRONMENT_LABELS: Record<WebsiteEnvironment, string> = { production: 'Production', staging: 'Staging', development: 'Development' };
export const PLATFORM_LABELS: Record<WebsitePlatform, string> = { wordpress: 'WordPress', shopify: 'Shopify', custom: 'Custom', other: 'Other', unknown: 'Unknown' };

/** Display label: the domain when known, otherwise the name with a draft marker. */
export function websiteLabel(w: Pick<Website, 'name' | 'domain'>): string {
    return w.domain ?? `${w.name} (no URL yet)`;
}
