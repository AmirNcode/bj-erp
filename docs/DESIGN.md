# DESIGN — the "Blueprint" design system

Living document. The rules every screen follows. Chosen by the owner on 2026-11-09 from three
mockups; it replaced the rounded, boxed, shadowed look. Tokens live in `app/globals.css`;
this file says how to use them. When a rule here and the code disagree, fix one of them.

## Principles

1. **Square and flat.** Corners are 2-4px. No shadows. Structure comes from hairlines, tint
   bands and alignment, not from boxes inside boxes.
2. **One edge.** Title, filters and table on a page share the same start and end edges.
3. **Quiet colour.** Blue marks what is active or actionable. Status colours are for status only.
4. **Phones are one column.** No side-by-side content on a phone except a pair of equal buttons.
5. **Light only, Farsi first.** No dark mode. Every layout must work right-to-left.

## Tokens (`app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--primary` | `#2E3C92` (navy) | Buttons, links, active tab rule, table header text |
| `--sidebar` | `#20409a` (the logo's blue) | Desktop side panel and phone top bar only |
| `--secondary` | `#E7E9F6` tint | Table header band, tags, row hover, sub-tab fill |
| `--background` / `--card` | white | Page and panels |
| `--border` | `#E4E7EC` | Hairlines between rows, around cards |
| `--input` | `#C6CBD6` | Outline of inputs, selects, outline buttons |
| radius | `sm` 2px, `md`/`lg` 3px, `xl` 4px | Use `rounded-sm` / `rounded-md`; never `rounded-[Npx]` |

- `rounded-full` is for circles only (avatars, dots, progress bars). Never for a tag, tab or button.
- Do not add `shadow-*`. Popovers and dialogs may keep the one their primitive ships with.
- `--sidebar` and `--primary` are different blues on purpose: the side panel matches the logo
  so the logo's frame disappears into it; buttons stay navy.
- `dark:` utilities are disabled (`@custom-variant dark` is pinned to a `.dark` class that is
  never set). Do not rely on them.

## Logo

`public/bj-logo.png`. Its white areas are **transparent**, so on blue it needs a white plate:
`bg-[linear-gradient(white,white)] bg-[length:calc(100%-4px)_calc(100%-4px)] bg-center bg-no-repeat`
(inset 2px so the plate never shows past the frame's antialiased edge). The logo is always a
link to Home. Desktop: top of the side panel. Phone: end of the top bar (right in English,
left in Farsi).

## Shell

- **Desktop:** blue side panel (`MainNav`), no top header. Active item: faint white fill and a
  3px white rule on the panel's start edge.
- **Phone:** blue top bar (`MobileTopBar`: section name + logo) and a flat white bottom bar.
  Active tab: primary text and a 3px rule on top. No circles behind icons.
- The top bar names the section, so a top-level page passes `section` to `PageHeader`
  (title becomes screen-reader only on phones).
- `<main>` is `max-w-6xl`. A page with a wide data table puts `data-wide` on its root element
  and gets the full width. Never widen only the table.

## Tabs

Tabs are underlined text, never pills. Use `lib/ui/tabs.ts`:

- `tabListClass` + `tabClass(active)`: page-level tabs and list filters (Settings, Admin panel,
  Employees).
- `subTabListClass` + `subTabClass(active)`: a second level under tabs (a range picker).
- A segmented control is allowed only for choosing a **value** (permission level, list/month
  view), and it is square.

## Tables

**Every data table has `className="data-table …"`.** That class gives:

- a tinted header band with primary text (capitals and letter-spacing in English only: tracking
  breaks joined Persian script);
- **row highlight on hover. This is a rule: no table without it.** Do not add per-row
  `hover:bg-*` classes; the class does it.

Also:

- No card or border box around a table. Wrap it in `overflow-x-auto border-b border-border`.
- Rows are separated by `divide-y` hairlines. No zebra stripes.
- Numbers and money: `text-end tabular-nums` on **both** the header cell and the body cells.
- Cells do not wrap (`whitespace-nowrap`); the wrapper scrolls sideways if it must.
- Empty value: `—` in `text-muted-foreground`.
- Phones: a table with more than about four columns is replaced by stacked rows
  (`md:hidden` list + `hidden md:block` table), as on Employees and Finance.
- Print pages (`app/[locale]/(print)`) are exempt.

## Buttons and controls

- Variants: `default` (navy, the one main action on a page), `outline` (everything else),
  `ghost` (icon buttons in rows). Destructive actions: `outline` with `text-destructive`.
- Height: 36px (`h-9`) on desktop. On phones every button in a card or toolbar is 44px
  (`h-11`) and buttons that sit together are the **same size**.
- Phone: a page's main action is a full-width button above the filters. No floating buttons.
- Inputs, selects and date fields in one row share one height (`h-9`). Filters carry
  `aria-label`s or `sr-only` labels, not visible labels that push some controls lower.
- Native `<select>` uses `nativeSelectClass`; the chevron is drawn by `globals.css`, inset from
  the end edge, and flips in RTL.

## Figures, tags, status

- **Figures** (totals, counts): a label over a number with a 3px primary rule on the start
  edge (`border-s-[3px] border-primary ps-3`). Not a card per number.
- **Tags** (roles, kinds): `rounded-sm bg-secondary px-1.5 py-0.5 text-xs`.
- **Status:** `StatusBadge` / `STATUS_BADGE_STYLES`, square.

## Cards

Cards are for one self-contained item a person acts on (an approval, a request), not for
wrapping lists or tables. Pattern (`ApprovalQueue`, `ApprovalHistory`):

- Desktop: details at the start, primary decisions or status at the end, secondary actions in
  a footer row above a hairline.
- Phone: one centred column: avatar, name, details, then buttons. Two decisions share one
  line; the footer holds secondary actions at half width each.
- Never give free text to a `shrink-0` column: a long message will crush its neighbour.
  Warnings take a full-width line of their own.
- One action per outcome: do not show two buttons that end the same thing.

## Right-to-left

Use logical utilities only (`ms-`, `pe-`, `start-`, `border-s`, `text-end`). Farsi URLs have
no `/fa` prefix. Check every new screen in both languages.

## Not yet converted

Home, Reports, Calendar, request forms and the employee edit pages inherit the tokens
(corners, borders, no shadows) but still use their older card layouts. Convert them to these
rules when they are next touched.
