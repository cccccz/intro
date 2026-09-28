/**
 * Runs inside the page (serialized by Playwright). One line per element: tag, id, classes, the attributes the
 * renderer uses as state, whether it is visible, its rounded box, scroll offset, form value and own text.
 * Boxes carry layout; attributes carry view-layer state such as data-rivet, hidden and aria-expanded.
 */
export function domSignature(): string {
  const KEEP = new Set(["role", "hidden", "disabled", "title", "type", "d", "href", "placeholder", "style", "open", "draggable", "contenteditable", "tabindex", "width", "height", "viewBox", "points", "x1", "x2", "y1", "y2", "cx", "cy", "r"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"]);
  const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);
  const lines: string[] = [];

  const describe = (node: Element, depth: number): void => {
    if (SKIP.has(node.tagName)) return;
    const tag = node.tagName.toLowerCase();
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const visible = style.display !== "none" && style.visibility !== "hidden" && (box.width > 0 || box.height > 0);
    const parts = [tag];
    if (node.id) parts.push(`#${node.id}`);
    const classes = [...node.classList].sort();
    if (classes.length) parts.push(`.${classes.join(".")}`);
    const attrs = [...node.attributes]
      .filter((a) => a.name.startsWith("data-") || a.name.startsWith("aria-") || KEEP.has(a.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => (a.value === "" ? `[${a.name}]` : `[${a.name}=${JSON.stringify(clip(a.value, 160))}]`));
    parts.push(...attrs);
    if (visible) {
      parts.push(`@${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`);
      if (style.opacity !== "1") parts.push(`opacity=${style.opacity}`);
    } else {
      parts.push("(invisible)");
    }
    if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
      if (node.scrollTop || node.scrollLeft) parts.push(`scroll=${Math.round(node.scrollLeft)},${Math.round(node.scrollTop)}`);
    }
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      parts.push(`value=${JSON.stringify(clip(node.value, 240))}`);
      if (node === document.activeElement && node.selectionStart !== null) parts.push(`sel=${node.selectionStart}-${node.selectionEnd}`);
    }
    if (node instanceof HTMLDialogElement) parts.push(node.open ? "(open)" : "(closed)");
    if (node === document.activeElement) parts.push("(focus)");
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    // KaTeX output is deep but fully determined by its source; its text and box are enough.
    const opaque = node.classList.contains("katex") || tag === "canvas";
    const text = opaque ? (node.textContent ?? "").replace(/\s+/g, " ").trim() : own;
    if (text) parts.push(JSON.stringify(clip(text, 120)));
    lines.push(`${"  ".repeat(depth)}${parts.join(" ")}`);
    if (opaque) return;
    for (const child of node.children) describe(child, depth + 1);
  };

  lines.push(`title ${JSON.stringify(document.title)}`);
  lines.push(`viewport ${window.innerWidth}x${window.innerHeight}`);
  describe(document.body, 0);
  return lines.join("\n");
}
