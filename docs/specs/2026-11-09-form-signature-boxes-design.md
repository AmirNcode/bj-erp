# Form signature boxes from approval steps — design

**Date:** 2026-11-09 · **Status:** approved 2026-11-09 (box names editable later — added on request) · **FR:** FR-89

## Why

The printed request forms (FR-38) carry a fixed box set per paper form (requester · approver ·
security · admin office, etc.). Only the first `manager` step and the first `hr` step land in a box;
every other signed step (department manager, a named person such as Meysam Ayasi) falls into a
separate "Additional approvals" strip under the form. Security no longer signs, and the admin office
signature is now a named-person step. The admin wants the form's signature row to be exactly the
approval chain they configure, with box titles they write.

## Decisions (Amir)

1. **Every approval step is a signature box.** Manage › Approval steps defines the box list. Each
   step gets a **box name** typed by the admin, plus who signs it (role or specific person — the
   existing picker).
2. **Add approval step** dialog gains a **box name** field, then the person/role selection.
3. **Box content:** heading = the box name; under it the signer's name, the signature image and the
   signing time. No "Step N: …" line.
4. **Boxes never hide.** A box prints empty until signed (room for a wet signature).
5. A department-manager box whose step is **skipped** (dept manager is the direct manager or the
   requester) prints **"Not required" / «لازم نیست»**.
6. Daily leave with no replacement prints **"No replacement selected" / «جانشینی انتخاب نشده»** in
   the body's Replacement line (and in the Replacement box).
7. **Security** stops being a fixed box. **"Additional approvals"** strip is removed.
8. **Approval steps page layout:** Order / Active / Remove sit in fixed columns so they don't move
   with the length of the step's name.

## Claude's calls (check these)

- **Fixed boxes outside the step list:** `Requester` (always first) and, on the daily leave form
  only, `Replacement` (second). Their signatures come from the request itself / the replacement
  signing flow being built in parallel (separate worktree). They are not steps and aren't editable.
- **Order:** boxes print in step order after the fixed boxes, at most 4 per row, wrapping to a
  second row inside the same bordered block.
- **Per form kind:** a step's existing `applies_to` (leave / errand) decides which forms show its
  box. Inactive steps print no box.
- **Box name:** one free-text field (max 60 chars), required for new steps, printed as typed in both
  locales. Migration backfills current steps: direct manager → «تصویب کننده», department manager →
  «مدیر واحد», `hr` → «امور اداری و منابع انسانی», named person → «امور اداری». Admin can edit them
  inline on the page.
- **Old forms stay truthful:** the approval row snapshots the box name at signing
  (`leave_request_approvals.box_label`). A signed approval whose step was later removed or
  deactivated still prints, as an extra box at the end titled with its snapshot. Legacy approvals
  (pre-chain, no `step_id`) print in a box titled by their role label, as today.
- **Evidence lines stay:** delegated / automatic / HR-exempt statements still print under the
  signature inside the box (they are the legal record), just without the step-number heading.
- The body row "Administrative & HR Officer — balance remaining" on daily leave is not a signature
  box; unchanged.
- `lib/leave/paperForm.ts` keeps form title/code; the fixed per-form box list and
  `signatureSourceFor` are replaced by a pure `signatureBoxesFor(request, steps, approvals)` with unit
  tests.

## Non-goals

- Per-form-type box layouts (one step list drives all forms).
- Editing the requester/replacement boxes' titles.
- Replacement signing itself (separate worktree task).
