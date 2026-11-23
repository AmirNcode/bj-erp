/**
 * Delete / Archive dialog of a Sales record (admin only): the pure rules, kept apart from
 * the component so they can be unit-tested. Spec: docs/specs/2026-11-23-sales-record-delete-archive-design.md §4.2.
 */
import type { StageKind } from './types';

export type RemoveChoice = 'archive' | 'delete' | null;

/** Archive is not offered for a record that already sits in an Archived stage. */
export function archiveDisabled(stageKind: StageKind): boolean {
  return stageKind === 'archived';
}

/** Confirm needs a choice, and an archive choice cannot stand on an already archived record. */
export function canConfirm(choice: RemoveChoice, stageKind: StageKind): boolean {
  if (choice === null) return false;
  if (choice === 'archive') return !archiveDisabled(stageKind);
  return true;
}

export type RemoveCounts = { items: number; payments: number; files: number };

/** The red warning of the Delete choice: only the non-zero counts, none when everything is 0. */
export function countsParts(c: RemoveCounts): { key: keyof RemoveCounts; count: number }[] {
  return (['items', 'payments', 'files'] as const)
    .filter((key) => c[key] > 0)
    .map((key) => ({ key, count: c[key] }));
}
