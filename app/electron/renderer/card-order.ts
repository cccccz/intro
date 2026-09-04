/** Leave unchanged cards attached; atomic moves preserve focus and selection. */
export function orderCards<T>(
  stack: { children: ArrayLike<T>; moveBefore(card: T, before: T | null): void },
  cards: readonly T[],
): void {
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const current = stack.children[index] ?? null;
    if (current !== card) {
      stack.moveBefore(card, current);
    }
  }
}
