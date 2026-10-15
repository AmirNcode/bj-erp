import { renderToString } from 'react-dom/server';
import { Direction } from 'radix-ui';
import { describe, expect, it } from 'vitest';
import { PermissionSection } from '@/app/[locale]/(app)/settings/roles/_components/PermissionSection';
import { ALL_KEYS, type PermKey } from '@/lib/permissions/catalog';

const t = {
  sensitive: 'Sensitive when allowed',
  title: 'Leave',
  items: Object.fromEntries(ALL_KEYS.map((k) => [k, { label: `L:${k}`, description: `D:${k}` }])) as Record<PermKey, { label: string; description: string }>,
  levels: { edit: 'Allowed', read: 'Read only', none: 'Not allowed', noRead: 'No read', noEdit: 'View only' },
  summary: { custom: 'Custom', allow: 'Allowed', read: 'Read only', none: 'Not allowed' },
  raisedBy: (by: string) => `Raised by ${by}`,
  loweredBy: (by: string) => `Lowered by ${by}`,
};

const section = (
  <PermissionSection section="leave" perms={{}} onChange={() => {}} notes={{}} t={t} defaultOpen />
);

// The locale layout mounts one Direction.Provider; Radix parts (Collapsible, ToggleGroup) read it, so a
// fa page must render dir="rtl" on the server, with no client-side flash.
describe('Direction.Provider (server render)', () => {
  it('renders the permission section with dir="rtl" under an rtl provider', () => {
    const html = renderToString(<Direction.Provider dir="rtl">{section}</Direction.Provider>);
    // Radix parts that take their own dir (ToggleGroup) read the provider on the server...
    expect(html).toMatch(/<div dir="rtl" role="radiogroup"/);
    // ...and the Collapsible root no longer forces dir="ltr" (it inherits <html dir>), so no flash.
    expect(html).not.toContain('dir="ltr"');
    expect(html).not.toMatch(/<div[^>]*data-testid="perm-block-leave"[^>]*dir=/);
  });

  it('renders dir="ltr" under an ltr provider', () => {
    const html = renderToString(<Direction.Provider dir="ltr">{section}</Direction.Provider>);
    expect(html).toMatch(/<div dir="ltr" role="radiogroup"/);
    expect(html).not.toContain('dir="rtl"');
  });
});
