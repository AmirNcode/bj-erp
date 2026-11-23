import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FormSection } from '@/components/FormSection';
import { FIELD_W } from '@/lib/ui/fieldWidths';

afterEach(cleanup);

describe('FormSection', () => {
  it('renders title as a heading, description and children', () => {
    render(<FormSection title="Working times" description="When the day starts"><input aria-label="x" /></FormSection>);
    expect(screen.getByRole('heading', { name: 'Working times' })).toBeTruthy();
    expect(screen.getByText('When the day starts')).toBeTruthy();
    expect(screen.getByLabelText('x')).toBeTruthy();
  });

  it('is two columns from lg', () => {
    const { container } = render(<FormSection title="T">c</FormSection>);
    expect(container.querySelector('section')!.className).toContain('lg:grid-cols-[20rem_minmax(0,1fr)]');
  });

  it('renders no empty paragraph without a description', () => {
    const { container } = render(<FormSection title="T">c</FormSection>);
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('FIELD_W', () => {
  it('keeps the owner-approved desktop widths', () => {
    expect(FIELD_W.time).toBe('w-full md:w-36');
    expect(FIELD_W.notes).toBe('w-full md:max-w-xl');
  });
});
