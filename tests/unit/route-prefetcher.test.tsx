import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoutePrefetcher } from '@/app/[locale]/(app)/_components/RoutePrefetcher';

const prefetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch }),
}));

describe('RoutePrefetcher', () => {
  it('prefetches each role-visible tab after the app shell mounts', async () => {
    render(<RoutePrefetcher roles={['manager']} locale="en" />);

    await waitFor(() => {
      expect(prefetch).toHaveBeenCalledWith('/en/home');
      expect(prefetch).toHaveBeenCalledWith('/en/request');
      expect(prefetch).toHaveBeenCalledWith('/en/calendar');
      expect(prefetch).toHaveBeenCalledWith('/en/profile');
      expect(prefetch).toHaveBeenCalledWith('/en/manage/employees');
    });
  });
});
