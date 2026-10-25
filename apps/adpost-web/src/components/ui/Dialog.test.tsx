import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';

describe('Dialog', () => {
    it('renders nothing when closed', () => {
        render(<Dialog open={false} title="T" onClose={() => {}}>body</Dialog>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is labelled, focuses the first field, and closes on Escape', async () => {
        const onClose = vi.fn();
        render(
            <Dialog open title="New client" onClose={onClose}>
                <input aria-label="Name" />
            </Dialog>,
        );
        expect(screen.getByRole('dialog', { name: 'New client' })).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalled();
    });
});
