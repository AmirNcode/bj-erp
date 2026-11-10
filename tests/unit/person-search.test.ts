import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { searchPeople } from '@/components/PersonSearch';

const people = [
  { id: 'a', name: 'حسین صحرائی', personnelNo: '103' },
  { id: 'b', name: 'حسن جعفری', personnelNo: '166' },
  { id: 'c', name: 'Ali Hosseini', personnelNo: '1450' },
  { id: 'd', name: 'رضا', personnelNo: '45' },
  { id: 'e', name: 'حسام', personnelNo: null },
];

describe('searchPeople', () => {
  it('needs two characters', () => {
    expect(searchPeople(people, '1', 5)).toEqual([]);
    expect(searchPeople(people, ' ح ', 5)).toEqual([]);
  });
  it('matches personnel numbers, Persian digits too, sorted low to high', () => {
    expect(searchPeople(people, '45', 5).map((p) => p.id)).toEqual(['d', 'c']);
    expect(searchPeople(people, '۴۵', 5).map((p) => p.id)).toEqual(['d', 'c']);
  });
  it('matches names case-insensitively, sorted by number, no-number last', () => {
    expect(searchPeople(people, 'حس', 5).map((p) => p.id)).toEqual(['a', 'b', 'e']);
    expect(searchPeople(people, 'hoss', 5).map((p) => p.id)).toEqual(['c']);
  });
  it('caps the list', () => {
    expect(searchPeople(people, 'حس', 2)).toHaveLength(2);
  });
});

describe('PersonSearch', () => {
  const messages = { personSearch: { placeholder: 'p', noResults: 'n', clear: 'c', selectOne: 's' } };
  const mount = async (props: Record<string, unknown>) => {
    const { render } = await import('@testing-library/react');
    const { NextIntlClientProvider } = await import('next-intl');
    const { PersonSearch } = await import('@/components/PersonSearch');
    const onChange = vi.fn();
    const utils = render(
      createElement(
        NextIntlClientProvider as unknown as React.ComponentType<Record<string, unknown>>,
        { locale: 'en', messages },
        createElement(PersonSearch, { people, value: null, onChange, testId: 'ps', ...props })
      )
    );
    return { ...utils, onChange };
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('does not choose on its own with autoChoose={false}', async () => {
    const { getByTestId, onChange } = await mount({ autoChoose: false });
    fireEvent.change(getByTestId('ps'), { target: { value: '1450' } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('still chooses on its own by default', async () => {
    const { getByTestId, onChange } = await mount({});
    fireEvent.change(getByTestId('ps'), { target: { value: '1450' } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onChange).toHaveBeenCalledWith('c');
  });
  it('shows the hint on a result', async () => {
    const { getByTestId } = await mount({
      autoChoose: false,
      people: [{ id: 'x', name: 'Ali', personnelNo: '5', hint: 'Manager' }],
    });
    fireEvent.change(getByTestId('ps'), { target: { value: 'Al' } });
    expect(getByTestId('ps-option').textContent).toContain('Manager');
  });
});
