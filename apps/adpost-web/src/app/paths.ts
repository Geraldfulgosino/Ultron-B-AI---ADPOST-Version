/** Canonical workspace URLs: /a/:agencySlug[/c/:clientSlug]. Client slugs are unique per agency only. */
export const agencyBase = (agencySlug: string) => `/a/${agencySlug}`;
export const clientBase = (b: { agencySlug: string; slug: string }) => `/a/${b.agencySlug}/c/${b.slug}`;
