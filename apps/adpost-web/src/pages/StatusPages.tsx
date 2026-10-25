import { Link } from 'react-router';

function Centered({ code, title, body, to = '/', cta = 'Go home' }: { code: string; title: string; body: string; to?: string; cta?: string }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="text-center max-w-md">
                <p className="text-sm font-semibold text-indigo-600">{code}</p>
                <h1 className="mt-2 text-2xl font-bold text-gray-900">{title}</h1>
                <p className="mt-2 text-sm text-gray-500">{body}</p>
                <Link to={to} className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
                    {cta}
                </Link>
            </div>
        </div>
    );
}

export function NotFoundPage() {
    return <Centered code="404" title="Page not found" body="The page you are looking for does not exist." />;
}

export function ForbiddenPage() {
    return <Centered code="403" title="Access denied" body="You do not have access to this brand or page." to="/brands" cta="Choose a brand" />;
}
