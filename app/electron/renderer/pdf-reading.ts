export type PdfReadingPosition = {
  page: number;
  fraction: number;
  gap: number;
  zoom: number;
};

export function readingKey(library: string, piece: string): string {
  return `intro:pdf-reading:v1:${JSON.stringify([library, piece])}`;
}

export function loadReading(storage: { getItem(key: string): string | null }, key: string): PdfReadingPosition | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (!value || !Number.isInteger(value.page) || value.page < 1 ||
      !Number.isFinite(value.fraction) || value.fraction < 0 || value.fraction > 1 ||
      !Number.isFinite(value.gap) || value.gap > 0 ||
      !Number.isFinite(value.zoom) || value.zoom < 0.25 || value.zoom > 4) return null;
    return value;
  } catch { return null; }
}

export function saveReading(storage: { setItem(key: string, value: string): void }, key: string, value: PdfReadingPosition): void {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Reading remains available if storage is full. */ }
}
