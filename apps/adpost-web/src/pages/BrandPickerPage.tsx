import { Link, Navigate, useNavigate } from 'react-router';
import { ChevronRight, LogOut } from 'lucide-react';
import { useBackend, useQuery } from '@/app/backend';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui';

export function BrandPickerPage() {
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const brands = useQuery((api) => api.workspace.listBrands(), []);

    // One brand: skip the picker (legacy behaviour: straight to dashboard).
    if (brands.data?.length === 1) return <Navigate to={`/b/${brands.data[0]!.brand.slug}/dashboard`} replace />;

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200">
                <div className="mx-auto max-w-4xl flex items-center justify-between px-4 py-4">
                    <div>
                        <p className="text-sm font-bold text-gray-900">ULTRON-B AI</p>
                        <p className="text-xs text-gray-500">Signed in as {session?.user.email}</p>
                    </div>
                    <button
                        type="button"
                        className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                        onClick={async () => {
                            await signOut();
                            navigate('/login', { replace: true });
                        }}
                    >
                        <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                    </button>
                </div>
            </header>
            <main className="mx-auto max-w-4xl px-4 py-8 space-y-4">
                <h1 className="text-lg font-semibold text-gray-900">Choose a brand</h1>
                {brands.loading && <LoadingState />}
                {brands.error ? <ErrorState error={brands.error} onRetry={brands.reload} /> : null}
                {brands.data?.length === 0 && (
                    <EmptyState title="You don't belong to any brand yet" description="Ask a brand admin to invite you, then open the invitation link." />
                )}
                <ul className="grid gap-3 sm:grid-cols-2">
                    {brands.data?.map(({ brand, roleLabel }) => (
                        <li key={brand.id}>
                            <Link
                                to={`/b/${brand.slug}/dashboard`}
                                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <span className="h-10 w-10 shrink-0 rounded-lg" style={{ backgroundColor: brand.color }} aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium text-gray-900 truncate">{brand.name}</span>
                                    <span className="block text-xs text-gray-500 truncate">{brand.description}</span>
                                </span>
                                <Badge variant={brand.status === 'active' ? 'green' : 'gray'}>{roleLabel}</Badge>
                                <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                </ul>
            </main>
        </div>
    );
}
