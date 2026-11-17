/** FR-94 stage helpers. Pure; the database enforces the rules (app_sales_move_stage). */

import type { Person, Stage } from './types';

/** Active stages of a flow, in order. */
export function flowStages(stages: Stage[], flowId: string): Stage[] {
  return stages.filter((s) => s.flow_id === flowId && s.active).sort((a, b) => a.position - b.position);
}

/**
 * The stage a record normally moves to next: the next active open stage, skipping
 * a pricing stage when the record needs no quote. Null at the end of the flow.
 */
export function defaultNextStage(stages: Stage[], currentId: string, needsQuote: boolean): Stage | null {
  const current = stages.find((s) => s.id === currentId);
  if (!current) return null;
  return (
    flowStages(stages, current.flow_id).find(
      (s) => s.position > current.position && s.kind === 'open' && (needsQuote || s.action !== 'quote')
    ) ?? null
  );
}

/** Who to suggest as the next owner: the first holder of the stage's owner role. */
export function defaultOwner(stage: Stage | null, people: Person[]): string | null {
  if (!stage?.owner_role_id) return null;
  return people.find((p) => p.role_ids.includes(stage.owner_role_id!))?.id ?? null;
}
