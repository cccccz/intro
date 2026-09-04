/** Session-local identity. Root is always `ROOT_ID`; a side uses its via rivet id. */
export const ROOT_ID = "root";

export type OpenNode = {
  id: string;
  pieceId: string;
  /** Rivet on the parent that opened this node. Null on the root. */
  viaRivetId: string | null;
  parentId: string | null;
  depth: number;
};

export function openRoot(pieceId: string): OpenNode[] {
  return [{ id: ROOT_ID, pieceId, viaRivetId: null, parentId: null, depth: 0 }];
}

/**
 * Open a side under an already-open parent. Same parent+rivet is idempotent.
 * Siblings at that depth stay (结论 #22: 同层多支叠在该层). Does not drop
 * other branches.
 */
export function openSide(
  nodes: readonly OpenNode[],
  parentId: string,
  pieceId: string,
  viaRivetId: string,
): OpenNode[] {
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) {
    throw new Error("parent not open");
  }
  if (nodes.some((n) => n.parentId === parentId && n.viaRivetId === viaRivetId)) {
    return [...nodes];
  }
  return [
    ...nodes,
    {
      id: viaRivetId,
      pieceId,
      viaRivetId,
      parentId,
      depth: parent.depth + 1,
    },
  ];
}

function descendantIds(nodes: readonly OpenNode[], id: string): Set<string> {
  const drop = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && drop.has(node.parentId) && !drop.has(node.id)) {
        drop.add(node.id);
        grew = true;
      }
    }
  }
  return drop;
}

/** Close this node and its subtree. Closing the root clears the chain. */
export function closeNode(nodes: readonly OpenNode[], id: string): OpenNode[] {
  const target = nodes.find((n) => n.id === id);
  if (!target || target.depth === 0) {
    return [];
  }
  const drop = descendantIds(nodes, id);
  return nodes.filter((n) => !drop.has(n.id));
}

export function nodesAtDepth(nodes: readonly OpenNode[], depth: number): OpenNode[] {
  return nodes.filter((n) => n.depth === depth);
}

export function childrenOf(nodes: readonly OpenNode[], parentId: string): OpenNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/** Rivets on `parentId` whose sides are currently open. */
export function openRivetIds(nodes: readonly OpenNode[], parentId: string): string[] {
  return childrenOf(nodes, parentId)
    .map((n) => n.viaRivetId)
    .filter((id): id is string => id !== null);
}

export function maxDepth(nodes: readonly OpenNode[]): number {
  return nodes.reduce((max, n) => Math.max(max, n.depth), 0);
}
