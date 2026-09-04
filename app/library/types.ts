import type { OverlayRivet, PdfOverlay } from "../pdf/overlay.ts";

export const PIECE_EXT = ".intro.md";

export type TextPiece = {
  id: string;
  path: string;
  medium: "text";
  body: string;
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
};

export type Piece = TextPiece | PdfPiece;

export type ListedPiece = {
  id: string;
  path: string;
  medium: "text" | "pdf";
};

export type { OverlayRivet, PdfOverlay };
