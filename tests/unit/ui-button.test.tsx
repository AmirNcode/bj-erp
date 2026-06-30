import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button primitive', () => {
  it('renders children and is a button by default', () => {
    render(<Button>ثبت</Button>);
    expect(screen.getByRole('button', { name: 'ثبت' })).toBeTruthy();
  });
  it('default variant is a solid primary button with elevation', () => {
    render(<Button>Go</Button>);

    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn.className).toMatch(/bg-primary/);
    expect(btn.className).toMatch(/shadow/);
    expect(btn.className).toMatch(/font-semibold/);
  });
});
