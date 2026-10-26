import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { renderWithIntl } from './utils';

function Trigger() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast('Saved.')}>
      go
    </button>
  );
}

describe('toasts', () => {
  it('announces politely and can be dismissed', async () => {
    renderWithIntl(
      <ToastProvider dismissLabel="Dismiss">
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Saved.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(region).not.toHaveTextContent('Saved.');
  });
});
