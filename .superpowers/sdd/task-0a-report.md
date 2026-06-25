# Task 0a Report — Phase 0 Scaffold (no-backend slice)

**Date:** 2026-06-23  
**Branch:** feat/hr-timeoff-v1  
**Status:** DONE

---

## What was built

### Task 0.1 — Next.js + TS + Tailwind scaffold
- Scaffolded with `create-next-app@latest` into `/tmp/hr-scaffold`, then `rsync`-merged into the repo (preserving `CLAUDE.md`, `docs/`, `.claude/`, `.git/`, `.gitignore`).
- App Router, TypeScript strict mode, Tailwind v4, ESLint — clean build.
- `next-env.d.ts` excluded from git (already in `.gitignore`).

### Task 0.2 — Vitest + Playwright harness (TDD)
- Installed: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@playwright/test`.
- `vitest.config.ts`: jsdom env, `@` alias to repo root, `include: ['tests/unit/**']`.
- `playwright.config.ts`: `testDir: './tests/e2e'`, `webServer.command: 'npm run dev'`, `url: 'http://localhost:3000'`, `reuseExistingServer: !process.env.CI`.
- Scripts added: `"test:unit": "vitest run"`, `"test:e2e": "playwright test"`.

**TDD RED→GREEN evidence for smoke test:**

RED (before `lib/_smoke.ts` existed):
```
FAIL  tests/unit/smoke.test.ts
Error: Failed to resolve import "@/lib/_smoke" from "tests/unit/smoke.test.ts". Does the file exist?
Test Files  1 failed (1)  |  Tests  no tests
```

GREEN (after creating `lib/_smoke.ts`):
```
Test Files  1 passed (1)
Tests  1 passed (1)
Duration  552ms
```

### Task 0.4 — next-intl i18n + RTL shell

Confirmed current API via Context7 MCP (library `/amannn/next-intl`, 942 snippets, High reputation) before wiring.

Key decisions from docs:
- `defineRouting` in `i18n/routing.ts` with `localePrefix: 'as-needed'` (fa at `/`, en at `/en`).
- `localeDetection: false` — critical: without this, Playwright's `Accept-Language: en` header overrode the default locale, causing e2e failures. Disabling makes locale URL-only.
- `i18n/request.ts` — `getRequestConfig` reads matched locale from middleware, falls back to `fa`.
- `proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; omitting this caused a deprecation warning and build noise).
- `app/[locale]/layout.tsx` — renders `<html lang={locale} dir={rtl|ltr}>`, wraps in `NextIntlClientProvider`.
- `app/layout.tsx` — reduced to passthrough (locale layout owns the `<html>` shell).
- `messages/fa.json` = `{"app":{"title":"سامانه منابع انسانی"}}` and `messages/en.json` = `{"app":{"title":"HR System"}}`.
- Home page (`app/[locale]/page.tsx`) renders `t('app.title')`.

**e2e RTL result:**
```
✓ default locale is fa and RTL       (523ms)
✓ home page renders Farsi title      (521ms)
✓ manifest.webmanifest served 200    (288ms)
3 passed (2.8s)
```

### Task 0.5 — PWA manifest
- `app/manifest.ts` → Next.js serves at `/manifest.webmanifest`.
- `display: 'standalone'`, `dir: 'rtl'`, `lang: 'fa'`, `name: 'سامانه منابع انسانی'`.
- Placeholder 192×192 and 512×512 PNG icons in `public/icons/`.
- Supabase session persistence step skipped (no auth yet, per scope).

---

## Test results (final run)

```
# Unit
Test Files  1 passed (1)
Tests  1 passed (1)

# E2E
✓ default locale is fa and RTL
✓ home page renders Farsi title
✓ manifest.webmanifest served with 200
3 passed (2.8s)
```

---

## Commits

| SHA | Subject |
|-----|---------|
| `0e34dbf` | chore: scaffold Next.js + TS + Tailwind + Vitest harness |
| `3b706c1` | feat: i18n + RTL shell (fa default, next-intl App Router) |
| `af2e790` | feat: PWA manifest (display: standalone) |

---

## Files changed (all new unless noted)

```
app/[locale]/layout.tsx        — locale layout, <html lang dir>
app/[locale]/page.tsx          — home page with t('app.title')
app/layout.tsx                 — modified: passthrough only
app/manifest.ts                — PWA manifest
app/favicon.ico                — from scaffold
app/globals.css                — from scaffold
eslint.config.mjs              — from scaffold
i18n/request.ts                — next-intl getRequestConfig
i18n/routing.ts                — defineRouting (fa default, as-needed prefix)
lib/_smoke.ts                  — smoke test impl
messages/en.json               — {"app":{"title":"HR System"}}
messages/fa.json               — {"app":{"title":"سامانه منابع انسانی"}}
next.config.ts                 — modified: withNextIntl plugin
package.json                   — modified: test:unit + test:e2e scripts
package-lock.json              — lockfile
playwright.config.ts           — e2e config with webServer
postcss.config.mjs             — from scaffold
proxy.ts                       — next-intl middleware (Next.js 16 name)
public/icons/icon-192.png      — PWA icon placeholder
public/icons/icon-512.png      — PWA icon placeholder
public/{file,globe,next,vercel,window}.svg — from scaffold
tests/e2e/home.spec.ts         — RTL + Farsi title + manifest e2e tests
tests/unit/smoke.test.ts       — TDD smoke test
tsconfig.json                  — from scaffold
vitest.config.ts               — jsdom, @/ alias, unit glob
```

---

## Concerns

1. **Icon placeholders**: `public/icons/icon-192.png` and `icon-512.png` are 1×1 pixel solid-blue PNG placeholders generated by a Python script. They satisfy the manifest spec structurally but must be replaced with real branded icons before any production/demo deploy.

2. **Next.js 16 `proxy.ts` convention**: Next.js 16 renamed `middleware.ts` to `proxy.ts`. The current next-intl docs still show `middleware.ts` naming. Renaming was required to suppress the deprecation warning in build output.

3. **`localeDetection: false` side-effect**: With this off, a user's browser language preference is ignored entirely. Per the product spec ("Farsi-first, per-user preference toggle"), locale switching will be handled via an explicit UI toggle stored in a cookie/user profile — which is correct for this app. This is intentional, not a bug.

4. **Root layout passthrough**: `app/layout.tsx` renders `{children}` without an `<html>` wrapper. This is the pattern required when `[locale]/layout.tsx` owns the `<html>` shell — Next.js App Router supports this. However it's slightly unconventional and worth noting.

---

## Fix: generateStaticParams

**Diff:**
```diff
+export function generateStaticParams() {
+  return routing.locales.map((locale) => ({ locale }));
+}
+
 type Props = {
```

**Build result:**
```
✓ Compiled successfully in 1331ms
...
✓ Generating static pages using 6 workers (6/6) in 203ms
Route (app)
├ ● /[locale]
│ ├ /fa
│ └ /en
...
●  (SSG)     prerendered as static HTML (uses generateStaticParams)
```
No next-intl static rendering warning.

**E2E result:**
```
✓ 1 [chromium] › tests/e2e/home.spec.ts:14:5 › manifest.webmanifest served with 200 (496ms)
✓ 3 [chromium] › tests/e2e/home.spec.ts:9:5 › home page renders Farsi title (705ms)
✓ 2 [chromium] › tests/e2e/home.spec.ts:3:5 › default locale is fa and RTL (707ms)
3 passed (3.0s)
```
All home specs pass.
