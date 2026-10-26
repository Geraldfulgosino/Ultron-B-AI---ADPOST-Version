import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ChevronRight, LogOut, Plus } from 'lucide-react';
import { useBackend, useQuery } from '@/app/backend';
import { Badge, Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { CreateBrandDialog } from './brand/CreateBrandDialog';

export function BrandPickerPage() {
    const { session, signOut } = useBackend();
    const navigate = useNavigate();
    const brands = useQuery((api) => api.workspace.listBrands(), []);
    const canCreate = useQuery((api) => api.workspace.canCreateBrands(), []);
    const [creating, setCreating] = useState(false);

    // One brand: skip the picker (legacy behaviour: straight to dashboard).
    if (brands.data?.length === 1 && canCreate.data === false) return <Navigate to={`/b/${brands.data[0]!.brand.slug}/dashboard`} replace />;

    return (
        <div className="min-h-screen bg-canvas">
            <header className="bg-surface border-b border-line">
                <div className="mx-auto max-w-4xl flex items-center justify-between px-4 py-4">
                    <div>
                        <p className="text-sm font-bold text-fg">ULTRON-B AI</p>
                        <p className="text-xs text-fg-muted">Signed in as {session?.user.email}</p>
                    </div>
                    <button
                        type="button"
                        className="flex items-center gap-1 text-sm text-fg-soft hover:text-fg"
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
                <div className="flex items-center justify-between gap-3">
                    <h1 className="text-lg font-semibold text-fg">Choose a brand</h1>
                    {canCreate.data && (
                        <Button onClick={() => setCreating(true)}>
                            <Plus className="h-4 w-4" aria-hidden="true" /> New brand
                        </Button>
                    )}
                </div>
                {creating && <CreateBrandDialog onClose={() => setCreating(false)} />}
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
                                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm hover:border-accent-line-strong focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <span className="h-10 w-10 shrink-0 rounded-lg" style={{ backgroundColor: brand.color }} aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium text-fg truncate">{brand.name}</span>
                                    <span className="block text-xs text-fg-muted truncate">{brand.description}</span>
                                </span>
                                <Badge variant={brand.status === 'active' ? 'green' : 'gray'}>{roleLabel}</Badge>
                                <ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                </ul>
            </main>
        </div>
    );
}
