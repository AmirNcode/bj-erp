# UI readability and desktop layout — design

Date: 2026-11-23 · Status: draft for owner review · Branch: `claude/ui-readability-layout` (from `origin/main` 1ca84ef)

Three parts, built in this order: **1. no iPhone zoom on fields → 2. text size preference → 3. desktop page layout.**
Part 2 changes font tokens that parts 1 and 3 rely on, so the order matters.

---

## Why

- **Zoom.** iPhone Safari zooms the page in when a field with text under 16px gets focus. Staff saw it on the
  login code and the employee search. The page then stays zoomed and they pinch back out. Owner rule from now on:
  **no field may trigger the iPhone zoom.**
- **Text size.** Text is small in places, worst on phones in Farsi (Vazirmatn reads smaller than Rubik at the same
  pixel size). Each person picks a size that suits their eyes and device.
- **Layout.** On a 1920px monitor the pages with top tabs run the header and tab line edge to edge while the
  content sits at 500–1000px on the start side. The other half of the screen is empty (left in Farsi, right in
  English). An earlier attempt stretched forms full width and single inputs became absurdly wide; the current
  state is the rollback. Owner wants one consistent look across tabbed pages that uses the width sensibly.

## Goals

1. No input, select, textarea or date field triggers the iPhone zoom, on any page, portrait or landscape, phone or iPad.
2. A text size setting in Profile › **Preferences**, saved to the person's profile, following them to every device.
3. Tabbed and form pages share one centred column; forms use "annotated sections"; tables fit the column.

## Non-goals

- No dark mode, no theme or colour changes.
- No change to page content, fields or behaviour beyond the moves listed here.
- Print layouts (`(print)` routes, credential slips) are untouched and do not scale with the text size.

## Anti-goals (would be a failure even if it "works")

- Blocking pinch-zoom (`maximum-scale=1` / `user-scalable=no`). It stops the focus zoom but takes zoom away
  from people who need it on Android.
- A text size that also blows up spacing, buttons and layout (browser-zoom style). Owner chose **text only**.
- Fields stretched to the width of their container on desktop.
- A tab line that runs wider or narrower than the content under it.

---

## Part 1 — no iPhone zoom on fields

### Approaches

| | Approach | Trade-off | |
|---|---|---|---|
| a | One global CSS rule: on touch screens every field is ≥ 16px | One place, covers new fields automatically; a field styled larger on purpose is lowered to the base size on touch screens | **chosen** |
| b | `maximum-scale=1` in the viewport | Simplest; blocks pinch-zoom on Android | rejected (anti-goal) |
| c | Fix each field's classes | Today's state already does this for most fields (`text-base md:text-sm`); fails on landscape/iPad (≥ 768px gets 14px) and on every new field someone forgets | rejected |

### Design

- **Cause today:** the shared `Input`, `Textarea`, `nativeSelectClass` and the employee search use
  `text-base md:text-sm`, so they drop to 14px at ≥ 768px — a large iPhone in landscape, or an iPad. A few fields
  are small everywhere (e.g. `settings/WorkSettingsForm.tsx` select `text-[13px]`, time inputs `text-sm`).
- **Rule** in `app/globals.css`, **unlayered** so it beats Tailwind utilities:
  `@media (pointer: coarse)` → `input` (except checkbox, radio, range, file, color, hidden), `select`, `textarea`
  get `font-size: max(16px, var(--text-base))`. With Part 2, `--text-base` is already scaled, so a larger text
  size still wins.
- Covers `react-multi-date-picker` (`PersianDateField`) and the search boxes inside combobox popovers, since they
  render plain `<input>` elements.
- Desktop (fine pointer) keeps today's sizes.
- **Guards:**
  - Unit test: `globals.css` contains the coarse-pointer field rule (a deleted rule fails CI).
  - e2e on a touch phone profile (Playwright iPhone descriptor, `hasTouch`): computed `font-size ≥ 16px` on the
    login code field, Employees search, a native select and a date field, in portrait and landscape.
  - `docs/DESIGN.md` rule + one CLAUDE.md gotcha line: *fields must never be under 16px on touch screens; the
    global rule handles it — never add `maximum-scale`.*

---

## Part 2 — text size preference

### Approaches

| | Approach | Trade-off | |
|---|---|---|---|
| a | Scale Tailwind's text tokens by a CSS variable set on `<html>` from the profile | Text only, layout stays put; needs the 87 hard-coded `text-[Npx]` sizes moved onto tokens | **chosen** |
| b | Change the root font size (all `rem` grows) | No conversion work; scales spacing and controls too, like browser zoom — owner chose text only | rejected |
| c | Save per device (localStorage) | No migration; owner wants it saved to the profile | rejected |

### Scale (owner decisions)

- **5 steps**, shown to everyone as **100% · 110% · 120% · 130% · 140%**.
- ~~**Farsi starts one step higher**~~ — **Changed 2026-11-23 round 2: same scale for both languages (1.00 · 1.10 · 1.20 · 1.30 · 1.40), Farsi 100% is the original size.** Original wording: the real multiplier is English `1.00 · 1.10 · 1.20 · 1.30 · 1.40`,
  Farsi `1.10 · 1.20 · 1.30 · 1.40 · 1.50`. Farsi "100%" = English "110%". The label never shows the hidden step.
- One saved step per person (not one per language); switching language switches the multiplier table.
- Default step 0 (= 100%). People who never sign in (login, forgot password) get step 0 for the page's locale,
  so the Farsi login page is already one step larger than today.

### Data

- New column `profiles.font_step smallint not null default 0`, CHECK `0..4`. Migration in `supabase/migrations/`,
  `schema.sql` updated, `lib/supabase/types.ts` hand-edited.
- Saved by the person themself the same way as `language_pref` (`lib/actions/profile.ts` own-profile update):
  add `font_step` to the columns a person may change on their own row in `enforce_profile_update_scope`.
- Not an admin field; not on the Edit Employee form; not in imports.

### Applying it

- `app/[locale]/layout.tsx` reads the signed-in person's `font_step` and sets `--font-scale` on `<html>`
  (inline style), from the locale's multiplier table. No flash on load: it is server-rendered.
- **View as** shows the admin's own text size, not the viewed person's: read it with `createRealClient()`.
- In `globals.css`, the Tailwind text tokens become `calc(<base> * var(--font-scale, 1))`
  (`--text-xs … --text-4xl`). Line heights in Tailwind v4 are ratios and scale with them; verify the exact
  `@theme` syntax against current Tailwind v4 docs (Context7) before writing it.
- Hand-written `rem` font sizes in `globals.css` (`.data-table`, `.help-guide`, badges …) multiply by
  `var(--font-scale, 1)` the same way.
- **Conversion:** the 87 `text-[Npx]` classes in `app/` and `components/` move onto tokens. Sizes with no matching
  token get two new tokens (`--text-2xs` ≈ 10px, `--text-xxs` ≈ 11px, scaled the same way) rather than one-off
  values. A unit test fails on any new `text-[…px]` in `app/` or `components/`.
- `(print)` routes set `--font-scale: 1`.
- **What does not scale:** spacing, icon sizes, button heights, the sidebar width. Long labels must wrap or
  truncate, not overflow: check the side panel, bottom tab bar, tab strips, table headers and status badges at
  Farsi 140% (multiplier 1.50) on a 375px phone and at 1920px.

### Profile tabs (owner decisions)

Tabs become **Profile · Personal info · Preferences · Account security**. The "Account" tab goes away.

- **Preferences** (`/profile/preferences`):
  - **Language** — the existing `LanguageSwitch`, with no "Preferences" card title above it (the tab already says it).
  - **Text size** — a 5-stop slider (native `<input type="range">`, stops labelled 100–140%,
    `aria-valuetext` "120%"), a sample block rendered at the chosen size live, and a **Save** button. The rest of
    the page keeps the saved size until Save; Save stores `font_step`, then refreshes so the whole app uses it.
    The sample text is a short realistic line in the current language (e.g. a leave request summary + a balance
    line), so people judge real UI text.
- **Account security** (`/profile/security`): **Change password** card, then **Log out**.
- `/profile/account` redirects to `/profile/preferences` (old links and bookmarks keep working).
- e2e specs that open `/profile/account` (6 references) move to the new tabs.

---

## Part 3 — desktop page layout ("B: annotated sections")

### Approaches

Mockups shown in the browser on 2026-11-23, drawn at 1920px.

| | Approach | Trade-off | |
|---|---|---|---|
| A | Centred 1280px column; form sections as cards side by side | Fills the column; two unrelated sections read as one block, and a one-section page leaves a gap | |
| B | Centred 1280px column; **annotated sections**: section title + explanation at the start, fields card beside it | Reads top to bottom, help text stops crowding fields, works with any number of sections (Shopify Polaris, Stripe, GitHub settings) | **chosen by owner** |
| C | Full width everywhere; cards flow into columns | Fills any screen; rows of text span ~1700px, short pages still leave empty columns | |

### Page frame

- Target screen: **1920px** desktop. Phones unchanged apart from the stacking rules below.
- `AppShell` `<main>`: one centred column, **max 1280px** (`max-w-7xl`), on every page. Header, tabs and content
  all sit inside it, so the tab line always ends where the content ends. Equal margins both sides on wide screens.
- **`data-wide` is kept only for the big tables:** Employees list, Sales records list, Finance. On those, the
  header and tabs widen with the table (they are inside the same root). Remove `data-wide` from the tabbed pages
  that have it today: Settings (+ roles pages), Profile, Admin panel, Edit Employee.
- Page-level `max-w-[900px]` / `max-w-[1000px]` / `max-w-5xl` wrappers on tabbed pages go; the column is the shell's.

### Annotated section (new shared component)

- `components/FormSection.tsx`: `title`, optional `description`, `children` (the fields card).
- **≥ 1024px (`lg`)**: two columns — start column ~20rem (title, description, optional help link), end column
  the card. Sections stack with a divider between them. In RTL the title sits on the right automatically
  (logical properties only).
- **< 1024px**: title and description above the card, full width — what phones see today.
- One **Save** bar per form, at the bottom, aligned to the end of the card column (keeps "Last saved …").

### Field widths (no stretched inputs)

Inside the card, fields sit in a wrapping grid of fixed widths, never `w-full` on desktop:

| Field | Width on desktop |
|---|---|
| Time | 9rem |
| Number / minutes | 8rem |
| Date | 12rem |
| Day + hour pair | 18rem |
| Short select (weekday, gender, status) | 14rem |
| Name, person picker, job title | 20rem |
| Long text / notes | up to 36rem |

On phones every field is full width, as today. These replace the width guidance currently in `docs/DESIGN.md`.

### Which pages get what

- **Annotated sections** (settings-style forms with several sections): Settings › Working times, Settings › Roles
  (Approval delegates, CEO and Head of HR), Admin › SMS settings, Admin › System, Edit Employee (all three tabs),
  Profile › Personal info, Profile › Preferences, Profile › Account security, Manage › Approval steps,
  role editor (`settings/roles/[id]`, `new`).
- **Inline add-row + list in the column** (unchanged structure, new width): Settings › Official holidays.
- **Tables and logs in the column**: Admin › Audit log, Sign-ins, SMS log, Approvals, Reports, Approved absences,
  Procurement lists, Sales sub-pages other than the records list.
- **Dashboards** (Admin › Overview, Home): card grid filling the column, as today.
- **Single-purpose forms** (Request forms, login, forgot password): unchanged, narrow centred.
- *As built:* Admin › System kept its status cards (read-only, not a form); the role editor's name stays a plain field (its permission sections are collapsible cards).

### Docs

- `docs/DESIGN.md`: replace the "Use the full shell width … `data-wide`" paragraph with the frame, annotated
  section and field-width rules above; add the 16px field rule (Part 1) and the "no `text-[Npx]`" rule (Part 2).
- CLAUDE.md: update the "Full-width page = `data-wide`" gotcha to "only the big tables", add the 16px field line.

---

## Calls made by the designer (owner: please check)

1. Text size is **one step per person**. *(Changed 2026-11-23 round 2: no Farsi bonus step; same scale for both languages.)*
2. **View as** keeps the admin's own text size.
3. Login and forgot-password pages use step 0 (*changed round 2: no Farsi step*).
4. Print pages never scale.
5. Two new small text tokens (≈10px, ≈11px) instead of keeping one-off pixel sizes.
6. Column max width **1280px**; annotated sections switch to two columns at **1024px**.
7. Full-width (`data-wide`) stays for **Employees list, Sales records list, Finance** only.
8. `/profile/account` redirects to Preferences.
9. On touch screens a field styled larger than base text is lowered to base size (none known today).

## Left to the builder

- Exact Tailwind v4 `@theme` syntax for scaled tokens (verify in docs) and the token for each converted
  `text-[Npx]`.
- Sample text wording (fa + en) for the Preferences preview.
- Per-page migration order for Part 3 and any page not named above (follow the closest named page).
- e2e/unit updates for moved tabs and changed widths.
- AGENT-LOG, CHANGELOG, TASKS, FR number in `docs/REQUIREMENTS.md`.
