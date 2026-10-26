import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

function Centered({ code, title, body, to = '/', cta = 'Go home' }: { code: string; title: string; body: string; to?: string; cta?: string }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
            <div className="text-center max-w-md">
                <p className="text-sm font-semibold text-accent">{code}</p>
                <h1 className="mt-2 text-2xl font-bold text-fg">{title}</h1>
                <p className="mt-2 text-sm text-fg-muted">{body}</p>
                <Link to={to} className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-strong">
                    {cta}
                </Link>
            </div>
        </div>
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
    return <Centered code="Error" title="Something went wrong" body={message} to="/brands" cta="Back to brands" />;
}

export function ForbiddenPage() {
    return <Centered code="403" title="Access denied" body="You do not have access to this brand or page." to="/brands" cta="Choose a brand" />;
}
