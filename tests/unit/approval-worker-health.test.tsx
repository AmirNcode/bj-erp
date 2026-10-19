import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalWorkerHealthCard } from '@/app/[locale]/(app)/settings/roles/_components/ApprovalWorkerHealthCard';
import type { ApprovalWorkerHealth } from '@/lib/leave/delegation';

const mocks = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/actions/approval-delegation', () => ({ getApprovalWorkerHealth: mocks.health }));
const healthy: ApprovalWorkerHealth = {
  job: { active: true, schedule: '* * * * *', job_id: 12 },
  overdue: 0, blocked: 0,
  last_run: { finished_at: '2026-10-18T10:30:00Z' },
  observed_at: '2026-10-18T10:32:00Z',
};
beforeEach(() => { mocks.health.mockReset(); });
afterEach(() => { cleanup(); });
async function show(health: ApprovalWorkerHealth) {
  mocks.health.mockResolvedValue({ ok: true, health });
  render(await ApprovalWorkerHealthCard({ locale: 'en' }));
}

describe('read-only automatic approval status', () => {
  it('explains inactive scheduling while retaining visible overdue and blocked counts', async () => {
    await show({ ...healthy, job: null, overdue: 3, blocked: 1 });
    expect(screen.getByTestId('approval-worker-inactive')).toBeTruthy();
    expect(screen.getByTestId('approval-worker-overdue-count').textContent).toBe('3');
    expect(screen.getByTestId('approval-worker-blocked-count').textContent).toBe('1');
    expect(screen.getByText('inactiveOutstanding')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('distinguishes an active worker that has no completed execution', async () => {
    await show({ ...healthy, last_run: null });
    expect(screen.getByTestId('approval-worker-notRun')).toBeTruthy();
    expect(screen.getByTestId('approval-worker-last-execution').textContent).toBe('noExecution');
  });

  it('shows no outstanding requests and the last recorded execution', async () => {
    await show(healthy);
    expect(screen.getByTestId('approval-worker-healthy')).toBeTruthy();
    expect(screen.getByTestId('approval-worker-last-execution').textContent).not.toBe('noExecution');
    expect(screen.getByTestId('approval-worker-last-execution').textContent).not.toContain('2026-10-18T');
  });

  it('explains requests waiting after their review deadline', async () => {
    await show({ ...healthy, overdue: 2 });
    expect(screen.getByTestId('approval-worker-overdue')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('overdueHint');
  });

  it('does not claim healthy scheduling from an old completed run with no outstanding requests', async () => {
    await show({ ...healthy, last_run: { finished_at: '2026-10-18T10:26:59Z' } });
    expect(screen.getByTestId('approval-worker-stale')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('staleHint');
    expect(screen.queryByTestId('approval-worker-healthy')).toBeNull();
  });

  it('does not trust a future execution timestamp as healthy', async () => {
    await show({ ...healthy, last_run: { finished_at: '2026-10-18T10:33:00Z' } });
    expect(screen.getByTestId('approval-worker-stale')).toBeTruthy();
    expect(screen.queryByTestId('approval-worker-healthy')).toBeNull();
  });

  it('does not treat an invalid execution timestamp as a completed run', async () => {
    await show({ ...healthy, last_run: { finished_at: 'invalid' } });
    expect(screen.getByTestId('approval-worker-notRun')).toBeTruthy();
  });

  it('prioritizes actionable blocked requests over overdue status', async () => {
    await show({ ...healthy, overdue: 2, blocked: 1 });
    expect(screen.getByTestId('approval-worker-blocked')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('blockedHint');
  });

  it('renders a query failure without claiming healthy status', async () => {
    mocks.health.mockResolvedValue({ ok: false, error: 'Localized error' });
    render(await ApprovalWorkerHealthCard({ locale: 'fa' }));
    expect(screen.getByRole('alert').textContent).toContain('Localized error');
    expect(screen.queryByTestId('approval-worker-healthy')).toBeNull();
  });
});
