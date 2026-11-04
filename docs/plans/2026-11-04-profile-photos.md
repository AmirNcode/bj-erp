# Plan — Profile photos (FR-82)

Spec: `docs/specs/2026-11-04-profile-photos-design.md` (approved 2026-11-04).
Branch: `claude/profile-photos-spec` (rename on first code commit if wanted).
Each step ends green: `npx tsc --noEmit` · `npm run lint` · `npm run test:unit`.

## 1. Database

1. `supabase/migrations/20261105120000_profile_photos.sql` (one file, no enum):
   - table `public.profile_photos` (spec §2), RLS on, `revoke all` from `anon`, `authenticated`.
   - `private.photo_can_write(caller, target)` → self and not locked · `people` edit +
     `private.can_act_on` · admin. Caller must be `private.is_active`, same company.
   - `public.app_profile_photo(uuid)`, `app_profile_photo_versions(uuid[])` — SECURITY DEFINER,
     STABLE, same-company + active caller. Alias any `unnest` column (CLAUDE.md scoping trap).
   - `public.app_set_profile_photo(uuid, text, boolean)`, `app_remove_profile_photo(uuid)` —
     SECURITY DEFINER; self cannot change `locked`; on insert/update bump `version`, set
     `updated_by`. Catch `check_violation` → re-raise `photo data is invalid` (22023), no DETAIL.
   - trigger `private.audit_profile_photo()` → `audit_log` (`photo_set` / `photo_removed` /
     `photo_locked` / `photo_unlocked`; `after` = `{locked, version}`, never `photo_data`).
   - `grant execute` on the four app functions to `authenticated` only; `revoke` from `public`, `anon`.
   - No lock-order risk: no `profiles` / `leave_requests` writes, no advisory locks.
2. `tests/sql/profile-photos.sql` — cases in spec §6.
3. Dry run on a clone (CLAUDE.md "Dry-run migrations first"), then `./deploy/bj-deploy update local`,
   restart `bj-erp-rest-1`, `npm run schema:dump`. Commit migration + `schema.sql` together.
4. `lib/supabase/types.ts` — hand-add table + four functions.

## 2. Client image pipeline

1. `npm i react-easy-crop@^6.2.4`; `npm audit --omit=dev` clean.
2. `lib/photo/process.ts` — `cropToJpeg(img, areaPx)`: 256×256 canvas, `toBlob('image/jpeg')`,
   quality 0.85 → 0.5 in steps until ≤ 60 KB; returns data URL. `fileToObjectUrl` with a type/size
   guard (≤ 15 MB, `image/*`). Browsers apply EXIF orientation to `<img>` by default; confirm on
   an iPhone photo.
3. `lib/photo/initials.ts` — Persian/English initials + colour from id hash.
4. `tests/unit/photo-*.test.ts`.

## 3. Server side

1. `lib/actions/photo.ts` — `setProfilePhoto`, `removeProfilePhoto`, `getPhotoVersions`; each
   starts `requireCaller()`; `revalidatePath` for profile and the employee edit page.
2. `app/api/photo/[id]/route.ts` — spec §4. `proxy.ts` skips `/api`, so no session refresh here:
   an expired token gets 404 → initials (fine; the next page load refreshes the session).
   Validate `id` as uuid before calling the RPC.

## 4. Components

1. `components/PersonAvatar.tsx` — spec §5; `dir`-safe; `alt` = name.
2. `components/profile-photo/ProfilePhotoCard.tsx` (`'use client'`) — props
   `{ employeeId, name, initial: {version, locked} | null, mode: 'self' | 'hr' }`.
   File input `accept="image/*"` → `CropDialog` (dynamic `import('react-easy-crop')`, round
   1:1, zoom slider) → `cropToJpeg` → action. `hr` mode adds the Lock switch. Texts via
   `useTranslations('profile.photo')`.
3. `messages/fa.json` + `en.json` — `profile.photo.*` (title, change, remove, confirmRemove,
   lockedByHr, lock, lockHint, crop, zoom, save, cancel, tooLarge, notImage, failed).

## 5. Placement

1. `profile/page.tsx` — card between the info card and the Org chart link.
2. `manage/employees/[id]/page.tsx` — card under `PageHeader` when the caller may write
   (self → `mode='self'`).
3. Avatars (32 px unless noted), batching `getPhotoVersions` per screen:
   Manage › Employees table · Approvals cards · request detail (40 px) · replacement picker ·
   approver-candidate search · manager / department-manager selects · org chart nodes ·
   `AppShell` header (24 px, own photo, links to Profile).

## 6. Docs and checks

- `docs/REQUIREMENTS.md` FR-82 · `DATA_MODEL.md` (table) · `PERMISSIONS.md` (who reads/writes) ·
  `CHANGELOG.md` · `TASKS.md` (owner post-deploy check) · `AGENT-LOG.md`.
- `npm run build`. Temp `app/[locale]/zz-photo` page: card + avatars at 375 px and desktop, RTL
  and LTR; delete it and `rm -rf .next/dev/types`.
- Optional e2e `tests/e2e/profile-photo.spec.ts` with a `999…` user: upload, lock as HR, self
  blocked.

## Post-deploy (owner)

- Upload your own photo on a phone (camera + gallery). As HR, set and lock one employee's photo;
  confirm the employee sees "Set by HR" and no buttons.
