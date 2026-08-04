import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplacementPicker } from '@/app/[locale]/(app)/request/_components/ReplacementPicker';

const candidates = [
  {
    profileId: '1',
    fullName: 'Ali Rezaei',
    employeeCode: '1042',
    unavailable: false,
    unavailableReason: null,
  },
  {
    profileId: '2',
    fullName: 'Sara Ahmadi',
    employeeCode: '1043',
    unavailable: true,
    unavailableReason: 'on leave',
  },
];

const labels = {
  title: 'Replacement (optional)',
  hint: 'Who covers for you.',
  select: 'Select a replacement',
  noReplacement: 'No Replacement',
  onLeave: 'on leave',
  loading: 'Loading colleagues…',
  empty: 'No colleagues available.',
};

afterEach(cleanup);

describe('ReplacementPicker', () => {
  it('uses only a dropdown and starts with the replacement prompt', () => {
    render(
      <ReplacementPicker
        candidates={candidates}
        loading={false}
        value=""
        onChange={vi.fn()}
        noReplacement={false}
        onNoReplacementChange={vi.fn()}
        labels={labels}
      />
    );

    expect(screen.queryByRole('searchbox')).toBeNull();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: labels.select })).toBeTruthy();
    expect((screen.getByRole('option', { name: /Sara Ahmadi/ }) as HTMLOptionElement).disabled).toBe(true);
  });

  it('clears and disables the dropdown when No Replacement is selected', () => {
    const onChange = vi.fn();
    const onNoReplacementChange = vi.fn();

    render(
      <ReplacementPicker
        candidates={candidates}
        loading={false}
        value="1"
        onChange={onChange}
        noReplacement
        onNoReplacementChange={onNoReplacementChange}
        labels={labels}
      />
    );

    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: labels.noReplacement }));
    expect(onNoReplacementChange).toHaveBeenCalledWith(false);

    cleanup();
    render(
      <ReplacementPicker
        candidates={candidates}
        loading={false}
        value="1"
        onChange={onChange}
        noReplacement={false}
        onNoReplacementChange={onNoReplacementChange}
        labels={labels}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: labels.noReplacement }));
    expect(onNoReplacementChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
