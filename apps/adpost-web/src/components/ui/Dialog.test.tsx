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

describe('Dialog focus trap', () => {
    it('Tab from the last control wraps to the first, Shift+Tab wraps back', async () => {
        render(
            <Dialog open title="Trap" onClose={() => {}} footer={<button>Save</button>}>
                <input aria-label="First" />
            </Dialog>,
        );
        const first = screen.getByLabelText('First');
        const close = screen.getByRole('button', { name: 'Close' });
        const save = screen.getByRole('button', { name: 'Save' });
        save.focus();
        await userEvent.tab();
        expect(document.activeElement).toBe(close);
        await userEvent.tab({ shift: true });
        expect(document.activeElement).toBe(save);
        expect(first).toBeInTheDocument();
    });
});
