/** Display preferences only: no library files or top-strip pins are modified. */
export function sidePinId(hostPieceId: string, rivetId: string): string {
  return JSON.stringify([hostPieceId, rivetId]);
}

function storageKey(library: string): string {
  return `intro:side-pins:v1:${JSON.stringify(library)}`;
}

export function loadSidePins(storage: Pick<Storage, "getItem">, library: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey(library)) ?? "null");
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string => {
      if (typeof item !== "string") return false;
      try {
        const ids: unknown = JSON.parse(item);
        return Array.isArray(ids) && ids.length === 2 && ids.every(id => typeof id === "string" && id.length > 0);
      } catch { return false; }
    }));
  } catch { return new Set(); }
}

export function saveSidePins(storage: Pick<Storage, "setItem">, library: string, pins: ReadonlySet<string>): boolean {
  try {
    storage.setItem(storageKey(library), JSON.stringify([...pins]));
    return true;
  } catch { return false; }
}
