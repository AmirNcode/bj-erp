/**
 * FR-94 items tree (the record's dash numbers: 8997-1, 8997-1-3, …). Pure.
 * The database owns numbering; this only shapes rows for the table.
 */

import type { NodeRow } from './types';

export type TreeNode = NodeRow & { children: TreeNode[] };

/** Built-in item columns; description is always shown and is not in this list. */
export const BUILTIN_COLUMNS = ['product_type', 'size', 'rating', 'qty', 'unit'] as const;
export type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number];

export function isBuiltinColumn(key: string): key is BuiltinColumn {
  return (BUILTIN_COLUMNS as readonly string[]).includes(key);
}

/** Flat rows → nested, siblings in dash-number order. Orphans are dropped. */
export function buildTree(nodes: NodeRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id === null) roots.push(node);
    else byId.get(node.parent_id)?.children.push(node);
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.seq - b.seq);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Ids from the root down to `id` (inclusive); empty when unknown. */
export function pathTo(nodes: NodeRow[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  let current = byId.get(id);
  while (current) {
    path.unshift(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

/**
 * Column keys shown at a tree depth (1 = items). A depth with no setting of its
 * own uses the nearest shallower one that is deeper than 1; otherwise items get
 * the built-ins and parts get quantity and unit.
 */
export function columnsForDepth(itemColumns: Record<string, string[]> | null | undefined, depth: number): string[] {
  const own = itemColumns?.[String(depth)];
  if (own) return own;
  if (depth <= 1) return [...BUILTIN_COLUMNS];
  for (let d = depth - 1; d >= 2; d -= 1) {
    const above = itemColumns?.[String(d)];
    if (above) return above;
  }
  return ['qty', 'unit'];
}
