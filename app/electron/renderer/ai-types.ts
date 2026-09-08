type PdfAnchor = { page: number; rect: { x: number; y: number; width: number; height: number } };

export type AiSelection = { kind: 'text'; expected: string; start: number; end: number }
  | { kind: 'pdf'; anchors: PdfAnchor[] };
export type AiContext = { id: string; label: string; text: string; image?: string };
export type AiModel = { id: string; label: string; images: boolean; efforts: string[]; defaultEffort: string; isDefault: boolean };
export type AiStart = { root: string; hostId: string; selection: AiSelection; question: string; contexts: AiContext[]; selectionImage?: string; model?: string; effort?: string; web?: boolean; intent?: 'note' | 'revise' };
export type AiAnswer = { title: string; markdown: string; sources: string[] };
export type AiJobView = { id: string; root: string; hostId: string; status: 'running' | 'ready' | 'error' | 'cancelled' | 'saved'; progress: string; answer?: AiAnswer; error?: string; rawAnswer?: string; intent?: 'note' | 'revise'; original?: string };
