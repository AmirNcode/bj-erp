# Design sync notes (Claude Design project "Behsazan Jonoob DS")

## How this repo is synced

- The repo is a Next.js app, not a published package: no `dist/`, no Storybook, no `.d.ts` tree. The sync runs in package shape against a hand-written entry, `.design-sync/entry.ts`, which re-exports the reusable components plus `BjProvider`, `Icons`, `cn`, `toast` and `nativeSelectClass`.
- `buildCmd` (run before the converter, on every sync) does three things:
  1. Tailwind v4 CLI compiles `.design-sync/tailwind.css` → `.design-sync/.cache/bj.css` (= `cssEntry`). That input imports `app/globals.css`, adds `@source` for app/components/lib/previews, and adds an `@source inline(...)` safelist of token utilities so designs can use classes the app itself doesn't.
  2. `tsc -p .design-sync/tsconfig.dts.json` emits declarations to `build/ts/`.
  3. It writes `build/ts/index.d.ts` re-exporting the entry.
- Fork `.design-sync/overrides/dts.mjs`: when the package has no types entry, it falls back to `<typesRoot>/index.d.ts` (`build/ts`). It imports ts-morph by relative path (`../../.ds-sync/node_modules/ts-morph/...`). Do NOT recreate the `.design-sync/node_modules` symlink: it gives `entry.ts`/`provider.tsx` a second `@types/react` and `tsc` fails (sonner CSSProperties error).
- `tsconfig.dts.json` needs `"exclude": []`. The root `tsconfig.json` excludes `.design-sync`, `.ds-sync`, `ds-bundle` and `build`, so `next build`/CI never type-check the previews (they import `'bj-erp'`, which only resolves in the converter). Without that override, `entry.ts` would be excluded too.
- `eslint.config.mjs` and `.dockerignore` ignore the same folders.
- Groups come from category stubs in `.design-sync/groups/*.md` via `docsMap`. `PageHeader` is `componentSrcMap: true` (no pinned path). Its real path `app/[locale]/(app)/_components` would force the group "components".
- `guidelinesGlob` points at a non-existent dir ON PURPOSE. The default glob copied `docs/*.md` (deploy runbook with the server IP, agent log, tasks) into `guidelines/`. Never let project docs upload.
- Brand colour tokens: Claude Design's token index only lists literal `--color-*` variables. The app's colours live in `--primary` etc., mapped with `@theme inline`, so the panel showed Tailwind leftovers (black, red-50, oranges) instead of the brand. `buildCmd` runs `.design-sync/gen-brand-tokens.mjs`, which writes `.design-sync/.cache/brand-tokens.css` (literal `--color-<name>` for every `:root` colour in `app/globals.css`, var() refs resolved). `tailwind.css` imports it. Rendering is unchanged: the utilities still use `var(--primary)`.
- Fonts: `.design-sync/fonts.css` declares Rubik + Vazirmatn from `app/fonts/`. `tailwind.css` maps `--font-rubik`/`--font-vazirmatn` (set by next/font in the app) to those families.
- `BjProvider` (`.design-sync/provider.tsx`) mirrors `app/[locale]/layout.tsx`: Radix `Direction.Provider` + `NextIntlClientProvider` (only the `personSearch` messages) + a `dir`/`lang`/`font-sans` wrapper. It also sets `dir`/`lang` on `<html>`. Without that, portalled Dialog/AlertDialog render LTR.
- `dtsPropsFor` hand-writes PersonSearch, StatusBadge, TriStateToggle and Toaster, because their extracted bodies referenced types that weren't emitted (`PersonSearchOption`, `Labels`, `TriValue`, sonner `ToastOptions`).
- Playwright 1.61.1 + chromium-headless-shell 1228 are installed in `.ds-sync` (same build as the repo's `@playwright/test`).

## Excluded components (app-coupled)

RequestProgress, PersonalInfoForm (server actions), CredentialsDownload, TravelItinerary (feature-specific, next-intl + lib types), PersianDateField / LazyDatePicker (`next/dynamic`), MainNav and the banners (next/navigation, server actions). The design agent should compose these from primitives.

## Known render warns

- `[RENDER_THIN]` Toaster: rendered height 0px. Toasts are `position: fixed`, so the measured root is empty. The screenshot shows three toasts correctly. Benign.
- Toasts render in the system font, not Vazirmatn: sonner's own CSS sets `font-family` on `[data-sonner-toaster]`. The live app does the same. That's an app issue, not a sync issue.

## Not statically renderable

- PersonSearch suggestion list: the preview types «محمد» on mount via the native value setter + input event, so the list shows. Hover states and the auto-pick delay are not shown.

## Re-sync risks

- The `@source inline` safelist in `tailwind.css` defines which classes designs can use. A new token in `app/globals.css` needs adding there too, or designs can't use its utilities.
- `.design-sync/icons.ts` is a hand-picked lucide list (the app's icons as of 2026-10-30, plus extras). New icons in the app aren't picked up automatically.
- `provider.tsx` duplicates the layout's provider chain. If `app/[locale]/layout.tsx` adds a provider, mirror it here.
- `dtsPropsFor` bodies are hand-written. If PersonSearch/StatusBadge/TriStateToggle props change, update them.
- The entry exports specific files. A new reusable component in `components/` must be added to `entry.ts` + `componentSrcMap` + a group in `docsMap`.
- The build assumes Tailwind 4.3.3 (CLI pinned in `.ds-sync`, matching the repo) and TypeScript from the repo's `node_modules`.
