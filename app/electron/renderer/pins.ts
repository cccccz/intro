import { katexMath, renderHtml } from "./render.ts";
import { locateText, textAnchor, type TextAnchor } from "./pin-model.ts";
import type { PdfAnchor } from "./pdf-view.ts";

type BasePin = { id: string; sourceId: string; nodeId: string; title: string; width: number };
export type Pin = BasePin & ({ kind: "text"; anchor: TextAnchor } | { kind: "pdf"; anchors: PdfAnchor[] });
export type PinSource = { clean: string; title: string };
type Hooks = {
  load: (id: string) => Promise<PinSource>;
  edit: (id: string, source: string, start: number, end: number, value: string) => Promise<PinSource>;
  pdf: (id: string, anchor: PdfAnchor) => Promise<HTMLCanvasElement>;
  reveal: (pin: Pin) => Promise<void>;
  layout: () => void;
};

export class PinBoard {
  private root: HTMLElement;
  private strip: HTMLElement;
  private toggle: HTMLButtonElement;
  private pins: Pin[] = [];
  private key = "";
  private height = 170;
  private collapsed = false;
  private generation = 0;
  constructor(parent: HTMLElement, private hooks: Hooks) {
    this.root = document.createElement("section");
    this.root.className = "pin-board";
    this.root.hidden = true;
    this.toggle = document.createElement("button");
    this.toggle.className = "pin-toggle";
    this.toggle.onclick = () => { this.collapsed = !this.collapsed; this.applyLayout(); this.save(); };
    this.strip = document.createElement("div");
    this.strip.className = "pin-strip";
    const split = document.createElement("div");
    split.className = "pin-height-split";
    split.title = "拖动调整置顶区高度";
    split.setAttribute("role", "separator");
    split.setAttribute("aria-orientation", "horizontal");
    split.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = event.clientY;
      const height = this.strip.getBoundingClientRect().height;
      const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        this.height = Math.min(parent.clientHeight * .4, Math.max(80, height + next.clientY - start));
        this.applyLayout();
      };
      const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); this.save(); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    });
    this.root.append(this.toggle, this.strip, split);
    parent.insertBefore(this.root, parent.querySelector("#columns"));
    new ResizeObserver(() => this.applyLayout()).observe(parent);
  }
  private save(): void {
    if (!this.key) return;
    try { localStorage.setItem(this.key, JSON.stringify({ version: 1, pins: this.pins, height: this.height, collapsed: this.collapsed })); } catch { /* Local preference storage may be full. */ }
  }
  private applyLayout(): void {
    this.root.hidden = !this.pins.length;
    this.root.classList.toggle("collapsed", this.collapsed);
    this.toggle.textContent = `${this.collapsed ? "展开" : "收起"}置顶 · ${this.pins.length}`;
    this.strip.style.height = `${Math.min(this.height, this.root.parentElement!.clientHeight * .4)}px`;
    this.hooks.layout();
  }
  setLibrary(library: string): void {
    this.generation += 1;
    this.strip.replaceChildren();
    this.key = `intro:pins:v1:${library}`;
    this.pins = [];
    this.height = 170;
    this.collapsed = false;
    try {
      const value = JSON.parse(localStorage.getItem(this.key) ?? "null");
      if (value?.version === 1 && Array.isArray(value.pins)) {
        this.pins = value.pins.filter((pin: Pin) => pin && typeof pin.id === "string" && typeof pin.sourceId === "string" && (pin.kind === "text" ? typeof pin.anchor?.quote === "string" : pin.kind === "pdf" && Array.isArray(pin.anchors)));
        this.height = Number.isFinite(value.height) ? Math.max(80, value.height) : 170;
        this.collapsed = value.collapsed === true;
      }
    } catch { /* Ignore an invalid saved layout. */ }
    this.render();
  }
  addText(sourceId: string, nodeId: string, title: string, source: string, start: number, end: number): void {
    if (start === end) return;
    const existing = this.pins.find(pin => pin.kind === "text" && pin.sourceId === sourceId && pin.anchor.start === start && pin.anchor.quote === source.slice(start, end));
    this.add(existing ?? { id: crypto.randomUUID(), sourceId, nodeId, title, width: 320, kind: "text", anchor: textAnchor(source, start, end) });
  }
  addPdf(sourceId: string, nodeId: string, title: string, anchors: PdfAnchor[]): void {
    const existing = this.pins.find(pin => pin.kind === "pdf" && pin.sourceId === sourceId && JSON.stringify(pin.anchors) === JSON.stringify(anchors));
    this.add(existing ?? { id: crypto.randomUUID(), sourceId, nodeId, title, width: 320, kind: "pdf", anchors });
  }
  private add(pin: Pin): void {
    if (!this.pins.includes(pin)) this.pins.push(pin);
    this.collapsed = false;
    this.save();
    this.render();
    this.strip.querySelector<HTMLElement>(`[data-pin="${pin.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  sourceChanged(id: string, before: string, after: string): void {
    if (before === after) return;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = before.length, nextEnd = after.length;
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
    const delta = after.length - before.length;
    for (const pin of this.pins) {
      if (pin.sourceId !== id || pin.kind !== "text") continue;
      const range = locateText(before, pin.anchor);
      if (!range) continue;
      let next = range;
      if (end <= range.start) next = { start: range.start + delta, end: range.end + delta };
      else if (start >= range.end) { /* Unchanged excerpt. */ }
      else if (start >= range.start && end <= range.end) next = { start: range.start, end: range.end + delta };
      else continue; // A partial overlap cannot identify the intended new excerpt.
      if (next.start >= next.end) continue;
      pin.anchor = textAnchor(after, next.start, next.end);
      const cell = this.strip.querySelector<HTMLElement>(`[data-pin="${pin.id}"]`);
      const editor = cell?.querySelector<HTMLTextAreaElement>("textarea");
      if (editor && !editor.hidden) {
        cell!.querySelector<HTMLElement>(".pin-status")!.textContent = "原笔记已变化；保存时会校验，请取消后重新编辑以载入最新内容。";
      } else {
        const body = cell?.querySelector<HTMLElement>(".pin-content");
        if (body) body.innerHTML = renderHtml(pin.anchor.quote, [], [], katexMath);
      }
    }
    this.save();
  }
  private render(): void {
    const generation = this.generation;
    this.applyLayout();
    for (const pin of this.pins) {
      if (Array.from(this.strip.children).some(element => (element as HTMLElement).dataset.pin === pin.id)) continue;
      const cell = document.createElement("article");
      cell.className = "pin-cell";
      cell.dataset.pin = pin.id;
      cell.style.width = `${Math.max(220, Math.min(1000, pin.width || 320))}px`;
      const head = document.createElement("div");
      head.className = "pin-head";
      const title = document.createElement("span");
      title.textContent = pin.title + (pin.kind === "pdf" ? ` · p${pin.anchors[0]?.page}` : "");
      title.title = title.textContent;
      const status = document.createElement("div");
      status.className = "pin-status";
      const button = (label: string, action: () => void) => {
        const btn = document.createElement("button"); btn.textContent = label; btn.onclick = action; head.append(btn); return btn;
      };
      head.append(title);
      button("来源", () => { void this.hooks.reveal(pin).catch(error => { status.textContent = String(error.message ?? error); }); });
      const body = document.createElement("div");
      body.className = "pin-content body-rendered";
      if (pin.kind === "text") {
        body.innerHTML = renderHtml(pin.anchor.quote, [], [], katexMath);
        const editor = document.createElement("textarea");
        editor.className = "pin-editor";
        editor.hidden = true;
        editor.setAttribute("aria-label", "编辑置顶选区源文");
        let baseline = "";
        let range: { start: number; end: number } | null = null;
        const edit = button("编辑", () => {
          edit.disabled = true;
          void this.hooks.load(pin.sourceId).then(source => {
            range = locateText(source.clean, pin.anchor);
            if (!range) throw new Error("来源选区已变化，请返回来源重新置顶。保留了上次内容。");
            baseline = source.clean;
            editor.value = source.clean.slice(range.start, range.end);
            editor.hidden = false; body.hidden = true; edit.hidden = true; save.hidden = cancel.hidden = false;
            status.textContent = "编辑源文（含 TeX）；保存将更新原笔记。";
            editor.focus();
          }).catch(error => { status.textContent = error.message; }).finally(() => { edit.disabled = false; });
        });
        const finish = () => { editor.hidden = true; body.hidden = false; edit.hidden = false; save.hidden = cancel.hidden = true; };
        const save = button("保存", () => {
          if (!range) return;
          const activeRange = range;
          const replacement = editor.value;
          save.disabled = cancel.disabled = true;
          void this.hooks.edit(pin.sourceId, baseline, activeRange.start, activeRange.end, replacement).then(source => {
            pin.anchor = textAnchor(source.clean, activeRange.start, activeRange.start + replacement.length);
            body.innerHTML = renderHtml(replacement, [], [], katexMath);
            this.save(); finish(); status.textContent = "已写回原笔记";
          }).catch(error => { status.textContent = error.message; }).finally(() => { save.disabled = cancel.disabled = false; });
        });
        const cancel = button("取消", () => { finish(); status.textContent = ""; });
        save.hidden = cancel.hidden = true;
        editor.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); save.click(); } });
        cell.append(editor);
        void this.hooks.load(pin.sourceId).then(source => {
          if (generation !== this.generation) return;
          const current = locateText(source.clean, pin.anchor);
          if (!current) status.textContent = "来源选区已变化，显示最后一次内容";
        }).catch(() => { status.textContent = "来源暂不可用，显示最后一次内容"; });
      } else {
        body.textContent = "加载 PDF 选区…";
        void (async () => {
          const canvases = [];
          for (const anchor of pin.anchors) canvases.push(await this.hooks.pdf(pin.sourceId, anchor));
          if (generation === this.generation) body.replaceChildren(...canvases);
        })().catch(error => { if (generation === this.generation) body.textContent = `加载失败：${error.message}`; });
      }
      button("取下", () => {
        const editor = cell.querySelector<HTMLTextAreaElement>("textarea");
        if (editor && !editor.hidden) { status.textContent = "请先保存或取消编辑，再取下。"; return; }
        this.pins = this.pins.filter(item => item.id !== pin.id); cell.remove(); this.save(); this.applyLayout();
      });
      const grip = document.createElement("div");
      grip.className = "pin-width-split";
      grip.title = "拖动调整选区宽度";
      grip.onpointerdown = event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const x = event.clientX, width = cell.getBoundingClientRect().width;
        const move = (next: PointerEvent) => { pin.width = Math.max(220, Math.min(1000, width + next.clientX - x)); cell.style.width = `${pin.width}px`; };
        const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); this.save(); };
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop);
      };
      cell.prepend(head);
      cell.append(body, status, grip);
      this.strip.append(cell);
    }
  }
}
