import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APP = 'app/[locale]/(app)/';

describe('page frame', () => {
  // Each wide page's loading skeleton is wide too, so the frame doesn't jump when data arrives.
  it('data-wide is only on Employees list, Sales records list and Finance (+ their loading skeletons)', () => {
    const out = execSync(`grep -rl "data-wide" app components || true`, { encoding: 'utf8' })
      .split('\n').filter(Boolean).sort();
    expect(out).toEqual([
      APP + '_components/AppShell.tsx',
      APP + 'finance/page.tsx',
      APP + 'manage/employees/loading.tsx',
      APP + 'manage/employees/page.tsx',
      APP + 'sales/loading.tsx',
      APP + 'sales/page.tsx',
    ].sort());
  });

  it('AppShell main is the 1280px column', () => {
    const src = readFileSync(APP + '_components/AppShell.tsx', 'utf8');
    expect(src).toMatch(/<main className="[^"]*max-w-7xl/);
    expect(src).toContain('has-[[data-wide]]:max-w-none');
  });

  it.each([
    'settings/page.tsx', 'settings/roles/page.tsx', 'settings/roles/new/page.tsx', 'settings/roles/[id]/page.tsx',
    'profile/layout.tsx', 'admin/layout.tsx', 'manage/employees/[id]/page.tsx',
  ])('%s has no page-level width cap', (f) => {
    const src = readFileSync(APP + f, 'utf8');
    expect(src).not.toMatch(/max-w-\[900px\]|max-w-\[1000px\]|max-w-5xl/);
  });
});
