import type { OverlayRivet, PdfOverlay } from "../pdf/overlay.ts";

export const PIECE_EXT = ".intro.md";

export type TextPiece = {
  id: string;
  path: string;
  medium: "text";
  body: string;
  /** Resolved display name. Id stays the filename stem. */
  title: string;
};

export type PdfPiece = {
  id: string;
  path: string;
  medium: "pdf";
  /** Always empty. PDF hosts do not use `.intro.md` marks as SoT. */
  body: "";
  pdfPath: string;
  overlay: PdfOverlay;
  overlayPath: string;
  sourceName?: string;
  /** Resolved display name (manual title, else original filename). */
  title: string;
};

export type Piece = TextPiece | PdfPiece;

export type ListedPiece = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
};

export type { OverlayRivet, PdfOverlay };
