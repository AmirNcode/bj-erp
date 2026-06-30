import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '@/components/StatusBadge';

const labels = { pending: 'در انتظار', approved: 'تأیید شد', rejected: 'رد شد', cancelled: 'لغو شد' };

describe('StatusBadge', () => {
  it('renders the localized label for the status', () => {
    render(<StatusBadge status="approved" labels={labels} />);
    expect(screen.getByText('تأیید شد')).toBeTruthy();
  });
  it('applies a status-specific class', () => {
    render(<StatusBadge status="rejected" labels={labels} />);
    expect(screen.getByText('رد شد').className).toContain('destructive');
  });
});
