import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { TrendChart, niceTicks, compact } from '@/components/charts/TrendChart';

describe('charts', () => {
    it('niceTicks / compact produce clean axis labels', () => {
        expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
        expect(niceTicks(1840)).toEqual([0, 500, 1000, 1500, 2000]);
        expect(niceTicks(0)).toEqual([0]);
        expect(compact(12_900)).toBe('12.9K');
        expect(compact(4_200_000)).toBe('4.2M');
    });

    it('keyboard reads values through the tooltip; table view lists every point', async () => {
        render(<TrendChart title="Sessions" data={[{ date: '2026-10-01', value: 10 }, { date: '2026-10-02', value: 25 }]} />);
        const chart = screen.getByRole('img', { name: /Sessions: 2 days, latest 25/ });
        chart.focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('status')).toHaveTextContent('10');
        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('status')).toHaveTextContent('25');
        await userEvent.click(screen.getByRole('button', { name: 'View as table' }));
        expect(screen.getByRole('table', { name: 'Sessions' })).toHaveTextContent('2026-10-02');
    });

    it('renders an empty state without data', () => {
        render(<TrendChart title="Clicks" data={[]} />);
        expect(screen.getByText('No data for this range.')).toBeInTheDocument();
    });
});

describe('parity pages', () => {
    it('dashboard shows counts, KPIs, insights and integration status', async () => {
        await renderApp('/b/pod/dashboard', 'priya');
        expect(await screen.findByText('Insights pending review')).toBeInTheDocument();
        expect(screen.getByText('Sessions (GA4)')).toBeInTheDocument();
        expect(screen.getByText('Latest SEO insights')).toBeInTheDocument();
        expect(screen.getAllByText(/vs previous 28 days/).length).toBe(4);
    });

    it('creates a client and shows validation errors', async () => {
        await renderApp('/b/pod/clients', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /New client/ }));
        const dialog = screen.getByRole('dialog', { name: 'New client' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
        expect(await within(dialog).findByText('Client name is required.')).toBeInTheDocument();
        await userEvent.type(within(dialog).getByLabelText(/^Name/), 'POD Wholesale');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
        expect(await screen.findByText('POD Wholesale')).toBeInTheDocument();
    });

    it('viewers get no write controls on clients', async () => {
        await renderApp('/b/pod/clients', 'vic');
        expect(await screen.findByText('POD Store')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /New client/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('adds a website with domain normalisation', async () => {
        await renderApp('/b/pod/websites', 'priya');
        await userEvent.click(await screen.findByRole('button', { name: /New website/ }));
        const dialog = screen.getByRole('dialog', { name: 'New website' });
        await userEvent.type(within(dialog).getByLabelText(/^Name/), 'POD Help');
        await userEvent.type(within(dialog).getByLabelText(/^Domain/), 'https://Help.POD.example.test/faq');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create website' }));
        expect(await screen.findByText('help.pod.example.test')).toBeInTheDocument();
    });

    it('approves an insight from its detail page and records notes', async () => {
        const { db } = await renderApp('/b/pod/seo/insights', 'priya');
        const list = await screen.findByRole('list', { name: 'Insights' });
        const firstLink = within(list).getAllByRole('link')[0]!;
        const title = firstLink.textContent!;
        await userEvent.click(firstLink);
        await userEvent.type(await screen.findByLabelText('Notes'), 'Ship it');
        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(await screen.findByText('Ship it')).toBeInTheDocument();
        expect(db.all('seoInsights').find((i) => i.title === title)?.status).toBe('approved');
        expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    });

    it('bulk-dismisses selected insights', async () => {
        await renderApp('/b/pod/seo/insights', 'priya');
        const list = await screen.findByRole('list', { name: 'Insights' });
        const before = within(list).getAllByRole('checkbox').length;
        await userEvent.click(within(list).getAllByRole('checkbox')[0]!);
        await userEvent.click(within(list).getAllByRole('checkbox')[1]!);
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(await screen.findByText('2 dismissed.')).toBeInTheDocument();
        await waitFor(() => expect(within(screen.getByRole('list', { name: 'Insights' })).getAllByRole('checkbox')).toHaveLength(before - 2));
    });

    it('SEO overview filters by website', async () => {
        await renderApp('/b/pod/seo', 'priya');
        expect(await screen.findByText('Top queries')).toBeInTheDocument();
        await userEvent.selectOptions(screen.getByLabelText('Website'), 'web_pod_2');
        await waitFor(() => expect(screen.getAllByRole('cell').some((c) => c.textContent?.startsWith('blog '))).toBe(true));
    });

    it('reports: exports CSV and PDF, records audit + automation', async () => {
        const created: Blob[] = [];
        URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x'; });
        URL.revokeObjectURL = vi.fn();
        const { db } = await renderApp('/b/pod/reports', 'priya');
        expect(await screen.findByText('Executive summary')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
        await userEvent.click(screen.getByRole('button', { name: /Export PDF/ }));
        await waitFor(() => expect(created).toHaveLength(2));
        expect(created[0]!.type).toBe('text/csv;charset=utf-8');
        expect(created[1]!.type).toBe('application/pdf');
        expect((await created[0]!.text()).startsWith('ULTRON-B AI Report Export')).toBe(true);
        expect(db.all('auditLogs').map((a) => a.action)).toEqual(['report.exported_csv', 'report.exported_pdf']);
    });

    it('client portal user sees only their website in report filters', async () => {
        await renderApp('/b/pod/reports', 'casey');
        await screen.findByText('Executive summary');
        const options = within(screen.getByLabelText('Website')).getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['All websites', 'POD Store']);
    });

    it('automation: save connection, send simulated test, admin-only page', async () => {
        await renderApp('/b/pod/automation', 'priya');
        await userEvent.type(await screen.findByLabelText(/Webhook URL/), 'http://evil.example/hook');
        await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
        expect(await screen.findByText(/must use https/)).toBeInTheDocument();
        const url = screen.getByLabelText(/Webhook URL/);
        await userEvent.clear(url);
        await userEvent.type(url, 'https://hooks.example.test/webhook/abc');
        await userEvent.click(screen.getByLabelText(/SEO insight approved/));
        await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
        expect(await screen.findByText('Active · hooks.example.test')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Send test' }));
        expect(await screen.findByText('Connection test')).toBeInTheDocument();
        expect(screen.getByText('Simulated')).toBeInTheDocument();
    });

    it('automation page is forbidden for managers', async () => {
        await renderApp('/b/pod/automation', 'morgan');
        expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    });

    it('integrations: connect after disconnect shows pending OAuth note', async () => {
        await renderApp('/b/pod/integrations', 'priya');
        const card = (await screen.findAllByText('POD Store'))[0]!.closest('div.bg-surface') as HTMLElement;
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        fireEvent.click(within(card).getAllByRole('button', { name: 'Disconnect' })[0]!);
        await userEvent.click(await within(card).findByRole('button', { name: 'Connect' }));
        expect(await within(card).findByText('Pending OAuth')).toBeInTheDocument();
    });
});
