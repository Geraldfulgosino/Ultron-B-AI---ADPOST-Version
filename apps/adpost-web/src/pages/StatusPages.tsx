import { useEffect, useRef } from 'react';
import { Link, isRouteErrorResponse, useNavigate, useRouteError } from 'react-router';
import { useBackend } from '@/app/backend';
import { cn } from '@/lib/utils';

/**
 * Full-page status message. Always renders the `main` landmark (`#main`, the skip link's target).
 * `embedded` is for use inside a layout that has a skip link but leaves the main region to its
 * pages (the brand shell). The heading takes focus so keyboard and screen-reader users hear
 * the result of a navigation.
 */
function Centered({ code, title, body, to = '/home', cta = 'Go to my workspace', embedded = false, children }: {
    code: string; title: string; body: string; to?: string; cta?: string; embedded?: boolean; children?: React.ReactNode;
}) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => heading.current?.focus(), []);
    return (
        <main id="main" tabIndex={-1} className={cn('flex items-center justify-center bg-canvas px-4 focus:outline-none', embedded ? 'flex-1 py-16' : 'min-h-screen')}>
            <div className="text-center max-w-md">
                <p className="text-sm font-semibold text-accent">{code}</p>
                <h1 ref={heading} tabIndex={-1} className="mt-2 text-2xl font-bold text-fg focus:outline-none">{title}</h1>
                <p className="mt-2 text-sm text-fg-muted">{body}</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm font-medium">
                    <Link to={to} className="text-accent underline-offset-2 hover:text-accent-strong hover:underline">
                        {cta}
                    </Link>
                    {children}
                </div>
            </div>
        </main>
    );
}

export function NotFoundPage() {
    return <Centered code="404" title="Page not found" body="The page you are looking for does not exist." />;
}

/** Shown when a route throws. Never renders raw error details beyond the message. */
export function RouteErrorPage() {
    const error = useRouteError();
    if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
    return <Centered code="Error" title="Something went wrong" body={message} />;
}

/**
 * 403. Links to /home, which picks the right landing page for the user's current roles (and the
 * access-pending screen when they have none), so a revoked membership never loops.
 */
export function ForbiddenPage({ embedded = false }: { embedded?: boolean }) {
    return <Centered code="403" title="Access denied" body="You do not have access to this page. If you think you should, ask your administrator." embedded={embedded} />;
}

/** Signed in, but no active agency or client membership (new account, or access was removed). */
export function AccessPendingPage() {
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    return (
        <Centered
            code="No access yet"
            title="Your account has no workspace yet"
            body={`You are signed in as ${session?.user.email ?? 'a user'}, but no agency or client has given this account access. Ask your administrator for an invitation, then open the invitation link.`}
            to="/me"
            cta="My profile"
        >
            <button
                type="button"
                className="text-fg-soft hover:text-fg"
                onClick={async () => {
                    await signOut();
                    navigate('/login', { replace: true });
                }}
            >
                Sign out
            </button>
        </Centered>
    );
}
