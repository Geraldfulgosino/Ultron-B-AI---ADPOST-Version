import { Page } from '@/layouts/AppShell';
import { EmptyState } from '@/components/ui';

/** Temporary route target for sections scheduled in a later phase. Clearly labelled; no fake data. */
export function SectionPending({ title, phase }: { title: string; phase: string }) {
    return (
        <Page title={title}>
            <EmptyState title={`${title} is not built yet`} description={`This section is scheduled for Phase ${phase}.`} />
        </Page>
    );
}
