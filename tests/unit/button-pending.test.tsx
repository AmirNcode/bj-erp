import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';

afterEach(cleanup);

describe('Button pending', () => {
  it('pending disables the button and marks it busy', () => {
    render(<Button pending>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });

  it('pending shows a spinner and keeps the label', () => {
    const { container } = render(<Button pending>Save</Button>);
    expect(container.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('not pending: enabled, no spinner, no aria-busy', () => {
    const { container } = render(<Button>Save</Button>);
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(container.querySelector('[data-slot="button-spinner"]')).toBeNull();
    expect(b.hasAttribute('aria-busy')).toBe(false);
  });

  it('click while pending does not fire onClick', () => {
    const onClick = vi.fn();
    render(<Button pending onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('asChild + pending marks the child busy without a spinner', () => {
    const { container } = render(
      <Button asChild pending>
        <a href="#x">Go</a>
      </Button>
    );
    const a = screen.getByText('Go');
    expect(a.getAttribute('aria-busy')).toBe('true');
    expect(a.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('[data-slot="button-spinner"]')).toBeNull();
  });

  it('pending is not forwarded to the DOM', () => {
    render(<Button pending>Save</Button>);
    expect(screen.getByRole('button').hasAttribute('pending')).toBe(false);
  });
});
