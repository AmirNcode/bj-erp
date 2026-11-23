import { beforeEach, expect, it, vi } from 'vitest';
import type { Perms } from '@/lib/permissions/catalog';
import SettingsPage from '@/app/[locale]/(app)/settings/page';
import { SettingsTabs } from '@/app/[locale]/(app)/settings/_components/SettingsTabs';
import { WorkSettingsForm } from '@/app/[locale]/(app)/settings/WorkSettingsForm';
import { HolidayEditor } from '@/app/[locale]/(app)/settings/HolidayEditor';

let perms: Perms;
vi.mock('@/lib/auth/context', () => ({
  getCachedUser: async () => ({ id: 'viewer' }),
  getCachedRoles: async () => [],
  getCachedPermissions: async () => perms,
}));
vi.mock('@/lib/auth/approval-capabilities', () => ({
  getApprovalCapabilities: async () => ({ isAdmin: false, canDelegate: false }),
}));
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/lib/actions/settings', () => ({ getCompanyHolidays: async () => ({ ok: false }) }));
vi.mock('@/app/[locale]/(app)/settings/WorkSettingsForm', () => ({ WorkSettingsForm: vi.fn() }));
vi.mock('@/app/[locale]/(app)/settings/HolidayEditor', () => ({ HolidayEditor: vi.fn() }));

beforeEach(() => { perms = { work_settings: 'edit', holidays: 'read' }; });

async function panel(tab?: string) {
  const page = await SettingsPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({ tab }),
  });
  const [navigation, editor] = page.props.children;
  const tabs = await SettingsTabs(navigation.props);
  const links = tabs?.props.children.map((link: { key: string }) => link.key);
  return { active: navigation.props.active, editor: editor.type, readOnly: editor.props.readOnly, links };
}

it('opens Working Times by default and opens a read-only holiday list from its tab', async () => {
  expect(await panel()).toMatchObject({ active: 'workingTimes', editor: WorkSettingsForm, readOnly: false });
  expect(await panel('holidays')).toMatchObject({ active: 'holidays', editor: HolidayEditor, readOnly: true });
});

it('gives holiday-only viewers a reachable default tab', async () => {
  perms = { holidays: 'read' };
  expect(await panel()).toMatchObject({ active: 'holidays', editor: HolidayEditor, links: ['holidays'] });
});

it('keeps a working-times-only viewer on their permitted tab even with a holiday URL', async () => {
  perms = { work_settings: 'read' };
  expect(await panel('holidays')).toMatchObject({ active: 'workingTimes', editor: WorkSettingsForm, links: ['workingTimes'] });
});
