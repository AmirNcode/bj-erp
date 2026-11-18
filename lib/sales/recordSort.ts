/** FR-94 §16.8: URL state of the sortable records table (pure). */

import type { RecordSort } from './types';

export const RECORD_SORTS: RecordSort[] = ['record_no', 'received_on', 'buyer', 'title', 'stage', 'owner', 'deadline', 'value'];
export const DEFAULT_RECORD_SORT = { sort: 'record_no' as RecordSort, dir: 'desc' as 'asc' | 'desc' };

/** Parses `sort` / `dir` from the URL; anything unknown falls back to the default. */
export function parseRecordSort(sort: string, dir: string): { sort: RecordSort; dir: 'asc' | 'desc' } {
  const known = RECORD_SORTS.includes(sort as RecordSort);
  if (!known) return DEFAULT_RECORD_SORT;
  return { sort: sort as RecordSort, dir: dir === 'desc' ? 'desc' : 'asc' };
}

/** What a header click asks for: the opposite direction on the active column, ascending (value: descending) on a new one. */
export function nextRecordSort(cur: { sort: RecordSort; dir: 'asc' | 'desc' }, key: RecordSort): { sort: RecordSort; dir: 'asc' | 'desc' } {
  if (cur.sort === key) return { sort: key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { sort: key, dir: key === 'value' ? 'desc' : 'asc' };
}
