export const CARD_HEIGHT_MIN = 120;
export const CARD_HEIGHT_MAX = 2400;

export function resizeCardPair(upper: number, lower: number, delta: number): [number, number] {
  const change = Math.max(
    Math.max(CARD_HEIGHT_MIN - upper, lower - CARD_HEIGHT_MAX),
    Math.min(Math.min(CARD_HEIGHT_MAX - upper, lower - CARD_HEIGHT_MIN), delta),
  );
  return [upper + change, lower - change];
}

export function clampCardHeight(value: number): number {
  if (!Number.isFinite(value)) return 320;
  return Math.min(CARD_HEIGHT_MAX, Math.max(CARD_HEIGHT_MIN, Math.round(value)));
}

export function cardHeightKey(library: string, nodeId: string): string {
  return `intro:side-height:v1:${JSON.stringify([library, nodeId])}`;
}

export function loadCardHeight(storage: Pick<Storage, "getItem">, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? clampCardHeight(value) : null;
  } catch { return null; }
}

export function saveCardHeight(storage: Pick<Storage, "setItem" | "removeItem">, key: string, value: number | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, String(clampCardHeight(value)));
  } catch { /* Layout still works when storage is unavailable. */ }
}
