import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, useTransition } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';

afterEach(cleanup);

const spinners = (c: HTMLElement) => c.querySelectorAll('[data-slot="button-spinner"]');

/** Two buttons sharing one pending flag, like a Save / Delete pair in one form. */
function Pair({ onStart }: { onStart?: (start: () => void) => void }) {
  const [pending, setPending] = useState(false);
  const start = () => setPending(true);
  return (
    <>
      <Button pending={pending} onClick={() => (onStart ? onStart(start) : start())}>Save</Button>
      <Button pending={pending} onClick={start}>Delete</Button>
      <button type="button" onClick={start}>outside</button>
    </>
  );
}

describe('Button pending', () => {
  it('pending disables the button and marks it busy', () => {
    render(<Button pending>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });

  it('the pressed button shows a spinner and keeps its label', () => {
    const { container } = render(<Pair />);
    fireEvent.click(screen.getByText('Save'));
    expect(spinners(container).length).toBe(1);
    expect(screen.getByText('Save').closest('button')!.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  });

  it('a sibling sharing the pending flag is disabled but shows no spinner', () => {
    const { container } = render(<Pair />);
    fireEvent.click(screen.getByText('Save'));
    const del = screen.getByText('Delete').closest('button') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.querySelector('[data-slot="button-spinner"]')).toBeNull();
    expect(spinners(container).length).toBe(1);
  });

  it('pending started from elsewhere (no press) shows no spinner', () => {
    const { container } = render(<Pair />);
    fireEvent.click(screen.getByText('outside'));
    expect(spinners(container).length).toBe(0);
    expect((screen.getByText('Save').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('works with useTransition pending', () => {
    function T() {
      const [p, start] = useTransition();
      return <Button pending={p} onClick={() => start(() => new Promise<void>(() => {}))}>Go</Button>;
    }
    const { container } = render(<T />);
    fireEvent.click(screen.getByText('Go'));
    return new Promise<void>((r) => setTimeout(r, 0)).then(() => {
      expect(spinners(container).length).toBe(1);
    });
  });

  it('not pending: enabled, no spinner, no aria-busy', () => {
    const { container } = render(<Button>Save</Button>);
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(spinners(container).length).toBe(0);
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
    expect(spinners(container).length).toBe(0);
  });

  it('pending is not forwarded to the DOM', () => {
    render(<Button pending>Save</Button>);
    expect(screen.getByRole('button').hasAttribute('pending')).toBe(false);
  });

  it('pending keeps the label readable for screen readers (not visibility:hidden)', () => {
    const { container } = render(<Pair />);
    fireEvent.click(screen.getByText('Save'));
    let el: HTMLElement | null = screen.getByText('Save');
    while (el && el !== container) {
      expect(el.className).not.toMatch(/(^|\s)invisible(\s|$)/);
      el = el.parentElement;
    }
  });
});
