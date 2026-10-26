export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Kept in sync with public/theme-init.js, which applies the theme before React loads. */
export const THEME_STORAGE_KEY = 'adpost.theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
    if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
    return preference;
}

export function systemPrefersDark(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Sets `data-theme` (drives the CSS tokens) and `color-scheme` (native controls, scrollbars). */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
}

/**
 * Where the preference lives. Local mode uses browser storage; once Supabase is connected
 * (Phase 17) a profile-backed store can implement the same interface per signed-in user.
 * Only the preference string is stored, never anything sensitive.
 */
export interface ThemePreferenceStore {
    load(): ThemePreference | null;
    save(preference: ThemePreference): void;
}

export const localThemeStore: ThemePreferenceStore = {
    load() {
        try {
            const value = localStorage.getItem(THEME_STORAGE_KEY);
            return isThemePreference(value) ? value : null;
        } catch {
            return null;
        }
    },
    save(preference) {
        try {
            if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
            else localStorage.setItem(THEME_STORAGE_KEY, preference);
        } catch {
            // Storage blocked (private mode etc.): the theme still applies for this page view.
        }
    },
};
