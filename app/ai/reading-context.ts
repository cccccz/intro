import { Library } from '../library/index.ts';
import { pieceView } from '../write/loop.ts';
import type { AiContext } from '../electron/renderer/ai-types.ts';

export type RelatedSource = { pieceId: string; label: string; medium: 'text' | 'pdf'; relation: string; page?: number };
export function readingContext(lib: Library, hostId: string): { related: RelatedSource[]; excerpts: AiContext[] } {
  const views = lib.list().flatMap(p => { try { return [pieceView(lib.load(p.id))]; } catch { return []; } });
  const related = new Map<string, RelatedSource>(); const excerpts: AiContext[] = [];
  const host = views.find(v => v.id === hostId)!;
  related.set(hostId, { pieceId: hostId, label: host.title, medium: host.medium, relation: '当前笔记或文档' });
  let frontier = [hostId];
  for (let depth = 0; frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const view of views) {
      const links = view.medium === 'text' ? view.rivets : view.overlayRivets;
      for (const link of links.filter(l => l.to && frontier.includes(l.to))) {
        if (related.has(view.id)) continue;
        const page = 'anchors' in link ? link.anchors[0]?.page : undefined;
        related.set(view.id, { pieceId: view.id, label: view.title, medium: view.medium, relation: `上溯第 ${depth + 1} 层来源`, page }); next.push(view.id);
        if (depth === 0) {
          const text = 'start' in link ? view.clean.slice(Math.max(0, link.start - 1500), Math.min(view.clean.length, link.end + 1500)) : `此笔记挂接到 PDF 第 ${page} 页的区域：${JSON.stringify(link.anchors)}`;
          excerpts.push({ id: `parent-${view.id}`, label: `直接来源：${view.title}`, text });
        }
      }
    }
    frontier = next;
  }
  for (const link of [...host.rivets, ...host.overlayRivets]) {
    const child = views.find(v => v.id === link.to);
    if (child && !related.has(child.id)) related.set(child.id, { pieceId: child.id, label: child.title, medium: child.medium, relation: '已有子 side' });
  }
  return { related: [...related.values()], excerpts };
}
