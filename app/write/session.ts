export type Column = {
  pieceId: string;
  /** Rivet on the previous column that opened this one. Null on the root. */
  viaRivetId: string | null;
};

export function openRoot(pieceId: string): Column[] {
  return [{ pieceId, viaRivetId: null }];
}

/** Open a side as the next column after `hostIndex`; drop anything deeper. */
export function pushSide(
  columns: readonly Column[],
  hostIndex: number,
  pieceId: string,
  viaRivetId: string,
): Column[] {
  if (hostIndex < 0 || hostIndex >= columns.length) {
    throw new Error("host column out of range");
  }
  return [
    ...columns.slice(0, hostIndex + 1),
    { pieceId, viaRivetId },
  ];
}

/** Close this column and its subtree. Closing the root clears the chain. */
export function closeAt(columns: readonly Column[], index: number): Column[] {
  if (index <= 0) {
    return [];
  }
  return columns.slice(0, index);
}
