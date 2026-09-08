import type { AiStart, AiJobView, AiModel, AiContext } from "./renderer/ai-types.ts";
import type { Damage, RivetSpec } from "../marks/types.ts";
import type { EditBatch } from "../write/anchor-edits.ts";
import type { OverlayRivet, PdfAnchor } from "../pdf/overlay.ts";

export type PieceDto = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
  titled: boolean;
  body: string;
  clean: string;
  rivets: RivetSpec[];
  overlayRivets: OverlayRivet[];
  damage: Damage[];
  pdfPath?: string;
  sourceName?: string;
};

export type ListedPieceDto = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
  titled: boolean;
};

export type LibraryDto = {
  root: string;
  pieces: ListedPieceDto[];
};

export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; error: string };

export type IntroApi = {
  aiEdit: (id: string, expected: string, markdown: string) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiModels: () => Promise<Ok<{ models: AiModel[] }> | Err>;
  aiApply: (id: string, undo?: boolean) => Promise<Ok<{ piece: PieceDto }> | Err>;
  aiProvideContext: (id: string, result: { context?: AiContext; error?: string }) => Promise<void>;
  onAiRead: (callback: (request: { id: string; root: string; pieceId: string; page: number; textOnly?: boolean }) => void) => () => void;
  aiStart: (request: AiStart) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiStatus: (id: string) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiCancel: (id: string) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiList: () => Promise<Ok<{ jobs: AiJobView[] }> | Err>;
  aiLogin: () => Promise<Ok<{}> | Err>;
  aiCommit: (id: string) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;

  editExcerpt: (id: string, expected: string, start: number, end: number, text: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  detachSide: (hostId: string, rivetId: string, clean?: string) => Promise<Ok<{ host: PieceDto }> | Err>;
  openLibrary: () => Promise<Ok<{ library: LibraryDto }> | Err>;
  openLibraryPath: (root: string) => Promise<Ok<{ library: LibraryDto }> | Err>;
  listPieces: () => Promise<Ok<{ pieces: ListedPieceDto[] }> | Err>;
  createPiece: (opts?: {
    id?: string;
    body?: string;
    title?: string;
  }) => Promise<Ok<{ piece: PieceDto; pieces: ListedPieceDto[] }> | Err>;
  setPieceTitle: (
    id: string,
    title: string,
  ) => Promise<Ok<{ piece: PieceDto; pieces: ListedPieceDto[] }> | Err>;
  loadPiece: (id: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  persistClean: (
    id: string,
    clean: string,
    batch?: EditBatch,
  ) => Promise<Ok<{ piece: PieceDto }> | Err>;
  hangSide: (opts: {
    hostId: string;
    start: number;
    end: number;
    clean?: string;
    sideId?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
  attachPdf: () => Promise<Ok<{ piece: PieceDto; pieces: LibraryDto["pieces"] }> | Err>;
  readPdf: (id: string) => Promise<Ok<{ data: Uint8Array }> | Err>;
  hangPdfSide: (opts: {
    hostId: string;
    anchors: PdfAnchor[];
    sideId?: string;
    quote?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
  dropSide: (id: string) => Promise<Ok<{ deleted: string[]; hosts: PieceDto[]; pieces: ListedPieceDto[] }> | Err>;
};

export const IPC = {
  aiEdit: "ai:edit", aiModels: "ai:models", aiApply: "ai:apply", aiProvideContext: "ai:context",
  aiStart: "ai:start",
  aiStatus: "ai:status",
  aiCancel: "ai:cancel",
  aiList: "ai:list",
  aiLogin: "ai:login",
  aiCommit: "ai:commit",

  editExcerpt: "piece:editExcerpt",
  detachSide: "piece:detachSide",
  openLibrary: "library:open",
  openLibraryPath: "library:openPath",
  listPieces: "library:list",
  createPiece: "piece:create",
  setPieceTitle: "piece:setTitle",
  loadPiece: "piece:load",
  persistClean: "piece:persistClean",
  hangSide: "piece:hangSide",
  attachPdf: "piece:attachPdf",
  readPdf: "piece:readPdf",
  hangPdfSide: "piece:hangPdfSide",
  dropSide: "piece:dropSide",
} as const;
