/** Boxes on the current host surface. Not stored; not SoT. */
export type AnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function clientToAnchor(r: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): AnchorRect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

export function rectsIntersect(a: AnchorRect, b: AnchorRect, slop = 2): boolean {
  return (
    a.bottom > b.top + slop &&
    a.top < b.bottom - slop &&
    a.right > b.left + slop &&
    a.left < b.right + slop
  );
}

/** Last box, right-center. PDF later can pass page quads in the same shape. */
export function attachPoint(rects: readonly AnchorRect[]): { x: number; y: number } | null {
  const last = rects[rects.length - 1];
  if (!last) {
    return null;
  }
  return { x: last.right, y: (last.top + last.bottom) / 2 };
}

/**
 * rivetId → rect list for the current host surface.
 * Textarea/HTML marks are the first provider; a later PDF host can implement
 * the same function from page geometry without changing wire/viewport code.
 */
export function rectsForRivet(host: ParentNode, rivetId: string): AnchorRect[] {
  const node = host.querySelector(`[data-rivet="${CSS.escape(rivetId)}"]`);
  if (!node) {
    return [];
  }
  return Array.from(node.getClientRects()).map(clientToAnchor);
}
