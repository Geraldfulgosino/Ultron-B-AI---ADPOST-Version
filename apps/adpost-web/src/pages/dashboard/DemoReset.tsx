import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Alert, Button, Dialog, ErrorState } from '@/components/ui';
import { useAction, useBrand, useQuery } from '@/app/backend';
import { formatNumber } from '@/lib/utils';

/**
 * Admin-only control to restore this client's demo dataset. Needs explicit confirmation and
 * deletes only rows owned by the demo dataset; records created by people are kept.
 */
export function DemoReset() {
    const { brand, can } = useBrand();
    const status = useQuery((api) => api.demo.status(brand.id), [brand.id]);
    const reset = useAction((api) => api.demo.reset(brand.id));
    const [open, setOpen] = useState(false);
    const [done, setDone] = useState<{ removed: number; created: number } | null>(null);
    if (!can.admin || !status.data?.available) return null;

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setDone(null); setOpen(true); }}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset demo data
                </Button>
                {done && <span className="text-xs text-fg-muted" role="status">Demo data restored: {formatNumber(done.created)} demo records re-created.</span>}
            </div>
            <Dialog
                open={open}
                title={`Reset ${brand.name} demo data?`}
                onClose={() => setOpen(false)}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button
                            variant="danger"
                            loading={reset.pending}
                            onClick={async () => {
                                const r = await reset.run();
                                if (r) {
                                    setDone(r);
                                    setOpen(false);
                                }
                            }}
                        >
                            Reset demo data
                        </Button>
                    </>
                }
            >
                <div className="space-y-3 text-sm text-fg-secondary">
                    <p>
                        This deletes the {formatNumber(status.data.rows)} simulated demo records of {brand.name} (metrics, insights, demo chats, demo tasks,
                        approvals, knowledge and audits) and re-creates them in their original state. Changes you made to demo records are lost.
                    </p>
                    <Alert tone="info">Records created by people (your own projects, tasks, chats, documents) and all other clients are not touched. Nothing is sent anywhere.</Alert>
                    {reset.error ? <ErrorState error={reset.error} /> : null}
                </div>
            </Dialog>
        </>
    );
}
