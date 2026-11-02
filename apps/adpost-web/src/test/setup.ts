import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
    // DB tests run in the node environment (`@vitest-environment node`): no DOM to reset.
    if (typeof document === 'undefined') return;
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
});
