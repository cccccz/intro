# app/

真实现只放这里。`mockup/` 仍是演示，不共用入口。

本轮在 P2 文本写回路之上加了 **PDF 宿主第一可用路径**：侧车 overlay，不写回 PDF。

## 怎么跑

在仓库根目录：

```
npm install
npm test
npm run app
```

开发时也可以 `npm run electron:dev`（同样是编译再开 Electron）。

可选：直接打开一个库目录（空目录也行，会当成新库）：

```
npm run app -- --library /path/to/library
```

`npm run build:app` 只编译到 `app/dist/`。`npm run typecheck:app` 做类型检查。

## M1 写回路（空库 → 嵌套铆点树）

1. **File → Open library…**（Ctrl+O）：选一个本地文件夹。空文件夹就是新库。库路径显示在窗口标题和 File 菜单里。
2. **File → New piece**（Ctrl+N，或 Pieces 列表空白处右键）：可填显示名，建 `{id}.intro.md`。`{id}` 是文件名主干，也是铆点 `to=`，改名不会改它。列表/卡片主标签是 `title:`；空标题则用短 id 或挂上来的选区摘录。完整 id 只在小号/tooltip。**Rename** 只改文首 YAML `title:`，`persistClean` / `addMark` 保留这段 frontmatter。
3. 每列可在编辑区 **右键** 切 **Source** / **Rendered**。Source 是这篇的权威面（做法 A：铆点标记在 `{id}.intro.md`）。屏幕上编辑的是清除后的干净正文（`$...$` 仍是源文）；`persistClean` / `addMark` 只走 Source，落盘仍带 `<<r>>` 标记，不写 HTML。Rendered 是同一篇的只读投影，不是第二份正文。顺序是 **先 parse/strip 铆点，再对干净正文做 markdown**（`**` / `#` 等不得拆 `<<r>>` 定界符）。子集：标题、列表、粗体/斜体、链接、行内代码、围栏代码、引用，以及 `$...$` / `$$...$$`（KaTeX）。不渲染原文 HTML 或图片。高亮与导线是视图像，不写入源文。
4. **划选一段**，右键 **New side**：用 `addMark` 往宿主写入 `<<r id="…" to="…">>…<</r id="…">>`，并新建一篇侧边，作为下一列打开。视图像标出该选区，并有导线连到打开的侧边卡片（几何不落盘）。Rendered 里右键 New side 会回到 Source 再划。再点高亮或 Rendered 里的 `mark` 即 Close 该侧边（钉点留盘）。
5. 在侧边里再划、再挂（d2）。列 = 深度；同一宿主上多个打开的铆点叠在该层 panel 里（多张卡片），不互相顶掉。高亮与导线随滚动/窗口缩放更新。源高亮滚出该列视口则不画对应侧边卡片（不是合上）；侧列仍占位，列宽不因此变化。侧边不列出 rivets。
6. 右键 **Hang existing…** 把选区挂到库里已有的一篇（复用）。PDF 顶栏 **Rivets** 可跳到锚点并开/关已挂侧边。
7. 侧边卡片头只放 Pin、AI… 和 ⋯；Rename、Close、解除挂接、删除笔记在 ⋯ 或卡片头右键菜单里。Pieces 列表里的删除在条目右键菜单里。**Close** 只从画面拿掉该卡片及其子树；磁盘上的铆点和篇还在。合上宿主列则收起整条链。**删除笔记** 确认后从库里删这篇文本侧边、拆父钉点，并级联删没有其他钉点指向的子篇。PDF 宿主不能从这里删。
8. **File → Open PDF…**：把本地 PDF **复制**进库（不改原文件、也不往副本里写 Annot）。左列是 PDF.js 渲染（render-first）。默认标题是原文件名，可 **Rename**。在页上**拖出一块区域**，右键 **New side**：侧边仍是 `{id}.intro.md`，可右键切 Source/Rendered、再划再挂（d2）。高亮和导线走同一套 `rivetId → rects`（overlay 画 `[data-rivet]`）。再点高亮收起该侧边。

PDF 列顶栏：

- **Zoom**：`−` / `+` 以「适宽」为 100% 加减（0.25×–4×）。**Fit width** 回到适宽。缩放会重算每页占位高度，只重新 raster 当前可见窗口（overscan 仍是 ±2）。
- **Page**：输入页码回车，滚到该页占位并保证它进入 raster 窗口。
- **Outline**：点开后在 PDF 页上盖一层目录，每条右侧是页码。打开时展开到正在读的那一节并标出来，其余层级收起；只有一个顶层条目（书名）时自动展开它。点标题跳页，点 ▸ 展开/收起，「收起」全部折叠。顶部输入框按标题筛选，显示命中项及其上级，Enter 跳到第一条。键盘：↑↓ 移动，→ 展开，← 收起或回到上级，Enter 跳页，直接打字进入筛选。Esc 先清空筛选，再按一次关闭；再点 Outline 或点页面空白也关闭。展开状态在本次运行内按 PDF 记住。没有书签时按钮禁用（No outline）。
- **Rivets**：overlay 铆点列表在顶栏弹出。点条目滚到该锚所在页，并打开或收起已挂的侧边。

分栏：PIECES 与板、列与列之间（含最右列右侧）可拖分割条，手柄约 6px，悬停高亮。宿主列默认占满剩余宽度；拖过之后宽度记在 `localStorage`（`intro:chrome-layout:v1`），个人自用。

三种看法、置顶带、导出不在本轮。PDF 文本层划词、摘录重挂、写回 PDF、扫描件 OCR 都还没做。

## 标记

语法草案：[marks/SYNTAX.md](marks/SYNTAX.md)

库入口：`app/marks/`（`parse` → 钉树，`strip`，交叉当损坏，`add` / `addMark`）。

```ts
import { add, parse, strip } from "./marks/index.ts";

const clean = "宿主正文";
const marked = add(clean, [{ id: "r1", to: "side01", start: 0, end: 2 }]);
strip(marked) === clean; // inverse
parse(marked).rivets;    // 嵌套树；damage 非空即损坏
```

偏移是 **strip 之后正文** 的 UTF-16 下标。编辑器划选按干净正文算，再交给 `addMark`。

## 库（一篇一个文件）

文本篇 = 库目录下任意一层的 `{id}.intro.md`。id 即文件名主干；`to` 写篇 id，不写路径。显示名写在同一文件文首：

```yaml
---
title: Proof sketch
---
```

不是第二种 id，也不是 `.meta.json`。parse/strip/add 只看见 frontmatter 之后的正文（标记 SoT）。空 `title` 时 UI 用短 id 或选区摘录。

```ts
import { Library } from "./library/index.ts";

const lib = new Library("/path/to/library");
lib.createPiece({ id: "host01", body: marked });
lib.save("host01", marked);
lib.load("host01");
lib.resolve("host01"); // → 绝对路径
lib.list();            // id + 路径 + medium + 显示名（读文首 frontmatter，不 parse 标记）
lib.attachPdf("/path/to/paper.pdf");
```

写回路（无 UI）：`app/write/` 的 `persistClean` / `hangSide` / `hangPdfSide` / `dropSide` / 列会话。Electron 主进程走同一套。`persistClean` / `hangSide` 只用于文本篇。`dropSide` 只删文本篇。

## PDF 宿主（侧车，不是 PDF SoT）

打开任意本地 PDF 即可。库里每个 PDF 宿主三件一套，**不把 `<<r>>` 或字符下标写进 PDF**：

```
{id}.intro.host.json     # medium=pdf, pdf="{id}.pdf", 可选 sourceName / title（显示名，不是第二种 id）
{id}.pdf                 # 附入时的字节副本；之后只读，不写 Annot
{id}.intro.overlay.json  # rivet id → to + page + user-space rect（原点左下）
{sideId}.intro.md        # 侧边，做法 A 文本标记；文首 YAML title: 与文本篇相同
```

没有 `{id}.intro.meta.json`。PDF 宿主没有 `.intro.md`（避免和 medium 冲突）；侧边是普通 `.intro.md`。空标题时 PDF 宿主回退到原文件名。UI 不得把 UUID 当主标签。

`overlay` 里的矩形是 PDF 用户空间的轴对齐框。若输入是 QuadPoints（8 个数一组），按四个顶点的 min/max 归一，不假设 Acrobat 与 ISO 顶点顺序一致，也不把选区当成 PDF 文件的字符串下标。

几何：PDF.js 把这些框投到页上的 `[data-rivet]`，与文本宿主共用导线/视口代码。屏幕像素不落盘。长文档只 raster 视口附近的页（相交页 ± 2；占位保持滚动高度）；overlay 只画在已挂上的页上，滚回再挂时仍从 sidecar 投影。

已做：附入 PDF、框选区域、新建/复用侧边、overlay 高亮 + 导线、侧边再挂（文本 Source/Rendered 仍在）。

未做：PDF.js 文本层划词与摘录、Hypothesis 式模糊重挂、把 PDF 当侧边、写回 / 导出带 Annot 的 PDF、CJK cmap / 扫描件。

没有搜索、没有导出。屏幕可以显示 `strip` 后的宿主；磁盘仍留带标记的正文。

改过已有铆点的正文时：仍落在干净区间内的钉会留下来；对不上的钉会丢掉，避免写坏交叉。这是 M1 的折中，不是新权威。

## 置顶选区（预览版）

### 侧边 Pin

侧边标题栏的 **Pin** 让整张侧注留在原列：滚动文本或 PDF 来源时，不因来源离开视口而隐藏。**Unpin** 恢复原有显隐规则；来源不在视口时不画导线。它与下述顶部“置顶选区”是两个独立功能。

同一篇的不同挂接可以分别固定。偏好按资料库记住，重开这条侧注后仍生效；不会自动打开侧注，也不会改写笔记或 PDF。Close 和解除挂接依然收起整条子树。侧边自己的滚动和层级导航不受 Pin 限制。

### 顶部置顶带

PDF 框选或笔记选中文字后，右键选择“置顶选区”。顶部置顶带独立于三列窗口；底边调高，选区右边调宽，可折叠、返回来源和取下。每个资料库分别保存选区和布局，重新打开恢复。

文本置顶默认渲染；“编辑”切到该片段的源文，点击“保存”或 Ctrl+Enter 写回原笔记。来源发生并发变化时拒绝覆盖；选区穿过内部挂接边界时要求回到来源编辑。PDF 置顶只读，并依据页码和 PDF 坐标重新绘制，不依赖正文当前页的 canvas。

Rendered 选区可以直接置顶，公式扩展为完整 TeX。跨 Markdown 格式且不能精确映射时，菜单明确显示“完整公式／段落”，按所在源文块置顶；需更细选区可使用 Source。源文编辑中无法可靠追踪的选区保留最后内容，并提示来源变化。置顶不会创建独立笔记，也不会展开新的挂接链。

### 验证

在仓库根目录：

```
npm test
```

用 Node 内置 `node:test`，不经过 mockup 的 `tsc`，也不跑 Electron E2E。类型检查：`npm run typecheck:app`。

数学渲染同时支持美元符号定界符和 LaTeX 的反斜杠括号定界符；保留原文，不转换库文件。
`n公式局部 side：Rendered 中选中数学项，右键 New side 即可；Source 精确选区仍支持。普通编辑会更新关联位置。删除整个来源或跨越挂接边界会提示未保存，请撤销后先解除挂接。重开时可用恢复未保存的编辑找回草稿。
