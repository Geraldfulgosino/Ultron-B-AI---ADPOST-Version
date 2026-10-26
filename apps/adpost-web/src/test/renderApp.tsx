import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/routes';
import { BackendProvider } from '@/app/backend';
import { LocalBackend } from '@/data/local/backend';
import { DEV_PASSWORD, FIXTURE_IDS } from '@/data/local/fixtures';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { testDb } from './helpers';

/** Render the full app at `path`, optionally already signed in as a fixture user. */
export async function renderApp(path: string, user?: keyof typeof FIXTURE_IDS.users) {
    const db = testDb();
    const backend = new LocalBackend(db);
    if (user) {
        const email = db.find('users', FIXTURE_IDS.users[user])!.email;
        await backend.auth.signIn(email, DEV_PASSWORD);
    }
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    const utils = render(
        <ThemeProvider>
            <BackendProvider backend={backend}>
                <RouterProvider router={router} />
            </BackendProvider>
        </ThemeProvider>,
    );
    return { ...utils, router, backend, db };
}
