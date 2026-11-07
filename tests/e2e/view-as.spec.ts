/**
 * FR-86 View as, end to end through the gateway (E2E_BASE_URL), design §7 and §12.
 *
 * Throwaway 999… people only: the local database holds the real roster. Database
 * checks read the local Docker stack's `bj-erp-db-1` with psql (deploy/.env), because
 * the admin cannot read other people's signatures through RLS, and the one write here
 * (blanking a throwaway person's personnel number) has no app path. Local stack only.
 *
 * Run with the global setup off, so it does not rewrite the real admin's language:
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY= E2E_BASE_URL=<APP_ORIGIN> npx playwright test tests/e2e/view-as.spec.ts --workers=1
 * then `npm run cleanup:e2e` by hand (the teardown cannot reach the gateway).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, createEmployee, firstLoginPassword, login } from './_helpers';

// --- local database ----------------------------------------------------------

function dbPassword(): string {
  const env = readFileSync(path.join(__dirname, '../../deploy/.env'), 'utf8');
  const m = env.match(/^POSTGRES_PASSWORD=(.*)$/m);
  if (!m) throw new Error('deploy/.env has no POSTGRES_PASSWORD: this spec needs the local Docker stack');
  return m[1].trim();
}

/** Run SQL as supabase_admin on the local stack; returns unaligned, tuples-only output. */
function sql(text: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', '-e', 'PGPASSWORD', 'bj-erp-db-1', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-AtqX', '-v', 'ON_ERROR_STOP=1'],
    { input: text, encoding: 'utf8', env: { ...process.env, PGPASSWORD: dbPassword() } }
  ).trim();
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const idOf = (code: string) => sql(`select id from public.profiles where employee_code = ${lit(code)};`);
const langOf = (id: string) => sql(`select language_pref from public.profiles where id = ${lit(id)};`);
const signatureOf = (id: string) =>
  sql(`select coalesce((select md5(signature_data) from public.user_signatures where user_id = ${lit(id)}), 'none');`);
const adminId = () => sql(`select user_id from public.user_roles where role = 'admin' limit 1;`);

// --- people --------------------------------------------------------------------

type Person = { code: string; issued: string; name: string; id: string; pno: string | null };
const people: Record<'emp' | 'mgr' | 'hr' | 'custom' | 'nopno' | 'fresh', Person> = {} as never;
const ts = Date.now() % 100000;
const roleName = `VA Desk ${ts}`;
let adminOriginalLang = 'en';

/** The password a person has after `login` (first-login screen done), or the issued one. */
const loggedIn = new Set<string>();
const passwordOf = (p: Person) => (loggedIn.has(p.code) ? firstLoginPassword(p.issued) : p.issued);

async function adminContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  return { ctx, page };
}

/** Choose a person on Admin › View as and land on their Home with the strip. */
async function startView(page: Page, query: string, name: string) {
  await page.goto('/en/admin/view-as');
  const box = page.getByTestId('view-as-person');
  const option = page.getByTestId('view-as-person-option').filter({ hasText: name });
  await expect(async () => {
    await box.fill('');
    await box.fill(query);
    await expect(option.first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await option.first().click();
  await expect(page).toHaveURL(/\/en\/home$/, { timeout: 30_000 });
  await expect(page.getByTestId('view-as-bar')).toBeVisible({ timeout: 30_000 });
}

/** The nav links (test id + locale-free path), as a sorted set. */
async function navSet(page: Page): Promise<string[]> {
  await expect(page.locator('nav [data-testid="nav-home"]')).toBeVisible({ timeout: 30_000 });
  const items = await page.locator('nav a[data-testid^="nav-"]').evaluateAll((els) =>
    els.map((e) => {
      const p = new URL((e as HTMLAnchorElement).href).pathname.replace(/^\/(en|fa)(?=\/|$)/, '');
      return `${e.getAttribute('data-testid')} ${p || '/'}`;
    })
  );
  return [...new Set(items)].sort();
}

/** The person's nav when they log in themselves (a fresh browser). */
async function ownNav(browser: Browser, p: Person): Promise<string[]> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, p.code, p.issued);
    loggedIn.add(p.code);
    return await navSet(page);
  } finally {
    await ctx.close();
  }
}

async function drawSignature(page: Page) {
  await page.getByTestId('saved-signature-draw').click();
  const canvas = page.getByTestId('saved-signature-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('saved-signature-draw-done').click();
  await expect(page.getByTestId('saved-signature-save')).toBeVisible();
}

async function exitView(page: Page) {
  await page.getByTestId('view-as-exit').click();
  await expect(page).toHaveURL(/\/en\/admin\/view-as$/, { timeout: 30_000 });
  await expect(page.getByTestId('view-as-bar')).toHaveCount(0);
}

const PAGE_FAILURES = [
  'Application error',
  'This page could not be found',
  'Read-only while viewing',
  'This view has ended',
  'در حالت مشاهده چیزی ذخیره نمی‌شود',
  'این مشاهده پایان یافته است',
];

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 60_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const { ctx, page } = await adminContext(browser);
  try {
    // The language test needs an `en` admin. Through the app's own switch, and put back after.
    adminOriginalLang = langOf(adminId());
    if (adminOriginalLang !== 'en') {
      await page.getByTestId('nav-lang-en').click();
      await expect(page).toHaveURL(/\/en\/home$/, { timeout: 20_000 });
    }

    const make = async (key: keyof typeof people, roles: string[]) => {
      const name = `VA ${key} ${ts}`;
      const r = await createEmployee(page, { name, roles });
      people[key] = { code: r.code, issued: r.password, name, id: idOf(r.code), pno: r.code };
    };
    await make('emp', ['employee']);
    await make('mgr', ['employee', 'manager']);
    await make('hr', ['employee', 'hr']);
    await make('custom', ['employee']);
    await make('nopno', ['employee']);
    await make('fresh', ['employee']);

    // Custom role (Employee records: read), then make it the custom person's only role.
    await page.goto('/en/settings/roles/new');
    await expect(page.getByTestId('role-editor')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('role-name').fill(roleName);
    await expect(page.getByTestId('role-name')).toHaveValue(roleName);
    await page.getByTestId('perm-people-read').click();
    await page.getByTestId('role-save').click();
    // Saving a sensitive permission asks first; Employee records is one.
    const confirm = page.getByTestId('sensitive-confirm');
    await expect(async () => {
      if (/\/settings\/roles\/[0-9a-f-]{36}$/.test(page.url())) return;
      if (await confirm.isVisible()) await confirm.click();
      await expect(page).toHaveURL(/\/settings\/roles\/[0-9a-f-]{36}$/, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const roleId = page.url().split('/').pop()!;
    await page.goto(`/en/manage/employees/${people.custom.id}`);
    // The pill's input is visually hidden: click its label.
    const pill = (id: string) => page.locator(`[data-testid="role-${id}"]`);
    await pill(roleId).click();
    await expect(pill(roleId).locator('input')).toBeChecked();
    await pill('employee').click();
    await expect(pill('employee').locator('input')).not.toBeChecked();
    await page.getByTestId('edit-save').click();
    await expect(page.getByTestId('edit-success')).toBeVisible({ timeout: 20_000 });
    expect(sql(`select count(*) from public.user_roles where user_id = ${lit(people.custom.id)};`)).toBe('1');

    // No personnel number: no app path blanks one, so on the local DB as the admin
    // (trigger enforce_profile_update_scope), scoped to this throwaway login code.
    sql(`begin;
      select set_config('request.jwt.claims', json_build_object('sub', ${lit(adminId())}, 'role', 'authenticated')::text, true);
      update public.profiles set personnel_no = null
       where id = ${lit(people.nopno.id)} and employee_code ~ '^999[0-9]{7}$';
      commit;`);
    expect(sql(`select coalesce(personnel_no, 'null') from public.profiles where id = ${lit(people.nopno.id)};`)).toBe('null');
    people.nopno.pno = null;
  } finally {
    await ctx.close();
  }
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await adminContext(browser);
  try {
    await page.goto('/en/settings/roles');
    const row = page.locator('[data-testid^="role-row-"]', { hasText: roleName });
    if (await row.count()) {
      const id = (await row.first().getAttribute('data-testid'))!.replace('role-row-', '');
      await page.getByTestId(`role-delete-${id}`).click();
      await expect(page.getByTestId('delete-confirm')).toBeEnabled({ timeout: 20_000 });
      await page.getByTestId('delete-confirm').click();
      await expect(page.getByTestId(`role-row-${id}`)).toHaveCount(0);
    }
    if (adminOriginalLang === 'fa' && langOf(adminId()) !== 'fa') {
      await page.goto('/en/home');
      await page.getByTestId('nav-lang-fa').click();
      await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
    }
  } finally {
    await ctx.close();
  }
});

test('start from Admin › View as: strip names the person, nav matches their own login', async ({ browser }) => {
  test.setTimeout(240_000);
  const own = await ownNav(browser, people.emp);
  const { ctx, page } = await adminContext(browser);
  try {
    await expect(page.getByTestId('nav-admin')).toBeVisible();
    await startView(page, people.emp.name, people.emp.name);
    await expect(page.getByTestId('view-as-bar')).toContainText(`${people.emp.name} E2E (${people.emp.pno})`);
    await expect(page.getByTestId('nav-admin')).toHaveCount(0);
    expect(await navSet(page)).toEqual(own);
  } finally {
    await ctx.close();
  }
});

test('exact personnel number typed: nothing starts until a result is clicked', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await adminContext(browser);
  try {
    await page.goto('/en/admin/view-as');
    const box = page.getByTestId('view-as-person');
    const option = page.getByTestId('view-as-person-option');
    await expect(async () => {
      await box.fill('');
      await box.fill(people.mgr.pno!);
      await expect(option).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    // PersonSearch auto-picks an exact number after 600 ms elsewhere; not here.
    await page.waitForTimeout(2_000);
    await expect(page).toHaveURL(/\/en\/admin\/view-as$/);
    await expect(page.getByTestId('view-as-bar')).toHaveCount(0);
    expect(await ctx.cookies()).not.toContainEqual(expect.objectContaining({ name: 'bj-view-as' }));
    await option.click();
    await expect(page).toHaveURL(/\/en\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId('view-as-bar')).toContainText(people.mgr.pno!);
  } finally {
    await ctx.close();
  }
});

test('while viewing: /en/admin goes Home, Profile save and Logout are refused, admin stays signed in', async ({ browser }) => {
  test.setTimeout(240_000);
  const before = signatureOf(people.emp.id);
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.emp.name, people.emp.name);

    await page.goto('/en/admin');
    await expect(page).toHaveURL(/\/en\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId('view-as-bar')).toBeVisible();

    await page.goto('/en/profile');
    await drawSignature(page);
    await page.getByTestId('saved-signature-save').click();
    await expect(page.getByTestId('saved-signature-error')).toContainText('Read-only while viewing', { timeout: 20_000 });
    expect(signatureOf(people.emp.id)).toBe(before);

    await page.reload();
    await page.getByTestId('settings-logout').click();
    await page.getByTestId('logout-confirm').click();
    await expect(page.getByText('Read-only while viewing. Nothing was saved.')).toBeVisible({ timeout: 10_000 });
    await page.goto('/en/home');
    await expect(page.getByTestId('view-as-bar')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('home-board')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('language: an en admin reaches Farsi and back; neither language_pref changes', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminId();
  const adminLang = langOf(admin);
  const empLang = langOf(people.emp.id);
  expect(adminLang).toBe('en');
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.emp.name, people.emp.name);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByTestId('view-as-lang-fa').click();
    // Farsi is the default locale: next-intl may or may not keep the /fa prefix here.
    await expect(page).toHaveURL(/\/\/[^/]+(\/fa)?\/home$/, { timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('view-as-bar')).toContainText('فقط مشاهده');
    // A full reload on the Farsi URL stays Farsi (proxy skips the locale redirect).
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa', { timeout: 30_000 });
    await page.getByTestId('view-as-lang-en').click();
    await expect(page).toHaveURL(/\/en\/home$/, { timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(langOf(admin)).toBe(adminLang);
    expect(langOf(people.emp.id)).toBe(empLang);
  } finally {
    await ctx.close();
  }
});

test('Exit returns to the View as tab with the admin nav; Audit names the person', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.hr.name, people.hr.name);
    await exitView(page);
    await expect(page.getByTestId('admin-view-as')).toBeVisible();
    await expect(page.getByTestId('nav-admin')).toBeVisible();
    expect(await ctx.cookies()).not.toContainEqual(expect.objectContaining({ name: 'bj-view-as' }));

    await page.goto(`/en/admin/audit?about=${people.hr.id}`);
    const rows = page.getByTestId('audit-row');
    await expect(rows.filter({ hasText: 'view_as.start' }).filter({ hasText: people.hr.name }).first()).toBeVisible({ timeout: 20_000 });
    await expect(rows.filter({ hasText: 'view_as.end' }).filter({ hasText: people.hr.name }).first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('custom-role-only target: nav shows what their custom role allows', async ({ browser }) => {
  test.setTimeout(240_000);
  const own = await ownNav(browser, people.custom);
  expect(own.some((s) => s.startsWith('nav-manage '))).toBe(true);
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.custom.name, people.custom.name);
    expect(await navSet(page)).toEqual(own);
    await expect(page.getByTestId('view-as-bar')).toContainText(people.custom.name);
  } finally {
    await ctx.close();
  }
});

test('no personnel number: result and strip read cleanly', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await adminContext(browser);
  try {
    await page.goto('/en/admin/view-as');
    const box = page.getByTestId('view-as-person');
    const option = page.getByTestId('view-as-person-option').filter({ hasText: people.nopno.name });
    await expect(async () => {
      await box.fill('');
      await box.fill(people.nopno.name);
      await expect(option).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    const text = (await option.innerText()).replace(/\s+/g, ' ').trim();
    expect(text).not.toMatch(/null|undefined|\(\)/);
    await option.click();
    await expect(page.getByTestId('view-as-bar')).toBeVisible({ timeout: 30_000 });
    const strip = (await page.getByTestId('view-as-bar').innerText()).replace(/\s+/g, ' ');
    expect(strip).toContain(`Viewing as ${people.nopno.name} E2E`);
    expect(strip).not.toMatch(/null|undefined|\(\)|\(\s*\)/);
    await expect(page.getByTestId('home-board')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('second tab: Exit in one reloads the other as the admin', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.emp.name, people.emp.name);
    const other = await ctx.newPage();
    await other.goto('/en/home');
    await expect(other.getByTestId('view-as-bar')).toBeVisible({ timeout: 30_000 });
    await expect(other.getByTestId('nav-admin')).toHaveCount(0);
    await exitView(page);
    await expect(other.getByTestId('view-as-bar')).toHaveCount(0, { timeout: 30_000 });
    await expect(other.getByTestId('nav-admin')).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx.close();
  }
});

test('view dies with a form open: a second browser starts a view, Save in the first is refused', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminId();
  const adminSigBefore = signatureOf(admin);
  const empSigBefore = signatureOf(people.emp.id);
  const a = await adminContext(browser);
  const b = await adminContext(browser);
  try {
    await startView(a.page, people.emp.name, people.emp.name);
    await a.page.goto('/en/profile');
    await drawSignature(a.page);

    await startView(b.page, people.mgr.name, people.mgr.name);

    await a.page.getByTestId('saved-signature-save').click();
    await expect(a.page.getByTestId('saved-signature-error')).toContainText('This view has ended', { timeout: 20_000 });
    expect(signatureOf(people.emp.id)).toBe(empSigBefore);
    expect(signatureOf(admin)).toBe(adminSigBefore);

    await a.page.reload();
    await expect(a.page).toHaveURL(/\/en\/admin\/view-as\?ended=1$/, { timeout: 30_000 });
    await expect(a.page.getByTestId('view-as-ended')).toBeVisible();
    await expect(a.page.getByTestId('view-as-bar')).toHaveCount(0);
    expect(await a.ctx.cookies()).not.toContainEqual(expect.objectContaining({ name: 'bj-view-as' }));
    await exitView(b.page);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

test('leftover cookie: the admin login ends mid-view, an employee logs in on that browser', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.mgr.name, people.mgr.name);
    // End only the admin's login; the view cookie stays.
    await ctx.clearCookies({ name: /^bj-auth/ });
    expect(await ctx.cookies()).toContainEqual(expect.objectContaining({ name: 'bj-view-as' }));
    await page.goto('/en/home');
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    await login(page, people.emp.code, passwordOf(people.emp));
    loggedIn.add(people.emp.code);
    await expect(page.getByTestId('home-board')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('view-as-bar')).toHaveCount(0);
    await expect(page.getByTestId('nav-admin')).toHaveCount(0);
    expect(await ctx.cookies()).not.toContainEqual(expect.objectContaining({ name: 'bj-view-as' }));
  } finally {
    await ctx.close();
  }
});

test('must_change_password target can be viewed, and Home loads', async ({ browser }) => {
  test.setTimeout(180_000);
  expect(sql(`select must_change_password from public.profiles where id = ${lit(people.fresh.id)};`)).toBe('t');
  const { ctx, page } = await adminContext(browser);
  try {
    await startView(page, people.fresh.name, people.fresh.name);
    await expect(page).toHaveURL(/\/en\/home$/);
    await expect(page.getByTestId('home-board')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('set-password-form')).toHaveCount(0);
    expect(sql(`select must_change_password from public.profiles where id = ${lit(people.fresh.id)};`)).toBe('t');
  } finally {
    await ctx.close();
  }
});

// Page walk (design §12): every nav link of the person, while viewing. A page that writes
// on load shows an error or the read-only message; the run's database log is searched
// for `read-only transaction` afterwards as well.
for (const key of ['emp', 'mgr', 'hr'] as const) {
  test(`page walk while viewing as ${key}: every nav page loads`, async ({ browser }) => {
    test.setTimeout(420_000);
    const p = people[key];
    const { ctx, page } = await adminContext(browser);
    try {
      await startView(page, p.name, p.name);
      const paths = [...new Set((await navSet(page)).map((s) => s.split(' ')[1]))];
      expect(paths.length).toBeGreaterThan(2);
      console.log(`page walk ${key}: ${paths.join(' ')}`);
      const failures: string[] = [];
      for (const pth of paths) {
        const res = await page.goto(`/en${pth === '/' ? '' : pth}`);
        await page.waitForLoadState('networkidle').catch(() => {});
        const status = res?.status() ?? 0;
        const body = await page.locator('body').innerText();
        const hit = PAGE_FAILURES.find((f) => body.includes(f));
        const strip = await page.getByTestId('view-as-bar').count();
        if (status >= 400 || hit || strip === 0) {
          failures.push(`${pth}: status ${status}${hit ? `, "${hit}"` : ''}${strip ? '' : ', no strip'} → ${page.url()}`);
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
