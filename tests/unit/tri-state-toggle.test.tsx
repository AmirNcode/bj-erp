import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriStateToggle } from '@/components/ui/tri-state-toggle';

afterEach(cleanup);

const labels = { edit: 'Allowed', read: 'Read only', none: 'Not allowed', noRead: 'No read-only level', noEdit: 'View only' };

describe('TriStateToggle', () => {
  it('marks the current value and changes on click', () => {
    const onChange = vi.fn();
    render(<TriStateToggle value="none" onChange={onChange} shape="RE" labels={labels} name="People" testId="t" />);
    expect(screen.getByTestId('t-none').getAttribute('data-state')).toBe('on');
    expect(screen.getByTestId('t-read').getAttribute('data-state')).toBe('off');
    fireEvent.click(screen.getByTestId('t-read'));
    expect(onChange).toHaveBeenCalledWith('read');
  });

  it('names the group and each segment for assistive tech', () => {
    render(<TriStateToggle value="edit" onChange={() => {}} shape="RE" labels={labels} name="People" testId="t" />);
    expect(screen.getByTestId('t').getAttribute('aria-label')).toBe('People');
    expect(screen.getByTestId('t-edit').getAttribute('aria-label')).toBe('Allowed');
    expect(screen.getByTestId('t-read').getAttribute('aria-label')).toBe('Read only');
    expect(screen.getByTestId('t-none').getAttribute('aria-label')).toBe('Not allowed');
  });

  it('disables read on an action item and edit on a read item', () => {
    const { rerender } = render(<TriStateToggle value="none" onChange={() => {}} shape="E" labels={labels} name="Passwords" testId="t" />);
    expect((screen.getByTestId('t-read') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('t-edit') as HTMLButtonElement).disabled).toBe(false);
    rerender(<TriStateToggle value="none" onChange={() => {}} shape="R" labels={labels} name="Calendar" testId="t" />);
    expect((screen.getByTestId('t-edit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('t-read') as HTMLButtonElement).disabled).toBe(false);
  });

  it('never emits an empty value when the selected segment is clicked again', () => {
    const onChange = vi.fn();
    render(<TriStateToggle value="read" onChange={onChange} shape="RE" labels={labels} name="People" testId="t" />);
    fireEvent.click(screen.getByTestId('t-read'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
