# Behsazan Jonoob (BJ) — building with this design system

HR / ERP web app for an Iranian manufacturer. **Farsi first, right-to-left, mobile first.** Every component is the app's real code, loaded at `window.BJ`.

## Setup: always wrap in `BjProvider`

```jsx
const { BjProvider, Button } = window.BJ;
<BjProvider>{/* whole screen */}</BjProvider>      // Farsi, RTL (default)
<BjProvider locale="en">…</BjProvider>             // English, LTR
```

`BjProvider` sets `dir`/`lang` on `<html>` (portalled Dialog/AlertDialog/Toaster need that), sets up the Radix direction, the brand font (`font-sans` = Rubik + Vazirmatn) and the i18n context `PersonSearch` reads. Without it, overlays render LTR, the font falls back, and `PersonSearch` throws.

## RTL and Farsi rules

- Use logical utilities only: `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`, `text-start`/`text-end`, `border-s`/`border-e`. Never `ml/mr/pl/pr/left/right`.
- Write UI copy in Farsi with Persian digits (۱۲۳). Dates are Jalali `YYYY/MM/DD`; wrap each in `<bdi>` inside a sentence: `<bdi>۱۴۰۵/۰۸/۱۲</bdi> تا <bdi>۱۴۰۵/۰۸/۱۴</bdi>`.
- Phone numbers, national IDs and other Latin data fields: `<Input dir="ltr" />`.

## Styling: Tailwind utilities on semantic tokens

Style your own layout with Tailwind classes that use the tokens below. Don't use hex colours or inline colour styles. Only classes compiled into `_ds_bundle.css` exist, and arbitrary values (`w-[13px]`) usually don't.

| Role | Classes |
|---|---|
| Page / surfaces | `bg-background` (page #F2F4F8), `bg-card` (white), `bg-popover`, `bg-muted` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary` |
| Brand | `bg-primary text-primary-foreground` (royal blue #2E3C92), `bg-secondary text-secondary-foreground` (blue tint), `bg-accent text-accent-foreground` |
| Status | success: `bg-success-foreground text-success` · warning: `bg-warning-foreground text-warning` · danger: `bg-destructive/10 text-destructive` |
| Lines | `border` (token colour by default), `border-input`, `ring-ring`, `divide-y` |
| Shape | `rounded-md` (controls), `rounded-xl` (cards, sections), `rounded-full` (pills), `shadow-xs`/`shadow-sm` |
| Type | `text-xs`…`text-2xl`, `font-medium`/`font-semibold`/`font-bold` |

Gotcha: `success-foreground` / `warning-foreground` are the **pale backgrounds**. The strong colour is `success` / `warning`.

Page frame used by the app: `<main className="mx-auto w-full max-w-2xl space-y-4 p-4">`. Use `max-w-6xl md:px-8` for wide desktop screens.

## Building blocks

- Status pills: use `StatusBadge` (pending / approved / rejected / cancelled / awaitingTravel) instead of colouring `Badge` yourself.
- Icons: `Icons.<Name>` (lucide), sized with `className="size-4"`, e.g. `Icons.Plus`, `Icons.Check`, `Icons.CalendarDays`, `Icons.Clock`, `Icons.Users`, `Icons.Plane`, `Icons.Trash2`, `Icons.Search`, `Icons.Settings`, `Icons.ChevronLeft`. The forward arrow in RTL is `Icons.ArrowLeft`.
- Native `<select>`: `className={nativeSelectClass}`. The app uses native selects and has no Select component.
- Toasts: render `<Toaster />` once, then call `toast.success('…')` / `toast.error('…')`.
- Loading: `CardSkeleton`, `ListSkeleton`, `BoardSkeleton`, `FormSkeleton`. Empty lists: `EmptyState`.
- Merge classes with `cn(...)`.

## Where the truth lives

`styles.css` → `_ds_bundle.css` (brand tokens in its `:root`), and each `components/<group>/<Name>/<Name>.prompt.md` for props and Farsi examples.

## Example

```jsx
const { BjProvider, PageHeader, Button, Card, CardHeader, CardTitle, CardDescription, CardContent, StatusBadge, Icons } = window.BJ;
const labels = { pending: 'در انتظار تأیید', approved: 'تأیید شده', rejected: 'رد شده', cancelled: 'لغو شده' };

<BjProvider>
  <main className="mx-auto w-full max-w-2xl space-y-4 p-4">
    <PageHeader title="درخواست‌های من" action={<Button><Icons.Plus /> درخواست جدید</Button>} />
    <Card>
      <CardHeader>
        <CardTitle>مرخصی استحقاقی</CardTitle>
        <CardDescription><bdi>۱۴۰۵/۰۸/۱۲</bdi> تا <bdi>۱۴۰۵/۰۸/۱۴</bdi> · ۳ روز</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">مدیر مستقیم</span>
        <StatusBadge status="pending" labels={labels} />
      </CardContent>
    </Card>
  </main>
</BjProvider>
```
