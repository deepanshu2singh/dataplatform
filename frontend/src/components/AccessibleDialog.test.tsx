import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AccessibleDialog } from './AccessibleDialog';

function DialogHarness({ closeDisabled = false }: { closeDisabled?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open && (
        <AccessibleDialog
          title="Accessible test dialog"
          description="A test description."
          onClose={() => setOpen(false)}
          closeDisabled={closeDisabled}
        >
          <div className="p-4">
            <input data-dialog-initial-focus aria-label="Dialog field" />
            <button type="button">Last action</button>
          </div>
        </AccessibleDialog>
      )}
    </>
  );
}

describe('AccessibleDialog', () => {
  it('exposes dialog semantics and moves focus to the preferred control', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    expect(
      screen.getByRole('dialog', { name: 'Accessible test dialog' }),
    ).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('A test description.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dialog field' })).toHaveFocus();
  });

  it('closes with Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps focus inside the dialog when tabbing past the last control', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const lastAction = screen.getByRole('button', { name: 'Last action' });
    lastAction.focus();

    await user.tab();

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('does not close with Escape while closing is disabled', async () => {
    const user = userEvent.setup();
    render(<DialogHarness closeDisabled />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await user.keyboard('{Escape}');

    expect(
      screen.getByRole('dialog', { name: 'Accessible test dialog' }),
    ).toBeInTheDocument();
  });
});
