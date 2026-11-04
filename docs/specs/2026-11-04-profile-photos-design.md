# Profile photos (FR-82) — design

**Status:** DRAFT, awaiting owner review (2026-11-04). Not frozen until approved.
**Why:** HR wants faces next to names so they can tell apart people with similar names.

## 1. Decisions (owner, 2026-11-04)

| Topic | Decision |
|---|---|
| Who sets a photo | The employee (own photo, on Profile) **and** HR (`people` edit, `can_act_on`) + admin. |
| Lock | An HR/admin upload may be marked **locked**; the employee cannot change or remove a locked photo. HR can unlock. |
| Who sees | **Photo goes with name:** any active employee of the company may load any colleague's photo. Org chart and replacement picker already list every name company-wide. |
| Where shown | Manage › Employees (list + edit page) · Approvals cards + request detail · person pickers (replacement, approver candidates, manager/department-manager pickers) + org chart · own Profile + app header. |
| Capture | One by one: pick a file or take a photo (phones offer the camera from `accept="image/*"`), crop square, save. No bulk import. |
| Leavers | Photo kept after deactivation / separation (FR-54). HR may delete it by hand. |
| Audit | `audit_log` entry per set / remove / lock change (who, whose, when). No image copy in the log. |

## 2. Storage

No Supabase Storage service on this stack, so the photo lives in Postgres, the same way signatures
do (FR-52).

```sql
create table public.profile_photos (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  company_id  uuid not null,
  photo_data  text not null,            -- data:image/jpeg;base64,/9j/…
  locked      boolean not null default false,
  version     integer not null default 1, -- bumped on every change; cache key
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint profile_photos_shape check (
    length(photo_data) between 1000 and 80000          -- ≈ 60 KB decoded max
    and photo_data ~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$')
);
```

- JPEG, 256×256, quality ≈ 0.8 → 15–30 KB. JPEG, not WebP: Safari's canvas cannot encode WebP.
- ~300 staff × 25 KB ≈ 8 MB. Backups grow by that much; no other cost.
- RLS on, **no table grants** to `anon`/`authenticated`: every read and write goes through the
  functions below.

## 3. SQL surface

| Function | Who | Does |
|---|---|---|
| `app_profile_photo(p_employee uuid) → (photo_data text, version int)` | any active caller, same company | Read one photo. |
| `app_set_profile_photo(p_employee uuid, p_data text, p_locked boolean)` | self if not locked (lock arg ignored for self) · `people` edit + `can_act_on` · admin | Upsert, bump `version`. |
| `app_remove_profile_photo(p_employee uuid)` | same as set | Delete row. |
| `app_profile_photo_versions(p_ids uuid[]) → (employee_id, version)` | any active caller, same company | Lets lists know who has a photo and its cache key in one call. |

- Inactive callers refused (`private.is_active`). Cross-company → refused.
- CHECK errors re-raised by constraint name only (CLAUDE.md "secret columns vs CHECK errors"; not
  a secret, but avoids echoing 80 KB rows into the DB log).
- Trigger `private.audit_profile_photo()` writes `audit_log` (action `photo_set` / `photo_removed`
  / `photo_locked` / `photo_unlocked`, `after` = `{locked, version}`), modelled on
  `audit_user_signature`.
- No new permission key: reuses `people` edit. No enum, so one migration file.
- `lib/supabase/types.ts` hand-edited for the four functions.

## 4. Serving

Route handler `app/api/photo/[id]/route.ts`:

1. Server Supabase client (caller's session cookie) → `app_profile_photo(id)`.
2. No row or refused → `404` with `Cache-Control: private, max-age=300`.
3. Else decode base64 → bytes, `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`,
   `ETag: "<id>-<version>"`, and:
   - URL carries `?v=<version>` → `Cache-Control: private, max-age=31536000, immutable`;
   - no `v` → `private, max-age=300` (revalidate with the ETag, `304`).

Photos never ride in page payloads or the 60-second approver polls. Each avatar is one cached
image request; lists use `loading="lazy"`.

## 5. UI

- **`<PersonAvatar id name version? size />`** (`components/PersonAvatar.tsx`): always renders an
  initials circle (first letters of the Farsi name, colour from a hash of the id); lays the
  `<img>` over it on load, hides it on error. Sizes 24 / 32 / 40 / 96. Click on large sizes
  opens a bigger view (HR identification).
- **Profile › Photo card** (next to Saved signature): Upload / Take photo, crop, Save, Remove.
  When locked: shows the photo, "Set by HR", no buttons.
- **Manage › Employees › edit:** same card for HR plus a **Lock** switch. List rows: 32 px avatar.
- **Approvals, request detail, pickers, org chart, header:** avatar beside the existing name.
  List screens call `app_profile_photo_versions` once for the ids on screen (so known
  no-photo people make no request at all, and cache keys are exact).
- **Crop:** square crop with drag + zoom. Library choice in the plan (candidate `react-easy-crop`;
  check its API and bundle size via Context7 first) or a small in-house cropper.
- **Processing** `lib/photo/process.ts`: load file → apply EXIF orientation → crop → draw to a
  256×256 canvas → `toBlob('image/jpeg', 0.8)`, step quality down until ≤ 60 KB. Re-encoding
  through canvas **strips EXIF, including GPS location** from phone photos.
- Copy in `fa` + `en` (`profile.photo.*`, `manage.employees.photo.*`).
- Print form: no photo (out of scope).

## 6. Tests

- `tests/sql/profile-photos.sql`: self set/replace/remove; self blocked when locked; HR set + lock;
  HR on a person outside `can_act_on` refused; other company refused; inactive caller refused;
  bad data (PNG, oversize, junk) refused without echoing the row; audit rows written; cascade on
  profile delete; `authenticated` cannot select the table directly.
- Unit: `lib/photo/process.ts` (size cap, output shape), initials helper.
- Manual: temp `zz-` page for the avatar + card at 375 px and desktop; real phone camera upload.

## 7. Open questions

- None blocking. Possible later: bulk ZIP import by personnel number; photo on printed forms.
