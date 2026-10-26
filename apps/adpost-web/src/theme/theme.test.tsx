import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isThemePreference, localThemeStore, resolveTheme, THEME_STORAGE_KEY } from './theme';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

/** Controllable `prefers-color-scheme` (jsdom has no matchMedia). */
function mockSystemTheme(initialDark: boolean) {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql = {
        matches: initialDark,
        media: '(prefers-color-scheme: dark)',
        addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mql));
    return {
        set(dark: boolean) {
            mql.matches = dark;
            act(() => listeners.forEach((fn) => fn({ matches: dark } as MediaQueryListEvent)));
        },
        listenerCount: () => listeners.size,
    };
}

const theme = () => document.documentElement.dataset.theme;

function renderToggle() {
    return render(
        <ThemeProvider>
            <ThemeToggle />
        </ThemeProvider>,
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('theme preference helpers', () => {
    it('resolves system to the OS setting and keeps explicit choices', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });

    it('ignores unknown stored values and clears the key for system', () => {
        expect(isThemePreference('sepia')).toBe(false);
        localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
        expect(localThemeStore.load()).toBeNull();
        localThemeStore.save('dark');
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
        localThemeStore.save('system');
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
});

describe('ThemeProvider', () => {
    it('falls back to the OS preference when nothing is saved', () => {
        mockSystemTheme(true);
        renderToggle();
        expect(theme()).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText('Following system setting')).toBeInTheDocument();
    });

    it('defaults to light when the OS has no dark preference (or no matchMedia)', () => {
        renderToggle();
        expect(theme()).toBe('light');
    });

    it('a saved preference wins over the OS setting', () => {
        mockSystemTheme(true);
        localStorage.setItem(THEME_STORAGE_KEY, 'light');
        renderToggle();
        expect(theme()).toBe('light');
    });

    it('toggles instantly and persists the choice across reloads', async () => {
        mockSystemTheme(false);
        const first = renderToggle();
        await userEvent.click(screen.getByRole('switch', { name: 'Dark mode' }));
        expect(theme()).toBe('dark');
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

        first.unmount();
        delete document.documentElement.dataset.theme;
        renderToggle();
        expect(theme()).toBe('dark');
        expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute('aria-checked', 'true');
    });

    it('follows OS changes in system mode, but not after an explicit choice', async () => {
        const os = mockSystemTheme(false);
        renderToggle();
        os.set(true);
        expect(theme()).toBe('dark');
        os.set(false);
        expect(theme()).toBe('light');

        await userEvent.click(screen.getByRole('switch', { name: 'Dark mode' }));
        expect(theme()).toBe('dark');
        expect(os.listenerCount()).toBe(0);
        os.set(false);
        expect(theme()).toBe('dark');
    });

    it('"Use system setting" forgets the saved choice and resumes following the OS', async () => {
        mockSystemTheme(true);
        localStorage.setItem(THEME_STORAGE_KEY, 'light');
        renderToggle();
        await userEvent.click(screen.getByRole('button', { name: 'Use system setting' }));
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
        expect(theme()).toBe('dark');
    });

    it('useTheme requires the provider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
    });
});

describe('public/theme-init.js (runs before React)', () => {
    const script = readFileSync(join(process.cwd(), 'public/theme-init.js'), 'utf8');
    const run = () => new Function(script)();

    it('applies the saved theme', () => {
        localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        run();
        expect(theme()).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('falls back to the OS preference, then light', () => {
        mockSystemTheme(true);
        run();
        expect(theme()).toBe('dark');
        vi.unstubAllGlobals();
        run();
        expect(theme()).toBe('light');
    });

    it('uses the same storage key as the app', () => {
        expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    });
});
