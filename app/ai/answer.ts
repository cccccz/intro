import { stripVTControlCharacters } from 'node:util';
import type { AiAnswer } from '../electron/renderer/ai-types.ts';

// Short page IDs are only aliases for the selected PDF, never another document.
export function sourceId(id: string, selectedPdf?: string): string {
  return selectedPdf && /^page-[1-9]\d*$/.test(id) ? `document-${selectedPdf}-${id}` : id;
}

export function cleanNote(markdown: string): string { return stripVTControlCharacters(markdown); }

export function validateAnswer(raw: string, read: ReadonlySet<string>, selectedPdf?: string): AiAnswer {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('回答不是有效 JSON；原始回答已保留。'); }
  if (!value || typeof value !== 'object') throw new Error('回答不是笔记对象；原始回答已保留。');
  const a = value as Record<string, unknown>;
  if (typeof a.title !== 'string') throw new Error('回答缺少文字标题；原始回答已保留。');
  if (typeof a.markdown !== 'string' || !a.markdown.trim()) throw new Error('回答正文为空或格式错误；原始回答已保留。');
  if (a.markdown.length > 100000) throw new Error('回答正文超过十万字符；原始回答已保留。');
  if (/<<\/?r\b/.test(a.markdown)) throw new Error('回答含内部挂接标记；原始回答已保留。');
  if (!Array.isArray(a.sources) || a.sources.some(id => typeof id !== 'string')) throw new Error('回答 sources 必须是来源 ID 列表；原始回答已保留。');
  const sources = [...new Set((a.sources as string[]).map(id => sourceId(id, selectedPdf)))];
  const allowed = new Set([...read].map(id => sourceId(id, selectedPdf)));
  const unknown = sources.filter(id => !allowed.has(id));
  if (unknown.length) throw new Error(`回答引用了未读取或未知的来源：${unknown.join(', ').slice(0, 500)}；原始回答已保留。`);
  return { title: a.title, markdown: cleanNote(a.markdown), sources };
}
