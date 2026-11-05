/**
 * Hierarchical workspace selector: Agency → Client → (optional) Website.
 * UX only: every request is still authorized by the data layer (RLS / local Scope).
 *  - Changing the agency goes to that agency's overview (client and website reset).
 *  - Changing the client goes to its dashboard (website reset: websites belong to one client).
 *  - The website scope is kept per client in the URL (?website=) and sessionStorage, and is
 *    ignored when the id is not one of the client's current websites.
 */
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useBrand, useQuery } from '@/app/backend';
import { agencyBase, clientBase } from '@/app/paths';
import type { Website } from '@/domain/types';

const storeKey = (brandId: string) => `ultron.website.${brandId}`;
const read = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* storage unavailable */ } };

/** The selected website for the current client, or null for "All websites". */
export function useWebsiteScope(): { websiteId: string | null; website: Website | null; websites: Website[]; setWebsite: (id: string | null) => void } {
    const { brand } = useBrand();
    const [params, setParams] = useSearchParams();
    const websites = useQuery((api) => api.websites.list(brand.id), [brand.id]);
    const requested = params.get('website') ?? read(storeKey(brand.id));
    const list = websites.data ?? [];
    const website = list.find((w) => w.id === requested) ?? null;
    return {
        websiteId: website?.id ?? null,
        website,
        websites: list,
        setWebsite: (id) => {
            write(storeKey(brand.id), id);
            const next = new URLSearchParams(params);
            if (id) next.set('website', id); else next.delete('website');
            setParams(next, { replace: true });
        },
    };
}

const selectClass = 'w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelClass = 'text-xs text-slate-400 uppercase tracking-wide mb-1 block';

export function WorkspaceSelector() {
    const { brand } = useBrand();
    const navigate = useNavigate();
    const location = useLocation();
    const agencies = useQuery((api) => api.agencies.list({ status: 'all' }), []);
    const clients = useQuery((api) => api.workspace.listBrands(), []);
    const { websiteId, websites, setWebsite } = useWebsiteScope();

    const agencyOptions = useMemo(() => (agencies.data ?? []).filter((a) => a.counts && (a.status !== 'archived' || a.id === brand.agencyId)), [agencies.data, brand.agencyId]);
    const clientOptions = (clients.data ?? []).map((c) => c.brand).filter((c) => c.agencyId === brand.agencyId && (c.status !== 'archived' || c.id === brand.id));

    // Keep the stored website scope visible in the URL so refreshes and shared links agree.
    useEffect(() => {
        if (websiteId && !new URLSearchParams(location.search).get('website')) setWebsite(websiteId);
    }, [websiteId]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="space-y-2">
            <div>
                <label htmlFor="agency-switcher" className={labelClass}>Agency</label>
                {agencyOptions.length > 1 ? (
                    <select id="agency-switcher" className={selectClass} value={brand.agencySlug} onChange={(e) => navigate(agencyBase(e.target.value))}>
                        {agencyOptions.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
                    </select>
                ) : (
                    <Link id="agency-switcher" to={agencyBase(brand.agencySlug)} className="block text-sm font-medium text-white truncate hover:underline">{agencyOptions[0]?.name ?? brand.agencySlug}</Link>
                )}
            </div>
            <div>
                <label htmlFor="brand-switcher" className={labelClass}>Client</label>
                {clientOptions.length > 1 ? (
                    <select id="brand-switcher" className={selectClass} value={brand.slug} onChange={(e) => navigate(`${clientBase({ agencySlug: brand.agencySlug, slug: e.target.value })}/dashboard`)}>
                        {clientOptions.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                    </select>
                ) : (
                    <p id="brand-switcher" className="text-sm font-medium text-white truncate">{brand.name}</p>
                )}
            </div>
            <div>
                <label htmlFor="website-switcher" className={labelClass}>Website scope</label>
                <select id="website-switcher" className={selectClass} value={websiteId ?? ''} onChange={(e) => setWebsite(e.target.value || null)} disabled={!websites.length}>
                    <option value="">{websites.length ? `All ${brand.name} websites` : 'No websites yet'}</option>
                    {websites.map((w) => <option key={w.id} value={w.id}>{w.name}{w.domain ? ` (${w.domain})` : ' (no URL)'}</option>)}
                </select>
            </div>
        </div>
    );
}
