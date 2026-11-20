/** FR-94 record files: which flows a record's files span, and the groups the Files tab shows. Pure. */

import type { EventRow, Flow, RecordRow, SalesFile, Stage } from './types';

export const MAX_UPLOAD_BYTES = 52_428_800;

/** The record's current flow, plus the flow of every stage in its stage events and of every file. */
export function recordFlowIds(record: RecordRow, events: EventRow[], files: SalesFile[], stages: Stage[]): string[] {
  const flowOf = new Map(stages.map((s) => [s.id, s.flow_id]));
  const out = new Set<string>([record.flow_id]);
  const add = (stageId: unknown) => {
    const flow = typeof stageId === 'string' ? flowOf.get(stageId) : undefined;
    if (flow) out.add(flow);
  };
  for (const e of events) {
    if (e.kind !== 'stage') continue;
    add(e.body.from);
    add(e.body.to);
  }
  for (const f of files) add(f.stage_id);
  return [...out];
}

/** Every stage of the given flows (bid first, then contract; by position) with its files; unknown stages go to `stage: null`. */
export function groupFilesByStage(
  files: SalesFile[], stages: Stage[], flowIds: string[], flows: Flow[],
): { stage: Stage | null; files: SalesFile[] }[] {
  const kindRank = (flowId: string) => (flows.find((f) => f.id === flowId)?.kind === 'bid' ? 0 : 1);
  const ordered = stages
    .filter((s) => flowIds.includes(s.flow_id))
    .sort((a, b) => kindRank(a.flow_id) - kindRank(b.flow_id) || (a.flow_id < b.flow_id ? -1 : a.flow_id > b.flow_id ? 1 : 0) || a.position - b.position);
  const known = new Set(ordered.map((s) => s.id));
  const groups: { stage: Stage | null; files: SalesFile[] }[] = ordered.map((s) => ({ stage: s, files: files.filter((f) => f.stage_id === s.id) }));
  const other = files.filter((f) => !known.has(f.stage_id));
  if (other.length > 0) groups.push({ stage: null, files: other });
  return groups;
}

/** Size as a number and a unit (B / KB / MB); the caller formats the number for its locale. */
export function formatFileSize(bytes: number): { value: number; unit: 'B' | 'KB' | 'MB' } {
  if (bytes < 1024) return { value: bytes, unit: 'B' };
  if (bytes < 1024 * 1024) return { value: Math.round((bytes / 1024) * 10) / 10, unit: 'KB' };
  return { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: 'MB' };
}
