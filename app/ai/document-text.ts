import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite } from './commit.ts';
import type { AiContext } from '../electron/renderer/ai-types.ts';

export type TextPage = { page: number; text: string };
export type PdfReader = (root: string, id: string, page: number, textOnly?: boolean) => Promise<AiContext>;
const marker = '\n<!-- intro-page:';
export function markdownPages(pages: TextPage[]): string {
  return '# Extracted PDF text v1\n\nPDF page numbers; rough text, not authoritative. Empty pages may need OCR.\n' + pages.map(p => `${marker}${p.page} -->\n## PDF page ${p.page}\n\n${p.text.replaceAll(marker, '\n<!-- escaped-page:')}\n`).join('');
}
export function parsePages(md: string): TextPage[] {
  if (!md.startsWith('# Extracted PDF text v1\n')) throw new Error('文本缓存格式无效');
  return md.split(marker).slice(1).map((part, i) => {
    const prefix = `${i + 1} -->\n## PDF page ${i + 1}\n\n`;
    if (!part.startsWith(prefix)) throw new Error('文本缓存页码无效');
    return { page: i + 1, text: part.slice(prefix.length).trimEnd() };
  });
}
export function searchPages(pages: TextPage[], query: string, offset = 0) {
  if (!query.trim() || query.length > 300 || !Number.isInteger(offset) || offset < 0) throw new Error('搜索词或结果起点无效');
  const needle = query.trim().toLowerCase();
  const hits = pages.flatMap(p => {
    const at = p.text.toLowerCase().indexOf(needle);
    return at < 0 ? [] : [{ page: p.page, excerpt: p.text.slice(Math.max(0, at - 250), at + needle.length + 500), method: 'pdf-text' }];
  });
  return { hits: hits.slice(offset, offset + 20), total: hits.length, nextOffset: offset + 20 < hits.length ? offset + 20 : null, emptyPages: pages.filter(p => !p.text.trim()).map(p => p.page), note: 'Literal case-insensitive search. No match does not establish absence: try alternative terms or inspect the PDF. OCR is not available yet.' };
}
export async function extractedPages(directory: string, pdfPath: string, root: string, id: string, reader: PdfReader, active: () => boolean, progress: (message: string) => void): Promise<TextPage[]> {
  const fingerprint = createHash('sha256').update(await fs.promises.readFile(pdfPath)).digest('hex');
  const file = path.join(directory, `${fingerprint}.extracted.md`);
  if (fs.existsSync(file)) {
    try { const pages = parsePages(await fs.promises.readFile(file, 'utf8')); if (pages.length) return pages; } catch { /* Rebuild invalid auxiliary cache. */ }
  }
  const metadata = await reader(root, id, 0, true);
  const count = JSON.parse(metadata.text).pageCount;
  if (!Number.isInteger(count) || count < 1) throw new Error('PDF 页数无效');
  const pages: TextPage[] = [];
  for (let page = 1; page <= count; page++) {
    if (!active()) throw new Error('已取消文本提取');
    progress(`正在准备可搜索文本 ${page}/${count}…`);
    pages.push({ page, text: (await reader(root, id, page, true)).text });
  }
  if (!active()) throw new Error('已取消文本提取');
  const after = createHash('sha256').update(await fs.promises.readFile(pdfPath)).digest('hex');
  if (after !== fingerprint) throw new Error('PDF 已变化，请重试');
  atomicWrite(file, markdownPages(pages));
  return pages;
}
