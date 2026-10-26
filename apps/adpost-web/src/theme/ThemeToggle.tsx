import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';

/** Sidebar dark-mode switch. The accessible name stays "Dark mode"; aria-checked carries the state. */
export function ThemeToggle() {
    const { theme, preference, toggle, setPreference } = useTheme();
    const dark = theme === 'dark';
    const Icon = dark ? Sun : Moon;
    return (
        <div className="px-4 py-3 border-t border-slate-800">
            <button
                type="button"
                role="switch"
                aria-checked={dark}
                onClick={toggle}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-left">Dark mode</span>
                <span aria-hidden="true" className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', dark ? 'bg-indigo-600' : 'bg-slate-700')}>
                    <span className={cn('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white transition-transform', dark ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                </span>
            </button>
            {preference === 'system' ? (
                <p className="mt-1 px-2 text-[11px] text-slate-500">Following system setting</p>
            ) : (
                <button type="button" onClick={() => setPreference('system')} className="mt-1 px-2 text-[11px] text-slate-400 underline-offset-2 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                    Use system setting
                </button>
            )}
        </div>
    );
}
