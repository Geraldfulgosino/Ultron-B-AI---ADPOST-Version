import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useBackend } from '@/app/backend';
import { ErrorState, LoadingState } from '@/components/ui';

const PROVIDER_LABEL = { google_analytics: 'Google Analytics 4', google_search_console: 'Search Console' } as const;

/**
 * Landing page for Google's OAuth redirect. It forwards state/code/error to the server once
 * (the state is single-use), then leaves this URL with `replace`, so the code is not kept in
 * the history. The code and state are never stored, logged or shown.
 */
export function GoogleOAuthCallbackPage() {
    const { backend } = useBackend();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [error, setError] = useState<unknown>(null);
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const query = { state: params.get('state'), code: params.get('code'), error: params.get('error') };
        backend.api().integrations.completeGoogleAuthorization(query).then(
            (r) => navigate(`${r.returnPath}?connected=${r.provider}`, { replace: true, state: { notice: `${PROVIDER_LABEL[r.provider]} is authorized. Choose the property for this website.` } }),
            (e: unknown) => {
                setError(e);
                // Drop the code and state from the address bar even when it failed.
                navigate('/oauth/google/callback', { replace: true });
            },
        );
    }, [backend, params, navigate]);

    return (
        <main id="main" className="mx-auto max-w-lg space-y-4 px-4 py-12">
            <h1 className="text-lg font-semibold text-fg">Google sign-in</h1>
            {error ? (
                <>
                    <ErrorState error={error} />
                    <Link to="/home" className="text-sm font-medium text-accent hover:text-accent-strong">Back to my workspace</Link>
                </>
            ) : (
                <LoadingState label="Finishing Google sign-in…" />
            )}
        </main>
    );
}
