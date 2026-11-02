import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrendChart } from './TrendChart';

const data = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: i * 10 }));

describe('TrendChart', () => {
    it('"View as table" shows a keyboard-scrollable, labelled table region (axe scrollable-region-focusable)', async () => {
        render(<TrendChart title="Clicks per day" data={data} />);
        await userEvent.click(screen.getByRole('button', { name: 'View as table' }));

        const region = screen.getByRole('region', { name: 'Clicks per day table' });
        expect(region).toHaveAttribute('tabindex', '0');
        expect(region).toContainElement(screen.getByRole('table', { name: 'Clicks per day' }));
        expect(screen.getAllByRole('row')).toHaveLength(data.length + 1);

        await userEvent.click(screen.getByRole('button', { name: 'View as chart' }));
        expect(screen.queryByRole('region', { name: 'Clicks per day table' })).not.toBeInTheDocument();
    });
});
