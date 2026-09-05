export type MathRect = { left: number; top: number; right: number; bottom: number };

/** Merge one anchor's neighboring glyphs; retain separate lines and distant parts. */
export function mathRegions(input: readonly MathRect[], gap = 6): MathRect[] {
  const regions: MathRect[] = [];
  for (const box of input) {
    if (box.right <= box.left || box.bottom <= box.top) continue;
    let merged = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    for (let i = 0; i < regions.length;) {
      const other = regions[i];
      const verticalOverlap = Math.min(merged.bottom, other.bottom) - Math.max(merged.top, other.top);
      const horizontalGap = Math.max(merged.left, other.left) - Math.min(merged.right, other.right);
      if (verticalOverlap > 0 && horizontalGap <= gap) {
        merged = { left: Math.min(merged.left, other.left), top: Math.min(merged.top, other.top),
          right: Math.max(merged.right, other.right), bottom: Math.max(merged.bottom, other.bottom) };
        regions.splice(i, 1); i = 0;
      } else i++;
    }
    regions.push(merged);
  }
  return regions.sort((a, b) => a.top - b.top || a.left - b.left);
}
