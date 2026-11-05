import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Full-app UI tests render lazy routes and type character by character. Under CPU contention
// (parallel suites, slow CI) the 1 s default wait was too short and failed intermittently
// (reproduced 2026-11-05 with four concurrent runs). Waiting longer changes no assertion.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
    // DB tests run in the node environment (`@vitest-environment node`): no DOM to reset.
    if (typeof document === 'undefined') return;
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
});
