// Applies the saved (or OS) theme before React renders, so dark mode doesn't flash white.
// A plain file rather than an inline script so the CSP can stay `script-src 'self'`.
// Mirrors src/theme/theme.ts (THEME_STORAGE_KEY, resolveTheme, applyTheme).
(function () {
    var pref = null;
    try {
        pref = localStorage.getItem('adpost.theme');
    } catch (e) {}
    var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
})();
