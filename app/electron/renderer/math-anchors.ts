import { mathRegions } from "./math-regions.ts";
type Range = { start: number; end: number; id: string };

/** One presentation region per contiguous part, behind the untouched equation. */
export function paintMathRegions(pane: HTMLElement, hotId: string | null): void {
  pane.querySelector(":scope > .math-regions")?.remove();
  if (!pane.getClientRects().length) return;
  const formulas = pane.querySelectorAll<HTMLElement>(".math-source");
  if (!formulas.length) return;
  const bounds = pane.getBoundingClientRect();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("math-regions");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(pane.scrollWidth));
  svg.setAttribute("height", String(pane.scrollHeight));
  for (const formula of formulas) {
    const anchors = JSON.parse(formula.dataset.mathAnchors ?? "[]") as Range[];
    const open = new Set(JSON.parse(formula.dataset.mathOpen ?? "[]") as string[]);
    for (const { id } of anchors) {
      const elements = formula.querySelectorAll<HTMLElement>(`[data-math-rivets~="${CSS.escape(id)}"]`);
      const boxes = Array.from(elements).flatMap(e => Array.from(e.getClientRects()));
      const gap = parseFloat(getComputedStyle(formula).fontSize) * 0.4;
      for (const region of mathRegions(boxes, gap)) {
        const rect = document.createElementNS(svg.namespaceURI, "rect");
        rect.setAttribute("x", String(region.left - bounds.left - pane.clientLeft + pane.scrollLeft - 2));
        rect.setAttribute("y", String(region.top - bounds.top - pane.clientTop + pane.scrollTop - 2));
        rect.setAttribute("width", String(region.right - region.left + 4));
        rect.setAttribute("height", String(region.bottom - region.top + 4));
        rect.setAttribute("rx", "3");
        rect.setAttribute("data-math-outline", id);
        rect.classList.toggle("open", open.has(id));
        rect.classList.toggle("hot", hotId === id);
        svg.append(rect);
      }
    }
  }
  if (svg.childElementCount) pane.append(svg);
}

/** Apply only presentation attributes. Never insert wrappers into KaTeX vlists. */
export function paintMathAnchors(pane: HTMLElement): void {
  for (const formula of pane.querySelectorAll<HTMLElement>(".math-source")) {
    const anchors = JSON.parse(formula.dataset.mathAnchors ?? "[]") as Range[];
    const open = new Set(JSON.parse(formula.dataset.mathOpen ?? "[]") as string[]);
    const elements = Array.from(formula.querySelectorAll<HTMLElement>("[data-tex-start]"));
    for (const element of elements) {
      const start = Number(element.dataset.texStart), end = Number(element.dataset.texEnd);
      const ids = anchors.filter(a => start < a.end && end > a.start &&
        // A parent group is painted only when completely covered; otherwise
        // its mapped descendants provide the precise partial highlight.
        (a.start <= start && end <= a.end || !element.querySelector("[data-tex-start]")))
        .map(a => a.id);
      if (!ids.length) continue;
      element.dataset.mathRivets = ids.join(" ");
      element.classList.add("math-rivet");
      element.classList.toggle("open", ids.some(id => open.has(id)));
    }
    const missing = anchors.filter(a => !elements.some(e => e.dataset.mathRivets?.split(" ").includes(a.id)));
    if (missing.length) {
      const message = document.createElement("span");
      message.className = "math-anchor-warning";
      message.textContent = "部分标注无法定位，请在 Source 中检查选区。";
      formula.append(message);
    }
  }
}

/** Map a rendered mathematical selection through parser locations, never text matching. */
export function mathSelection(range: globalThis.Range): { start: number; end: number; expanded: boolean } | null {
  const elementOf = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const first = elementOf(range.startContainer)?.closest<HTMLElement>(".math-source");
  const last = elementOf(range.endContainer)?.closest<HTMLElement>(".math-source");
  if (!first || first !== last) return null;
  const base = Number(first.dataset.mathStart);
  if (!Number.isInteger(base) || base < 0) return null;
  const selected = Array.from(first.querySelectorAll<HTMLElement>("[data-tex-start]"))
    .filter(e => !e.querySelector("[data-tex-start]") && range.intersectsNode(e));
  if (!selected.length) return null;
  return { start: base + Math.min(...selected.map(e => Number(e.dataset.texStart))),
    end: base + Math.max(...selected.map(e => Number(e.dataset.texEnd))), expanded: false };
}
