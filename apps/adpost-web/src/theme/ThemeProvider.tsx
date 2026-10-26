import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    applyTheme,
    DARK_QUERY,
    localThemeStore,
    resolveTheme,
    systemPrefersDark,
    type ResolvedTheme,
    type ThemePreference,
    type ThemePreferenceStore,
} from './theme';

interface ThemeContextValue {
    preference: ThemePreference;
    theme: ResolvedTheme;
    setPreference: (preference: ThemePreference) => void;
    toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Owns the theme for the whole app: resolves the preference, applies it to <html>, follows OS changes in system mode. */
export function ThemeProvider({ children, store = localThemeStore }: { children: React.ReactNode; store?: ThemePreferenceStore }) {
    const [preference, setPreferenceState] = useState<ThemePreference>(() => store.load() ?? 'system');
    const [systemDark, setSystemDark] = useState(systemPrefersDark);
    const theme = resolveTheme(preference, systemDark);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(DARK_QUERY);
        const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        setSystemDark(mql.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [preference]);

    const setPreference = useCallback(
        (next: ThemePreference) => {
            store.save(next);
            setPreferenceState(next);
        },
        [store],
    );
    const toggle = useCallback(() => setPreference(theme === 'dark' ? 'light' : 'dark'), [theme, setPreference]);

    const value = useMemo(() => ({ preference, theme, setPreference, toggle }), [preference, theme, setPreference, toggle]);
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>.');
    return ctx;
}
