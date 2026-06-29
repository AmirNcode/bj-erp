import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button primitive', () => {
  it('renders children and is a button by default', () => {
    render(<Button>ثبت</Button>);
    expect(screen.getByRole('button', { name: 'ثبت' })).toBeTruthy();
  });
});
